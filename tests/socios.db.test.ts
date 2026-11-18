import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { execSync } from "node:child_process";
import { enEmpresa } from "@/db/cliente";
import { generarAsientos, perdidasYGanancias, sumasYSaldos } from "@/lib/contabilidad/asientos";
import { calcular303 } from "@/lib/impuestos/modelos";
import { altaSocio, borrarOperacion, ErrorSocio, registrarOperacion, resumenSocios } from "@/lib/socios/socios";
import { altaCuenta, importarExtracto } from "@/lib/tesoreria/cuentas";
import { conciliarConSocio, sugerencias } from "@/lib/tesoreria/conciliar";
import { cargarPrevision } from "@/lib/tesoreria/prevision";
import { extractoN43 } from "./n43";

const URL_TEST = process.env.DATABASE_URL_TEST;
const d = URL_TEST ? describe : describe.skip;

d("socios y financiación en PostgreSQL", () => {
  const sql = postgres(URL_TEST ?? "", { max: 8, onnotice: () => {} });
  let emp = "", ana = "", luis = "";
  const ctx = () => ({ empresaId: emp, hoy: "2026-11-17" });

  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    execSync("npx tsx scripts/migrate.ts", { env: { ...process.env, DATABASE_URL: URL_TEST }, stdio: "pipe" });
  });
  afterAll(async () => { await sql.end(); });
  beforeEach(async () => {
    const [{ id }] = await sql`INSERT INTO empresas (razon_social, nif, domicilio, codigo_postal, municipio, provincia)
      VALUES ('Empresa', ${"B" + Math.floor(Math.random() * 1e8)}, 'C/ Mayor 1', '28013', 'Madrid', 'Madrid') RETURNING id`;
    emp = id;
    ana = (await altaSocio(sql, ctx(), { nombre: "Ana Pérez", nif: "12345678Z", participacionPct: 60 })).id;
    luis = (await altaSocio(sql, ctx(), { nombre: "Luis Gómez", participacionPct: 40 })).id;
  });

  it("contabiliza capital, aportaciones y préstamos como fondos propios y deuda, nunca como ingresos", async () => {
    await registrarOperacion(sql, ctx(), { socioId: ana, tipo: "capital", fecha: "2026-11-02", importeCent: 180000 });
    await registrarOperacion(sql, ctx(), { socioId: luis, tipo: "capital", fecha: "2026-11-02", importeCent: 120000 });
    await registrarOperacion(sql, ctx(), { socioId: ana, tipo: "aportacion", fecha: "2026-11-03", importeCent: 50000 });
    const p = await registrarOperacion(sql, ctx(), { socioId: ana, tipo: "prestamo", fecha: "2026-11-04", importeCent: 1000000, plazo: "largo", vencimiento: "2026-12-20", interesPct: 0 });
    await registrarOperacion(sql, ctx(), { socioId: luis, tipo: "prestamo", fecha: "2026-11-04", importeCent: 200000, plazo: "corto" });
    await registrarOperacion(sql, ctx(), { socioId: ana, tipo: "devolucion", fecha: "2026-11-10", importeCent: 400000, prestamoId: p.id });

    const saldos = await enEmpresa(sql, emp, async (tx) => sumasYSaldos(await generarAsientos(tx, "2026-01-01", "2026-12-31")));
    const saldo = (c: string) => saldos.find((s) => s.cuenta === c)?.saldoCent ?? 0;
    expect(saldo("100")).toBe(-300000);
    expect(saldo("118")).toBe(-50000);
    expect(saldo("163")).toBe(-600000);
    expect(saldo("5133")).toBe(-200000);
    expect(saldo("572")).toBe(300000 + 50000 + 1200000 - 400000);
    const pyg = perdidasYGanancias(saldos);
    expect(pyg.totalIngresosCent).toBe(0);
    expect(pyg.resultadoCent).toBe(0);
    expect((await enEmpresa(sql, emp, (tx) => calcular303(tx, 2026, 4))).resultadoCent).toBe(0);

    const r = await enEmpresa(sql, emp, (tx) => resumenSocios(tx));
    expect(r.find((x) => x.id === ana)).toMatchObject({ capitalCent: 180000, aportacionesCent: 50000, prestamoPendienteCent: 600000 });

    // La devolución pendiente aparece como pago previsto en su fecha.
    const prev = await enEmpresa(sql, emp, (tx) => cargarPrevision(tx, "2026-11-17"));
    expect(prev.semanas.reduce((a, s) => a + s.pagosCent, 0)).toBe(600000);
  });

  it("no deja devolver más de lo prestado ni borrar un préstamo con devoluciones", async () => {
    const p = await registrarOperacion(sql, ctx(), { socioId: ana, tipo: "prestamo", fecha: "2026-11-04", importeCent: 100000, plazo: "corto" });
    await expect(registrarOperacion(sql, ctx(), { socioId: ana, tipo: "devolucion", fecha: "2026-11-05", importeCent: 100001, prestamoId: p.id })).rejects.toThrow(/supera lo pendiente/);
    await expect(registrarOperacion(sql, ctx(), { socioId: luis, tipo: "devolucion", fecha: "2026-11-05", importeCent: 100, prestamoId: p.id })).rejects.toBeInstanceOf(ErrorSocio);
    await expect(registrarOperacion(sql, ctx(), { socioId: ana, tipo: "prestamo", fecha: "2026-11-04", importeCent: 100 })).rejects.toThrow(/corto o a largo/);
    await expect(registrarOperacion(sql, ctx(), { socioId: ana, tipo: "capital", fecha: "2026-12-01", importeCent: 100 })).rejects.toThrow(/futura/);
    const dv = await registrarOperacion(sql, ctx(), { socioId: ana, tipo: "devolucion", fecha: "2026-11-05", importeCent: 100000, prestamoId: p.id });
    await expect(borrarOperacion(sql, ctx(), p.id)).rejects.toThrow(/devoluciones/);
    await borrarOperacion(sql, ctx(), dv.id);
    await borrarOperacion(sql, ctx(), p.id);
    expect((await enEmpresa(sql, emp, (tx) => resumenSocios(tx))).find((x) => x.id === ana)?.prestamoPendienteCent).toBe(0);
  });

  it("concilia el ingreso del banco con la aportación del socio", async () => {
    const cuenta = (await altaCuenta(sql, ctx(), { nombre: "Principal", iban: "ES9121000418450200051332" })).id;
    const n43 = extractoN43({ desde: "2026-11-01", hasta: "2026-11-16", saldoInicialCent: 0, movimientos: [{ fecha: "2026-11-02", importeCent: 300000, texto: "APORTACION CAPITAL ANA PEREZ" }] });
    await importarExtracto(sql, ctx(), cuenta, { nombre: "e.n43", bytes: new TextEncoder().encode(n43) });
    const o = await registrarOperacion(sql, ctx(), { socioId: ana, tipo: "capital", fecha: "2026-11-02", importeCent: 300000 });
    const [m] = await enEmpresa(sql, emp, (tx) => tx<{ id: string }[]>`SELECT id FROM movimientos_bancarios`);
    const sg = await enEmpresa(sql, emp, (tx) => sugerencias(tx, m.id));
    expect(sg[0]).toMatchObject({ tipo: "socio", id: o.id });
    await conciliarConSocio(sql, ctx(), m.id, o.id);
    await expect(borrarOperacion(sql, ctx(), o.id)).rejects.toThrow(/conciliada/);
  });
});
