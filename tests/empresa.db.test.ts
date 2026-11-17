import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { execSync } from "node:child_process";
import { PDFDocument } from "pdf-lib";
import { enEmpresa } from "@/db/cliente";
import { cambiarLogotipo, editarEmpresa, ErrorEmpresa, leerEmpresa } from "@/lib/empresas/datos";
import { cargarFacturaPDF } from "@/lib/facturacion/documento";
import { emitirFactura } from "@/lib/facturacion/emitir";
import { generarFacturaPDF } from "@/lib/facturacion/pdf";
import { altaTercero } from "@/lib/terceros/alta";

const URL_TEST = process.env.DATABASE_URL_TEST;
const d = URL_TEST ? describe : describe.skip;
// PNG de 1×1 píxel.
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

d("datos de la empresa en PostgreSQL", () => {
  const sql = postgres(URL_TEST ?? "", { max: 8, onnotice: () => {} });
  let emp = "";
  const ctx = () => ({ empresaId: emp, hoy: "2026-11-17", ahora: new Date("2026-11-17T09:00:00Z") });
  const datos = { domicilio: "C/ Nueva 5", codigoPostal: "08001", municipio: "Barcelona", provincia: "Barcelona", iban: "ES91 2100 0418 4502 0005 1332", email: "hola@empresa.es" };

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

  it("las facturas emitidas conservan los datos con los que se emitieron", async () => {
    const cli = (await altaTercero(sql, { empresaId: emp }, "cliente", { razonSocial: "Cliente S.L.", nif: "B12345674" })).id;
    const f = await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cli, fechaExpedicion: "2026-11-17", lineas: [{ concepto: "X", cantidad: 1, precioUnitarioCent: 100, tipoIva: 21 }] });
    expect(await editarEmpresa(sql, { empresaId: emp }, datos)).toBeGreaterThan(0);
    expect(await editarEmpresa(sql, { empresaId: emp }, datos)).toBe(0);
    await cambiarLogotipo(sql, { empresaId: emp }, { nombre: "logo.png", bytes: PNG });

    const antigua = await enEmpresa(sql, emp, (tx) => cargarFacturaPDF(tx, f.id));
    expect(antigua!.emisor).toMatchObject({ domicilio: "C/ Mayor 1", municipio: "Madrid", iban: null, logo: null });
    const actual = await enEmpresa(sql, emp, (tx) => leerEmpresa(tx, emp));
    expect(actual).toMatchObject({ domicilio: "C/ Nueva 5", iban: "ES9121000418450200051332", email: "hola@empresa.es" });

    const nueva = await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cli, fechaExpedicion: "2026-11-17", lineas: [{ concepto: "Y", cantidad: 1, precioUnitarioCent: 100, tipoIva: 21 }] });
    const dn = await enEmpresa(sql, emp, (tx) => cargarFacturaPDF(tx, nueva.id));
    expect(dn!.emisor.municipio).toBe("Barcelona");
    expect(dn!.emisor.logo?.mime).toBe("image/png");
    expect((await PDFDocument.load(await generarFacturaPDF(dn!))).getPageCount()).toBe(1);
  });

  it("valida los datos y protege la identidad fiscal", async () => {
    await expect(editarEmpresa(sql, { empresaId: emp }, { ...datos, codigoPostal: "8001" })).rejects.toBeInstanceOf(ErrorEmpresa);
    await expect(editarEmpresa(sql, { empresaId: emp }, { ...datos, iban: "ES00 1234" })).rejects.toThrow(/IBAN/);
    await expect(cambiarLogotipo(sql, { empresaId: emp }, { nombre: "x.gif", bytes: Uint8Array.from([0x47, 0x49, 0x46, 0x38]) })).rejects.toThrow(/PNG o JPG/);
    await expect(sql`UPDATE empresas SET nif = 'B99999999' WHERE id = ${emp}`).rejects.toThrow(/no se pueden cambiar/);
    await expect(sql`DELETE FROM empresas WHERE id = ${emp}`).rejects.toThrow();
  });
});
