import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { execSync } from "node:child_process";
import { enEmpresa } from "@/db/cliente";
import { registrarCobro, registrarPago } from "@/lib/cobros/registrar";
import { generarAsientos, perdidasYGanancias, sumasYSaldos } from "@/lib/contabilidad/asientos";
import { emitirFactura } from "@/lib/facturacion/emitir";
import { registrarGasto } from "@/lib/gastos/registrar";
import { altaCuenta, importarExtracto } from "@/lib/tesoreria/cuentas";
import { conciliarOtro } from "@/lib/tesoreria/conciliar";
import { altaTercero } from "@/lib/terceros/alta";
import { extractoN43 } from "./n43";

const URL_TEST = process.env.DATABASE_URL_TEST;
const d = URL_TEST ? describe : describe.skip;

d("contabilidad generada en PostgreSQL", () => {
  const sql = postgres(URL_TEST ?? "", { max: 8, onnotice: () => {} });
  let emp = "";
  const ctx = () => ({ empresaId: emp, hoy: "2026-11-17", ahora: new Date("2026-11-17T09:00:00Z") });

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
  });

  it("genera asientos cuadrados para facturas, gastos, cobros, pagos y banco", async () => {
    const cli = (await altaTercero(sql, { empresaId: emp }, "cliente", { razonSocial: "Cliente S.L.", nif: "B12345674" })).id;
    const prov = (await altaTercero(sql, { empresaId: emp }, "proveedor", { razonSocial: "Asesoría S.L.", nif: "A58818501" })).id;
    // Factura de 1.000 € + 21 % con retención del 15 %: total 1.060 €.
    const f = await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cli, fechaExpedicion: "2026-11-02", retencionPct: 15,
      lineas: [{ concepto: "Consultoría", cantidad: 1, precioUnitarioCent: 100000, tipoIva: 21 }] });
    // Gasto de 200 € + 21 % con la mitad del IVA deducible y retención del 15 %.
    const g = await registrarGasto(sql, ctx(), { proveedorId: prov, numero: "AS-1", fechaExpedicion: "2026-11-03", categoria: "profesionales",
      descripcion: "Asesoría", desglose: [{ baseCent: 20000, tipoIva: 21, deduciblePct: 50 }], retencionPct: 15 });
    if (!g.guardado) throw new Error();
    await registrarCobro(sql, ctx(), f.id, { fecha: "2026-11-10", importeCent: 106000, metodo: "Transferencia" });
    await registrarPago(sql, ctx(), g.id, { fecha: "2026-11-11", importeCent: 21200, metodo: "Transferencia" });
    const cuenta = (await altaCuenta(sql, { empresaId: emp }, { nombre: "Caixa", iban: "ES9121000418450200051332" })).id;
    const n43 = extractoN43({ desde: "2026-11-01", hasta: "2026-11-15", saldoInicialCent: 0, movimientos: [{ fecha: "2026-11-12", importeCent: -900, comun: "17", texto: "COMISION" }] });
    await importarExtracto(sql, { empresaId: emp }, cuenta, { nombre: "e.n43", bytes: new TextEncoder().encode(n43) });
    const [mov] = await enEmpresa(sql, emp, (tx) => tx`SELECT id FROM movimientos_bancarios`);
    await conciliarOtro(sql, ctx(), mov.id, "comisiones");

    const asientos = await enEmpresa(sql, emp, (tx) => generarAsientos(tx, "2026-01-01", "2026-12-31"));
    expect(asientos).toHaveLength(5);
    for (const a of asientos) {
      expect(a.apuntes.reduce((s, p) => s + p.debeCent, 0)).toBe(a.apuntes.reduce((s, p) => s + p.haberCent, 0));
    }
    const saldo = Object.fromEntries(sumasYSaldos(asientos).map((s) => [s.cuenta, s.saldoCent]));
    expect(saldo).toMatchObject({
      "430": 0, "473": 15000, "705": -100000, "477": -21000,
      "623": 22100, "472": 2100, "410": 0, "4751": -3000,
      "572": 106000 - 21200 - 900, "626": 900,
    });
    expect(perdidasYGanancias(sumasYSaldos(asientos))).toMatchObject({ totalIngresosCent: 100000, totalGastosCent: 23000, resultadoCent: 77000 });
  });
});
