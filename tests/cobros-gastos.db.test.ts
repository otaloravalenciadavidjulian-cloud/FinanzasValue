import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { execSync } from "node:child_process";
import { enEmpresa } from "@/db/cliente";
import { ErrorCobro, registrarCobro, registrarPago } from "@/lib/cobros/registrar";
import { anularFactura, emitirFactura } from "@/lib/facturacion/emitir";
import { moverGastoAPapelera, registrarGasto, restaurarGasto, type BorradorGasto } from "@/lib/gastos/registrar";
import { altaTercero } from "@/lib/terceros/alta";

const URL_TEST = process.env.DATABASE_URL_TEST;
const d = URL_TEST ? describe : describe.skip;

d("cobros, proveedores y gastos en PostgreSQL", () => {
  const sql = postgres(URL_TEST ?? "", { max: 8, onnotice: () => {} });
  let empA = "", empB = "", cliA = "", provA = "";
  const ctx = () => ({ empresaId: empA, hoy: "2026-11-17", ahora: new Date("2026-11-17T09:00:00Z") });
  const linea = { concepto: "Consultoría", cantidad: 1, precioUnitarioCent: 100000, tipoIva: 21 };
  const gasto = (extra: Partial<BorradorGasto> = {}): BorradorGasto => ({
    proveedorId: provA, numero: "F-100", fechaExpedicion: "2026-11-10", categoria: "suministros", descripcion: "Luz de octubre",
    desglose: [{ baseCent: 10000, tipoIva: 21 }], ...extra,
  });

  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    execSync("npx tsx scripts/migrate.ts", { env: { ...process.env, DATABASE_URL: URL_TEST }, stdio: "pipe" });
  });
  afterAll(async () => { await sql.end(); });

  beforeEach(async () => {
    const nueva = async (n: string) => {
      const [{ id }] = await sql`INSERT INTO empresas (razon_social, nif, domicilio, codigo_postal, municipio, provincia)
        VALUES (${n}, ${"B" + Math.floor(Math.random() * 1e8)}, 'C/ Mayor 1', '28013', 'Madrid', 'Madrid') RETURNING id`;
      await enEmpresa(sql, id, (tx) => tx`INSERT INTO series (empresa_id, codigo, descripcion, tipo_factura, ejercicio) VALUES (${id}, 'A', 'Ordinarias', 'F1', 2026)`);
      return id as string;
    };
    empA = await nueva("Empresa A");
    empB = await nueva("Empresa B");
    cliA = (await altaTercero(sql, { empresaId: empA }, "cliente", { razonSocial: "Cliente S.L.", nif: "B12345674" })).id;
    provA = (await altaTercero(sql, { empresaId: empA }, "proveedor", { razonSocial: "Eléctrica S.A.", nif: "A58818501" })).id;
  });

  it("registra cobros parciales y no deja cobrar de más", async () => {
    const f = await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cliA, fechaExpedicion: "2026-11-17", lineas: [linea] });
    await registrarCobro(sql, ctx(), f.id, { fecha: "2026-11-17", importeCent: 50000, metodo: "Transferencia" });
    await expect(registrarCobro(sql, ctx(), f.id, { fecha: "2026-11-17", importeCent: 71001, metodo: "Transferencia" })).rejects.toThrow(/supera lo pendiente/);
    const r = await registrarCobro(sql, ctx(), f.id, { fecha: "2026-11-17", importeCent: 71000, metodo: "Transferencia" });
    expect(r.cobradoCent).toBe(r.totalCent);
    await expect(registrarCobro(sql, ctx(), f.id, { fecha: "2026-11-18", importeCent: 1, metodo: "Transferencia" })).rejects.toThrow(/futura/);
  });

  it("dos cobros simultáneos no superan el total", async () => {
    const f = await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cliA, fechaExpedicion: "2026-11-17", lineas: [linea] });
    const res = await Promise.allSettled(Array.from({ length: 6 }, () =>
      registrarCobro(sql, ctx(), f.id, { fecha: "2026-11-17", importeCent: 50000, metodo: "Transferencia" })));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(res.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof ErrorCobro)).toBe(true);
  });

  it("los cobros no se modifican y no se cobran facturas anuladas", async () => {
    const f = await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cliA, fechaExpedicion: "2026-11-17", lineas: [linea] });
    await registrarCobro(sql, ctx(), f.id, { fecha: "2026-11-17", importeCent: 1000, metodo: "Efectivo" });
    await expect(enEmpresa(sql, empA, (tx) => tx`UPDATE cobros SET importe_cent = 5`)).rejects.toThrow();
    await expect(enEmpresa(sql, empA, (tx) => tx`DELETE FROM cobros`)).rejects.toThrow();
    await anularFactura(sql, ctx(), f.id, "Error");
    await expect(registrarCobro(sql, ctx(), f.id, { fecha: "2026-11-17", importeCent: 1000, metodo: "Efectivo" })).rejects.toThrow(/anulada/);
  });

  it("un tercero puede ser cliente y proveedor sin duplicarse", async () => {
    const r = await altaTercero(sql, { empresaId: empA }, "proveedor", { razonSocial: "Cliente S.L.", nif: "b-12345674" });
    expect(r).toEqual({ id: cliA, nuevo: false });
    await expect(altaTercero(sql, { empresaId: empA }, "proveedor", { razonSocial: "X", nif: "B12345674" })).rejects.toThrow(/Ya existe un proveedor/);
    await expect(altaTercero(sql, { empresaId: empA }, "proveedor", { razonSocial: "X", nif: "B12345675" })).rejects.toThrow(/no es válido/);
  });

  it("registra gastos con IVA deducible y rechaza la misma factura dos veces", async () => {
    const g = await registrarGasto(sql, ctx(), gasto({ desglose: [{ baseCent: 10000, tipoIva: 21, deduciblePct: 50 }] }));
    expect(g.guardado).toBe(true);
    const [fila] = await enEmpresa(sql, empA, (tx) => tx`SELECT cuota_iva_cent, cuota_deducible_cent, total_cent, pendiente_documentacion FROM gastos`);
    expect(fila).toMatchObject({ cuota_iva_cent: "2100", cuota_deducible_cent: "1050", total_cent: "12100", pendiente_documentacion: true });
    await expect(registrarGasto(sql, ctx(), gasto({ numero: "f-100" }))).rejects.toThrow(/ya está registrada/);
    await expect(registrarGasto(sql, ctx(), gasto({ proveedorId: undefined, numero: undefined }))).rejects.toThrow(/proveedor y número/);
  });

  it("avisa de posibles duplicados y guarda si se confirma", async () => {
    await registrarGasto(sql, ctx(), gasto());
    const r = await registrarGasto(sql, ctx(), gasto({ numero: "F-101", fechaExpedicion: "2026-11-14" }));
    expect(r.guardado).toBe(false);
    if (!r.guardado) expect(r.posiblesDuplicados[0].numero).toBe("F-100");
    const ok = await registrarGasto(sql, ctx(), gasto({ numero: "F-101", fechaExpedicion: "2026-11-14", confirmarPosibleDuplicado: true }));
    expect(ok.guardado).toBe(true);
    // Fuera de la ventana de 7 días no hay aviso.
    expect((await registrarGasto(sql, ctx(), gasto({ numero: "F-102", fechaExpedicion: "2026-10-01" }))).guardado).toBe(true);
  });

  it("papelera: nunca se borra, se puede restaurar y respeta duplicados y pagos", async () => {
    const g = await registrarGasto(sql, ctx(), gasto());
    if (!g.guardado) throw new Error("no guardado");
    await expect(enEmpresa(sql, empA, (tx) => tx`DELETE FROM gastos WHERE id = ${g.id}`)).rejects.toThrow();
    await moverGastoAPapelera(sql, ctx(), g.id, "Registrado por error");
    const otro = await registrarGasto(sql, ctx(), gasto({ confirmarPosibleDuplicado: true }));
    expect(otro.guardado).toBe(true);
    await expect(restaurarGasto(sql, ctx(), g.id)).rejects.toThrow(/mismo proveedor y número/);
    if (!otro.guardado) return;
    await registrarPago(sql, ctx(), otro.id, { fecha: "2026-11-17", importeCent: 12100, metodo: "Domiciliación" });
    await expect(registrarPago(sql, ctx(), otro.id, { fecha: "2026-11-17", importeCent: 1, metodo: "Domiciliación" })).rejects.toThrow(/supera/);
    await expect(moverGastoAPapelera(sql, ctx(), otro.id, "x")).rejects.toThrow(/pagos registrados/);
    await expect(registrarPago(sql, ctx(), g.id, { fecha: "2026-11-17", importeCent: 100, metodo: "Efectivo" })).rejects.toThrow(/papelera/);
  });

  it("aísla gastos y pagos entre empresas", async () => {
    await registrarGasto(sql, ctx(), gasto());
    expect(await enEmpresa(sql, empB, (tx) => tx`SELECT id FROM gastos`)).toHaveLength(0);
    await expect(registrarGasto(sql, { empresaId: empB, hoy: "2026-11-17" }, gasto())).rejects.toThrow(/Proveedor no encontrado/);
    await expect(enEmpresa(sql, empB, (tx) => tx`INSERT INTO pagos (empresa_id, gasto_id, fecha, importe_cent, metodo)
      SELECT ${empA}, id, current_date, 1, 'x' FROM gastos`)).resolves.toHaveLength(0);
    await expect(enEmpresa(sql, empB, (tx) => tx`INSERT INTO gastos (empresa_id, fecha_expedicion, categoria, descripcion, base_cent, cuota_iva_cent, cuota_deducible_cent, total_cent)
      VALUES (${empA}, current_date, 'otros_servicios', 'x', 0, 0, 0, 0)`)).rejects.toThrow(/row-level security/);
  });
});
