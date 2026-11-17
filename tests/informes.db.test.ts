import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { execSync } from "node:child_process";
import { enEmpresa } from "@/db/cliente";
import { emitirFactura } from "@/lib/facturacion/emitir";
import { registrarGasto } from "@/lib/gastos/registrar";
import { libroExpedidas, libroRecibidas } from "@/lib/informes/libros";
import { altaTercero } from "@/lib/terceros/alta";

const URL_TEST = process.env.DATABASE_URL_TEST;
const d = URL_TEST ? describe : describe.skip;

d("libros registro en PostgreSQL", () => {
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

  it("una línea por factura y tipo de IVA, con retención y total solo en la primera", async () => {
    const cli = (await altaTercero(sql, { empresaId: emp }, "cliente", { razonSocial: "Cliente S.L.", nif: "B12345674" })).id;
    const prov = (await altaTercero(sql, { empresaId: emp }, "proveedor", { razonSocial: "Asesoría S.L.", nif: "A58818501" })).id;
    await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cli, fechaExpedicion: "2026-11-02", retencionPct: 15, lineas: [
      { concepto: "Consultoría", cantidad: 1, precioUnitarioCent: 100000, tipoIva: 21 },
      { concepto: "Libro", cantidad: 1, precioUnitarioCent: 2000, tipoIva: 4 }] });
    const g = await registrarGasto(sql, ctx(), { proveedorId: prov, numero: "AS-1", fechaExpedicion: "2026-11-03", categoria: "profesionales",
      descripcion: "Asesoría", desglose: [{ baseCent: 20000, tipoIva: 21, deduciblePct: 50 }] });
    if (!g.guardado) throw new Error();

    const exp = await enEmpresa(sql, emp, (tx) => libroExpedidas(tx, "2026-11-01", "2026-11-30"));
    expect(exp).toHaveLength(2);
    expect(exp[0]).toEqual(["02/11/2026", "", expect.stringMatching(/^A/), "Factura", "B12345674", "Cliente S.L.", "1000,00", "21", "210,00", "153,00", "1077,80", "", "Emitida"]);
    expect(exp[1].slice(6, 11)).toEqual(["20,00", "4", "0,80", "", ""]);

    const rec = await enEmpresa(sql, emp, (tx) => libroRecibidas(tx, "2026-11-01", "2026-11-30"));
    expect(rec).toEqual([["1", "03/11/2026", expect.any(String), "AS-1", "Factura", "A58818501", "Asesoría S.L.", "200,00", "21", "42,00", "50", "21,00", "0,00", "242,00",
      "Servicios profesionales (asesoría, abogados…)", "Pendiente"]]);
    expect(await enEmpresa(sql, emp, (tx) => libroExpedidas(tx, "2026-12-01", "2026-12-31"))).toEqual([]);
  });
});
