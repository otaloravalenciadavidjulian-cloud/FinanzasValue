import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { execSync } from "node:child_process";
import { enEmpresa } from "@/db/cliente";
import { altaCuenta, importarExtracto } from "@/lib/tesoreria/cuentas";
import { extractoN43 } from "./n43";

const URL_TEST = process.env.DATABASE_URL_TEST;
const d = URL_TEST ? describe : describe.skip;
const IBAN = "ES9121000418450200051332";
const bytes = (s: string) => new TextEncoder().encode(s);

d("tesorería en PostgreSQL", () => {
  const sql = postgres(URL_TEST ?? "", { max: 8, onnotice: () => {} });
  let empA = "", empB = "";
  const ctx = () => ({ empresaId: empA });
  const primero = extractoN43({ desde: "2026-11-01", hasta: "2026-11-10", saldoInicialCent: 100000, movimientos: [
    { fecha: "2026-11-03", importeCent: 50000, texto: "TRANSF CLIENTE" },
    { fecha: "2026-11-08", importeCent: -2000, comun: "17", texto: "COMISION" },
  ] });
  const solapado = extractoN43({ desde: "2026-11-08", hasta: "2026-11-15", saldoInicialCent: 148000 + 2000, movimientos: [
    { fecha: "2026-11-08", importeCent: -2000, comun: "17", texto: "COMISION" },
    { fecha: "2026-11-12", importeCent: -30000, comun: "03", texto: "RECIBO LUZ" },
  ] });

  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    execSync("npx tsx scripts/migrate.ts", { env: { ...process.env, DATABASE_URL: URL_TEST }, stdio: "pipe" });
  });
  afterAll(async () => { await sql.end(); });
  beforeEach(async () => {
    const nueva = async (n: string) => (await sql`INSERT INTO empresas (razon_social, nif, domicilio, codigo_postal, municipio, provincia)
      VALUES (${n}, ${"B" + Math.floor(Math.random() * 1e8)}, 'C/ Mayor 1', '28013', 'Madrid', 'Madrid') RETURNING id`)[0].id as string;
    empA = await nueva("A");
    empB = await nueva("B");
  });

  it("da de alta cuentas con IBAN válido y sin repetir", async () => {
    await altaCuenta(sql, ctx(), { nombre: "Caixa", iban: "es91 2100 0418 4502 0005 1332" });
    await expect(altaCuenta(sql, ctx(), { nombre: "Otra", iban: IBAN })).rejects.toThrow(/ya está dada de alta/);
    await expect(altaCuenta(sql, ctx(), { nombre: "Mala", iban: "ES9121000418450200051333" })).rejects.toThrow(/no es válido/);
    // Otra empresa puede tener la misma cuenta registrada (p. ej. una gestoría) sin ver la de A.
    await altaCuenta(sql, { empresaId: empB }, { nombre: "Caixa", iban: IBAN });
    expect(await enEmpresa(sql, empB, (tx) => tx`SELECT nombre FROM cuentas_bancarias`)).toHaveLength(1);
  });

  it("importa un extracto, ignora movimientos ya importados y no repite el fichero", async () => {
    const c = await altaCuenta(sql, ctx(), { nombre: "Caixa", iban: IBAN });
    const r1 = await importarExtracto(sql, ctx(), c.id, { nombre: "nov1.n43", bytes: bytes(primero) });
    expect(r1).toMatchObject({ nuevos: 2, repetidos: 0, saldoFinalCent: 148000 });
    const r2 = await importarExtracto(sql, ctx(), c.id, { nombre: "nov2.n43", bytes: bytes(solapado) });
    expect(r2).toMatchObject({ nuevos: 1, repetidos: 1 });
    await expect(importarExtracto(sql, ctx(), c.id, { nombre: "nov1.n43", bytes: bytes(primero) })).rejects.toThrow(/ya se importó/);
    const [s] = await enEmpresa(sql, empA, (tx) => tx`
      SELECT c.saldo_inicial_cent + coalesce(sum(m.importe_cent), 0) AS saldo FROM cuentas_bancarias c
      LEFT JOIN movimientos_bancarios m ON m.cuenta_id = c.id WHERE c.id = ${c.id} GROUP BY c.id`);
    expect(Number(s.saldo)).toBe(118000);
  });

  it("rechaza extractos de otra cuenta o dañados", async () => {
    const otra = await altaCuenta(sql, ctx(), { nombre: "DE", iban: "DE89370400440532013000" });
    await expect(importarExtracto(sql, ctx(), otra.id, { nombre: "x", bytes: bytes(primero) })).rejects.toThrow(/no es de esta cuenta/);
    const c = await altaCuenta(sql, ctx(), { nombre: "Caixa", iban: IBAN });
    await expect(importarExtracto(sql, ctx(), c.id, { nombre: "x", bytes: bytes(primero.replace(/^33.*$/m, "")) })).rejects.toThrow(/final de cuenta/);
  });

  it("los movimientos no se modifican ni se ven desde otra empresa", async () => {
    const c = await altaCuenta(sql, ctx(), { nombre: "Caixa", iban: IBAN });
    await importarExtracto(sql, ctx(), c.id, { nombre: "nov1.n43", bytes: bytes(primero) });
    await expect(enEmpresa(sql, empA, (tx) => tx`UPDATE movimientos_bancarios SET importe_cent = 1`)).rejects.toThrow(/inalterable/);
    await expect(enEmpresa(sql, empA, (tx) => tx`DELETE FROM movimientos_bancarios`)).rejects.toThrow(/inalterable/);
    expect(await enEmpresa(sql, empB, (tx) => tx`SELECT * FROM movimientos_bancarios`)).toHaveLength(0);
    await expect(importarExtracto(sql, { empresaId: empB }, c.id, { nombre: "x", bytes: bytes(primero) })).rejects.toThrow(/no encontrada/);
  });
});
