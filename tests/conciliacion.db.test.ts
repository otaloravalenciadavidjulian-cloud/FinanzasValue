import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { execSync } from "node:child_process";
import { enEmpresa } from "@/db/cliente";
import { registrarCobro, registrarPago } from "@/lib/cobros/registrar";
import { emitirFactura } from "@/lib/facturacion/emitir";
import { registrarGasto } from "@/lib/gastos/registrar";
import { altaCuenta, importarExtracto } from "@/lib/tesoreria/cuentas";
import { cargarPrevision } from "@/lib/tesoreria/prevision";
import { cobrarYConciliar, conciliarConCobro, conciliarConPago, conciliarOtro, deshacerConciliacion, pagarYConciliar, sugerencias } from "@/lib/tesoreria/conciliar";
import { altaTercero } from "@/lib/terceros/alta";
import { extractoN43, type MovPrueba } from "./n43";

const URL_TEST = process.env.DATABASE_URL_TEST;
const d = URL_TEST ? describe : describe.skip;

d("conciliación bancaria en PostgreSQL", () => {
  const sql = postgres(URL_TEST ?? "", { max: 8, onnotice: () => {} });
  let emp = "", cli = "", prov = "", cuenta = "";
  const ctx = () => ({ empresaId: emp, hoy: "2026-11-17", ahora: new Date("2026-11-17T09:00:00Z") });
  const linea = { concepto: "Consultoría", cantidad: 1, precioUnitarioCent: 100000, tipoIva: 21 };

  async function importar(movs: MovPrueba[]) {
    const n43 = extractoN43({ desde: "2026-11-01", hasta: "2026-11-16", saldoInicialCent: 1000000, movimientos: movs });
    await importarExtracto(sql, ctx(), cuenta, { nombre: `e${Math.random()}.n43`, bytes: new TextEncoder().encode(n43) });
    return enEmpresa(sql, emp, (tx) => tx<{ id: string; importe_cent: string }[]>`SELECT id, importe_cent FROM movimientos_bancarios ORDER BY fecha_operacion, creado_en`);
  }

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
    cli = (await altaTercero(sql, { empresaId: emp }, "cliente", { razonSocial: "Cliente Montes S.L.", nif: "B12345674" })).id;
    prov = (await altaTercero(sql, { empresaId: emp }, "proveedor", { razonSocial: "Eléctrica S.A.", nif: "A58818501" })).id;
    cuenta = (await altaCuenta(sql, { empresaId: emp }, { nombre: "Caixa", iban: "ES9121000418450200051332" })).id;
  });

  it("propone la factura por importe y número, y registra el cobro al conciliar", async () => {
    const f = await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cli, fechaExpedicion: "2026-11-02", lineas: [linea] });
    const [{ num_serie }] = await enEmpresa(sql, emp, (tx) => tx`SELECT num_serie FROM facturas WHERE id = ${f.id}`);
    const [m] = await importar([{ fecha: "2026-11-10", importeCent: 121000, texto: "TRANSF MONTES", concepto: `PAGO ${num_serie}` }]);
    const s = await enEmpresa(sql, emp, (tx) => sugerencias(tx, m.id));
    expect(s[0]).toMatchObject({ tipo: "factura", id: f.id, importeCent: 121000 });
    await cobrarYConciliar(sql, ctx(), m.id, f.id);
    const [c] = await enEmpresa(sql, emp, (tx) => tx`SELECT importe_cent, metodo, to_char(fecha,'YYYY-MM-DD') AS fecha FROM cobros WHERE factura_id = ${f.id}`);
    expect(c).toMatchObject({ importe_cent: "121000", metodo: "Transferencia", fecha: "2026-11-10" });
    await expect(cobrarYConciliar(sql, ctx(), m.id, f.id)).rejects.toThrow(/ya está conciliado/);
  });

  it("un abono mayor que lo pendiente no se puede cobrar y no deja nada a medias", async () => {
    const f = await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cli, fechaExpedicion: "2026-11-02", lineas: [linea] });
    const [m] = await importar([{ fecha: "2026-11-10", importeCent: 200000, texto: "TRANSF" }]);
    await expect(cobrarYConciliar(sql, ctx(), m.id, f.id)).rejects.toThrow(/supera lo pendiente/);
    expect(await enEmpresa(sql, emp, (tx) => tx`SELECT * FROM cobros`)).toHaveLength(0);
    expect(await enEmpresa(sql, emp, (tx) => tx`SELECT * FROM conciliaciones`)).toHaveLength(0);
  });

  it("concilia con cobros y pagos ya registrados del mismo importe, una sola vez", async () => {
    const f = await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cli, fechaExpedicion: "2026-11-02", lineas: [linea] });
    const cobro = await registrarCobro(sql, ctx(), f.id, { fecha: "2026-11-09", importeCent: 50000, metodo: "Transferencia" });
    const g = await registrarGasto(sql, ctx(), { proveedorId: prov, numero: "L-77", fechaExpedicion: "2026-11-01", categoria: "suministros", descripcion: "Luz", desglose: [{ baseCent: 10000, tipoIva: 21 }] });
    if (!g.guardado) throw new Error();
    const pago = await registrarPago(sql, ctx(), g.id, { fecha: "2026-11-12", importeCent: 12100, metodo: "Domiciliación" });
    const [a, b, c] = await importar([
      { fecha: "2026-11-10", importeCent: 50000, texto: "TRANSF" },
      { fecha: "2026-11-12", importeCent: -12100, comun: "03", texto: "RECIBO ELECTRICA" },
      { fecha: "2026-11-13", importeCent: 50000, texto: "TRANSF" },
    ]);
    expect((await enEmpresa(sql, emp, (tx) => sugerencias(tx, a.id)))[0]).toMatchObject({ tipo: "cobro", id: cobro.id });
    expect((await enEmpresa(sql, emp, (tx) => sugerencias(tx, b.id)))[0]).toMatchObject({ tipo: "pago", id: pago.id });
    await conciliarConCobro(sql, ctx(), a.id, cobro.id);
    await conciliarConPago(sql, ctx(), b.id, pago.id);
    await expect(conciliarConCobro(sql, ctx(), c.id, cobro.id)).rejects.toThrow(/ya está conciliado con otro/);
    expect((await enEmpresa(sql, emp, (tx) => sugerencias(tx, c.id))).some((s) => s.tipo === "cobro")).toBe(false);
    await expect(conciliarConPago(sql, ctx(), c.id, pago.id)).rejects.toThrow(/no coincide/);
  });

  it("paga y concilia un gasto; los movimientos sin factura se explican con una categoría", async () => {
    const g = await registrarGasto(sql, ctx(), { proveedorId: prov, numero: "L-78", fechaExpedicion: "2026-11-01", categoria: "suministros", descripcion: "Luz", desglose: [{ baseCent: 10000, tipoIva: 21 }] });
    if (!g.guardado) throw new Error();
    const [cargo, comision] = await importar([
      { fecha: "2026-11-05", importeCent: -12100, comun: "03", texto: "ELECTRICA SA RECIBO L-78" },
      { fecha: "2026-11-06", importeCent: -900, comun: "17", texto: "COMISION" },
    ]);
    expect((await enEmpresa(sql, emp, (tx) => sugerencias(tx, cargo.id)))[0]).toMatchObject({ tipo: "gasto", id: g.id });
    await pagarYConciliar(sql, ctx(), cargo.id, g.id);
    const [p] = await enEmpresa(sql, emp, (tx) => tx`SELECT importe_cent, metodo FROM pagos WHERE gasto_id = ${g.id}`);
    expect(p).toMatchObject({ importe_cent: "12100", metodo: "Domiciliación" });
    await expect(conciliarOtro(sql, ctx(), comision.id, "inventada")).rejects.toThrow(/Elige/);
    await conciliarOtro(sql, ctx(), comision.id, "comisiones", "Mantenimiento");
    await expect(pagarYConciliar(sql, ctx(), comision.id, g.id)).rejects.toThrow(/ya está conciliado/);
  });

  it("deshacer deja historial, libera el movimiento y no se puede borrar ni modificar", async () => {
    const [m] = await importar([{ fecha: "2026-11-06", importeCent: -900, comun: "17", texto: "COMISION" }]);
    await conciliarOtro(sql, ctx(), m.id, "otros");
    await expect(deshacerConciliacion(sql, ctx(), m.id, "")).rejects.toThrow(/motivo/);
    await deshacerConciliacion(sql, ctx(), m.id, "Era una comisión");
    await conciliarOtro(sql, ctx(), m.id, "comisiones");
    const filas = await enEmpresa(sql, emp, (tx) => tx`SELECT categoria, motivo_deshacer FROM conciliaciones ORDER BY creado_en`);
    expect(filas).toEqual([{ categoria: "otros", motivo_deshacer: "Era una comisión" }, { categoria: "comisiones", motivo_deshacer: null }]);
    await expect(enEmpresa(sql, emp, (tx) => tx`DELETE FROM conciliaciones`)).rejects.toThrow(/no se borran/);
    await expect(enEmpresa(sql, emp, (tx) => tx`UPDATE conciliaciones SET categoria = 'nominas'`)).rejects.toThrow(/no se modifica/);
  });

  it("la previsión parte del saldo en bancos y usa vencimientos y recurrentes conciliados", async () => {
    await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cli, fechaExpedicion: "2026-11-02", lineas: [linea] });
    const g = await registrarGasto(sql, ctx(), { proveedorId: prov, numero: "L-90", fechaExpedicion: "2026-11-10", categoria: "suministros",
      descripcion: "Luz", desglose: [{ baseCent: 10000, tipoIva: 21 }], vencimiento: "2026-11-30" });
    if (!g.guardado) throw new Error();
    const [nomina] = await importar([{ fecha: "2026-11-05", importeCent: -300000, comun: "15", texto: "NOMINAS" }]);
    await conciliarOtro(sql, ctx(), nomina.id, "nominas");
    const p = await enEmpresa(sql, emp, (tx) => cargarPrevision(tx, "2026-11-17", 4));
    expect(p.saldoInicialCent).toBe(1000000 - 300000);
    expect(p.recurrenteMensualCent).toBe(100000);
    // La factura vence a los 30 días del cliente (2 de diciembre); el gasto, el 30 de noviembre.
    expect(p.semanas.find((s) => s.cobrosCent > 0)?.desde).toBe("2026-12-01");
    expect(p.semanas.find((s) => s.pagosCent > 0)).toMatchObject({ desde: "2026-11-24", pagosCent: 12100 });
  });
});
