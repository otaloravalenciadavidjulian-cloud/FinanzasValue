import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { execSync } from "node:child_process";
import { enEmpresa } from "@/db/cliente";
import { cargarFacturaPDF } from "@/lib/facturacion/documento";
import { emitirFactura } from "@/lib/facturacion/emitir";
import { facturaeXML } from "@/lib/facturacion/facturae";
import { altaTercero } from "@/lib/terceros/alta";
import { hayXmllint, validarContraXSD } from "./xsd";

const URL_TEST = process.env.DATABASE_URL_TEST;
const d = URL_TEST ? describe : describe.skip;

d("Facturae desde una factura emitida", () => {
  const sql = postgres(URL_TEST ?? "", { max: 8, onnotice: () => {} });
  let emp = "";
  const ctx = () => ({ empresaId: emp, hoy: "2026-11-17", ahora: new Date("2026-11-17T09:00:00Z") });

  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    execSync("npx tsx scripts/migrate.ts", { env: { ...process.env, DATABASE_URL: URL_TEST }, stdio: "pipe" });
  });
  afterAll(async () => { await sql.end(); });
  beforeEach(async () => {
    const [{ id }] = await sql`INSERT INTO empresas (razon_social, nif, domicilio, codigo_postal, municipio, provincia, iban)
      VALUES ('Empresa', ${"B" + Math.floor(Math.random() * 1e8)}, 'C/ Mayor 1', '28013', 'Madrid', 'Madrid', 'ES9121000418450200051332') RETURNING id`;
    emp = id;
    await enEmpresa(sql, emp, (tx) => tx`INSERT INTO series (empresa_id, codigo, descripcion, tipo_factura, ejercicio) VALUES (${emp}, 'A', 'Ordinarias', 'F1', 2026)`);
  });

  it("genera un XML válido con los importes guardados", async () => {
    const cli = (await altaTercero(sql, { empresaId: emp }, "cliente", { razonSocial: "Cliente S.L.", nif: "B12345674",
      direccion: "C/ Sol 2", codigoPostal: "46001", municipio: "Valencia", provincia: "Valencia" })).id;
    const f = await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cli, fechaExpedicion: "2026-11-17", vencimiento: "2026-12-17",
      metodoCobro: "Transferencia", retencionPct: 15, lineas: [
        { concepto: "Consultoría", cantidad: 3, precioUnitarioCent: 33333, descuentoPct: 5, tipoIva: 21 },
        { concepto: "Libro", cantidad: 1, precioUnitarioCent: 2000, tipoIva: 4 }] });
    const datos = await enEmpresa(sql, emp, (tx) => cargarFacturaPDF(tx, f.id));
    const xml = facturaeXML(datos!);
    expect(xml).toContain(`<InvoiceTotal>${(datos!.totalCent / 100).toFixed(2)}</InvoiceTotal>`);
    if (hayXmllint) expect(validarContraXSD(xml, "docs/facturae/xsd/Facturaev3_2_2.xsd")).toBeNull();
  });
});
