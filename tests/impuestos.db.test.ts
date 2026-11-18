import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { execSync } from "node:child_process";
import { enEmpresa } from "@/db/cliente";
import { anularFactura, emitirFactura } from "@/lib/facturacion/emitir";
import { registrarGasto, type BorradorGasto } from "@/lib/gastos/registrar";
import { calcular303, calcular347, calcularRetenciones, casillas303 } from "@/lib/impuestos/modelos";
import { cargarPrevision } from "@/lib/tesoreria/prevision";
import { altaTercero } from "@/lib/terceros/alta";

const URL_TEST = process.env.DATABASE_URL_TEST;
const d = URL_TEST ? describe : describe.skip;

d("borradores de impuestos en PostgreSQL", () => {
  const sql = postgres(URL_TEST ?? "", { max: 8, onnotice: () => {} });
  let emp = "", cli = "", prov = "", casero = "";
  const ctx = (hoy = "2026-11-17") => ({ empresaId: emp, hoy, ahora: new Date(`${hoy}T09:00:00Z`) });
  let n = 0;
  const gasto = async (extra: Partial<BorradorGasto>) => {
    const r = await registrarGasto(sql, ctx(), { proveedorId: prov, numero: `G-${++n}`, fechaExpedicion: "2026-08-10", categoria: "suministros",
      descripcion: "x", desglose: [{ baseCent: 10000, tipoIva: 21 }], confirmarPosibleDuplicado: true, ...extra });
    if (!r.guardado) throw new Error();
  };

  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    execSync("npx tsx scripts/migrate.ts", { env: { ...process.env, DATABASE_URL: URL_TEST }, stdio: "pipe" });
  });
  afterAll(async () => { await sql.end(); });
  beforeEach(async () => {
    const [{ id }] = await sql`INSERT INTO empresas (razon_social, nif, domicilio, codigo_postal, municipio, provincia)
      VALUES ('Empresa', ${"B" + Math.floor(Math.random() * 1e8)}, 'C/ Mayor 1', '28013', 'Madrid', 'Madrid') RETURNING id`;
    emp = id;
    await enEmpresa(sql, emp, (tx) => tx`INSERT INTO series (empresa_id, codigo, descripcion, tipo_factura, ejercicio) VALUES (${emp}, 'A', 'Ordinarias', 'F1', 2026)`);
    cli = (await altaTercero(sql, { empresaId: emp }, "cliente", { razonSocial: "Cliente S.L.", nif: "B12345674" })).id;
    prov = (await altaTercero(sql, { empresaId: emp }, "proveedor", { razonSocial: "Eléctrica S.A.", nif: "A58818501" })).id;
    casero = (await altaTercero(sql, { empresaId: emp }, "proveedor", { razonSocial: "Inmuebles S.L.", nif: "A39200019" })).id;
  });

  it("303: IVA devengado por tipo, deducible y resultado; las anuladas no cuentan", async () => {
    const lineas = [{ concepto: "A", cantidad: 1, precioUnitarioCent: 100000, tipoIva: 21 }, { concepto: "B", cantidad: 1, precioUnitarioCent: 50000, tipoIva: 10 }];
    await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cli, fechaExpedicion: "2026-08-01", lineas });
    const anulada = await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cli, fechaExpedicion: "2026-08-02", lineas });
    await anularFactura(sql, ctx(), anulada.id, "Error");
    await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cli, fechaExpedicion: "2026-10-01", lineas });
    await gasto({ desglose: [{ baseCent: 10000, tipoIva: 21, deduciblePct: 50 }] });
    const m = await enEmpresa(sql, emp, (tx) => calcular303(tx, 2026, 3));
    expect(m.devengado.map((l) => [l.tipo, l.baseCent, l.cuotaCent])).toEqual([[10, 50000, 5000], [21, 100000, 21000]]);
    expect(m).toMatchObject({ totalDevengadoCent: 26000, deducible: { baseCent: 10000, cuotaCent: 1050 }, resultadoCent: 24950 });
    expect(m.plazo.hasta).toBe("2026-10-20");
    const c = Object.fromEntries(casillas303(m).map((x) => [x.casilla, x.importeCent]));
    expect(c).toMatchObject({ "07": 100000, "09": 21000, "04": 50000, "06": 5000, "27": 26000, "29": 1050, "46": 24950 });
    expect(m.avisos.some((a) => /sin factura|justificante/.test(a))).toBe(true);
  });

  it("303: ventas sin IVA en sus casillas informativas según la causa", async () => {
    await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cli, fechaExpedicion: "2026-08-03", lineas: [
      { concepto: "Venta UE", cantidad: 1, precioUnitarioCent: 70000, tipoIva: 0, causaIva: "E5" },
      { concepto: "Exportación", cantidad: 1, precioUnitarioCent: 30000, tipoIva: 0, causaIva: "E2" },
      { concepto: "Servicio fuera de la UE", cantidad: 1, precioUnitarioCent: 20000, tipoIva: 0, causaIva: "N2" },
      { concepto: "Formación exenta", cantidad: 1, precioUnitarioCent: 10000, tipoIva: 0, causaIva: "E1" },
      { concepto: "Normal", cantidad: 1, precioUnitarioCent: 10000, tipoIva: 21 }] });
    await expect(emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cli, fechaExpedicion: "2026-08-04", lineas: [
      { concepto: "Sin causa", cantidad: 1, precioUnitarioCent: 100, tipoIva: 0 }] })).rejects.toThrow(/0 %/);
    const m = await enEmpresa(sql, emp, (tx) => calcular303(tx, 2026, 3));
    expect(m.devengado.map((l) => l.tipo)).toEqual([21]);
    const c = Object.fromEntries(casillas303(m).map((x) => [x.casilla, x.importeCent]));
    expect(c).toMatchObject({ "07": 10000, "59": 70000, "60": 30000, "120": 20000 });
    expect(m.avisos.some((a) => /390/.test(a))).toBe(true);
  });

  it("111 y 115: retenciones de profesionales y de alquileres por separado", async () => {
    await gasto({ categoria: "profesionales", retencionPct: 15 });
    await gasto({ categoria: "profesionales", retencionPct: 15, proveedorId: prov });
    await gasto({ categoria: "alquileres", retencionPct: 19, proveedorId: casero });
    await gasto({});
    const r111 = await enEmpresa(sql, emp, (tx) => calcularRetenciones(tx, "111", 2026, 3));
    const r115 = await enEmpresa(sql, emp, (tx) => calcularRetenciones(tx, "115", 2026, 3));
    expect(r111).toMatchObject({ perceptores: 1, baseCent: 20000, retencionesCent: 3000 });
    expect(r115).toMatchObject({ perceptores: 1, baseCent: 10000, retencionesCent: 1900 });
  });

  it("347: solo terceros por encima de 3.005,06 € con IVA, por trimestres y sin operaciones con retención", async () => {
    const linea = (c: number) => [{ concepto: "A", cantidad: 1, precioUnitarioCent: c, tipoIva: 21 }];
    await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cli, fechaExpedicion: "2026-02-01", lineas: linea(200000) });
    await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cli, fechaExpedicion: "2026-08-01", lineas: linea(100000) });
    await gasto({ desglose: [{ baseCent: 248000, tipoIva: 21 }] }); // 3.000,80 € con IVA: no llega
    await gasto({ categoria: "alquileres", retencionPct: 19, proveedorId: casero, desglose: [{ baseCent: 500000, tipoIva: 21 }] });
    const r = await enEmpresa(sql, emp, (tx) => calcular347(tx, 2026));
    expect(r).toEqual([{ terceroId: cli, nif: "B12345674", nombre: "Cliente S.L.", clave: "B", totalCent: 363000, trimestres: [242000, 0, 121000, 0] }]);
  });

  it("la previsión incluye los impuestos que vencen en el horizonte", async () => {
    await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cli, fechaExpedicion: "2026-08-01", lineas: [{ concepto: "A", cantidad: 1, precioUnitarioCent: 100000, tipoIva: 21 }] });
    const p = await enEmpresa(sql, emp, (tx) => cargarPrevision(tx, "2026-10-05", 4));
    expect(p.impuestos).toEqual([{ fecha: "2026-10-20", importeCent: 21000, vencido: false, concepto: "IVA (303) 3T 2026" }]);
    expect(p.semanas[2].pagosCent).toBe(21000);
  });
});
