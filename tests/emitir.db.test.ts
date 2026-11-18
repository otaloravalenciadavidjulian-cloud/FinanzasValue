import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { execSync } from "node:child_process";
import { comprobarRolSeguro, enEmpresa } from "@/db/cliente";
import { anularFactura, emitirFactura } from "@/lib/facturacion/emitir";
import { verificarCadena } from "@/lib/verifactu/huella";
import { cargarFacturaPDF } from "@/lib/facturacion/documento";
import { generarFacturaPDF } from "@/lib/facturacion/pdf";
import { cargarRegistros } from "@/lib/verifactu/registros";
import { documentoXML } from "@/lib/verifactu/xml";
import { hayXmllint, validarContraXSD } from "./xsd";

/** Tests contra PostgreSQL real. Se omiten si no hay DATABASE_URL_TEST. */
const URL_TEST = process.env.DATABASE_URL_TEST;
const d = URL_TEST ? describe : describe.skip;

d("emisión de facturas en PostgreSQL", () => {
  const sql = postgres(URL_TEST ?? "", { max: 8, onnotice: () => {} });
  let empA = "", empB = "", cliA = "";
  const ctx = () => ({ empresaId: empA, hoy: "2026-11-17", ahora: new Date("2026-11-17T09:00:00Z") });
  const linea = { concepto: "Consultoría", cantidad: 2, precioUnitarioCent: 50000, tipoIva: 21 };

  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    execSync("npx tsx scripts/migrate.ts", { env: { ...process.env, DATABASE_URL: URL_TEST }, stdio: "pipe" });
  });
  afterAll(async () => { await sql.end(); });

  beforeEach(async () => {
    [{ id: empA }] = await sql`INSERT INTO empresas (razon_social, nif, domicilio, codigo_postal, municipio, provincia)
      VALUES ('Empresa A', ${"B" + Math.floor(Math.random() * 1e8)}, 'C/ Mayor 1', '28013', 'Madrid', 'Madrid') RETURNING id`;
    [{ id: empB }] = await sql`INSERT INTO empresas (razon_social, nif, domicilio, codigo_postal, municipio, provincia)
      VALUES ('Empresa B', ${"B" + Math.floor(Math.random() * 1e8)}, 'C/ Mayor 2', '28013', 'Madrid', 'Madrid') RETURNING id`;
    for (const e of [empA, empB]) {
      await enEmpresa(sql, e, async (tx) => {
        await tx`INSERT INTO series (empresa_id, codigo, descripcion, tipo_factura, ejercicio) VALUES
          (${e}, 'A', 'Ordinarias', 'F1', 2026), (${e}, 'R', 'Rectificativas', 'R1', 2026)`;
      });
    }
    cliA = await enEmpresa(sql, empA, async (tx) => {
      const [c] = await tx`INSERT INTO terceros (empresa_id, es_cliente, razon_social, nif) VALUES (${empA}, true, 'Cliente S.L.', 'B12345674') RETURNING id`;
      return c.id as string;
    });
  });

  it("numera correlativamente y encadena las huellas", async () => {
    const f1 = await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cliA, fechaExpedicion: "2026-11-17", lineas: [linea] });
    const f2 = await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cliA, fechaExpedicion: "2026-11-17", lineas: [linea] });
    expect(f1.numSerie).toBe("A-2026-00001");
    expect(f2.numSerie).toBe("A-2026-00002");
    expect(f1.huellaAnterior).toBeNull();
    expect(f2.huellaAnterior).toBe(f1.huella);
    expect(f1.totales.totalCent).toBe(121000);
  });

  it("mantiene la cadena íntegra con emisiones simultáneas", async () => {
    const res = await Promise.all(Array.from({ length: 12 }, () =>
      emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cliA, fechaExpedicion: "2026-11-17", lineas: [linea] })));
    expect(new Set(res.map((r) => r.numSerie)).size).toBe(12);
    const regs = await enEmpresa(sql, empA, (tx) => tx<{ cadena: string; huella: string; huellaAnterior: string | null }[]>`
      SELECT cadena, huella, huella_anterior AS "huellaAnterior" FROM registros_facturacion ORDER BY secuencia`);
    expect(regs).toHaveLength(12);
    expect(verificarCadena(regs)).toEqual({ ok: true });
  });

  it("no permite modificar ni borrar facturas ni registros", async () => {
    const f = await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cliA, fechaExpedicion: "2026-11-17", lineas: [linea] });
    await expect(enEmpresa(sql, empA, (tx) => tx`UPDATE facturas SET total_cent = 1 WHERE id = ${f.id}`)).rejects.toThrow(/no se puede modificar|check constraint/);
    await expect(enEmpresa(sql, empA, (tx) => tx`DELETE FROM facturas WHERE id = ${f.id}`)).rejects.toThrow(/no se puede borrar/);
    await expect(enEmpresa(sql, empA, (tx) => tx`UPDATE registros_facturacion SET huella = huella`)).rejects.toThrow(/inalterable/);
    await expect(enEmpresa(sql, empA, (tx) => tx`DELETE FROM lineas_factura`)).rejects.toThrow(/inalterable/);
    await expect(sql`TRUNCATE registros_facturacion CASCADE`).rejects.toThrow(/inalterable/);
  });

  it("no consume número si la emisión falla", async () => {
    await expect(emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cliA, fechaExpedicion: "2026-11-17", lineas: [{ ...linea, tipoIva: 18 }] })).rejects.toThrow();
    const f = await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cliA, fechaExpedicion: "2026-11-17", lineas: [linea] });
    expect(f.numSerie).toBe("A-2026-00001");
  });

  it("rechaza fechas futuras y fechas anteriores a la última de la serie", async () => {
    await expect(emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cliA, fechaExpedicion: "2026-11-18", lineas: [linea] })).rejects.toThrow(/futura/);
    await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cliA, fechaExpedicion: "2026-11-17", lineas: [linea] });
    await expect(emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cliA, fechaExpedicion: "2026-11-10", lineas: [linea] })).rejects.toThrow(/orden de fechas/);
  });

  it("emite rectificativas enlazadas y anula con registro encadenado", async () => {
    const f = await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cliA, fechaExpedicion: "2026-11-17", lineas: [linea] });
    await expect(emitirFactura(sql, ctx(), { serieCodigo: "R", clienteId: cliA, fechaExpedicion: "2026-11-17", lineas: [linea] })).rejects.toThrow(/debe indicar/);
    const r = await emitirFactura(sql, ctx(), { serieCodigo: "R", clienteId: cliA, fechaExpedicion: "2026-11-17", rectificaId: f.id, motivoRectificacion: "Precio erróneo", lineas: [{ ...linea, cantidad: -1 }] });
    expect(r.totales.totalCent).toBe(-60500);
    const anul = await anularFactura(sql, ctx(), r.id, "Emitida por error");
    expect(anul.huellaAnterior).toBe(r.huella);
    await expect(anularFactura(sql, ctx(), r.id, "otra vez")).rejects.toThrow(/ya está anulada/);
    await expect(enEmpresa(sql, empA, (tx) => tx`UPDATE facturas SET anulada = false WHERE id = ${r.id}`)).rejects.toThrow(/vigente/);
  });

  it("sin VERI*FACTU activado la factura sale sin QR y su registro no se remite, pero la cadena sigue", async () => {
    const f = await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cliA, fechaExpedicion: "2026-11-17", lineas: [linea] });
    const d = await enEmpresa(sql, empA, (tx) => cargarFacturaPDF(tx, f.id, "pruebas"));
    expect(d?.urlQR).toBeNull();
    expect(d?.entornoPruebas).toBe(false);
    expect((await PDFDocument.load(await generarFacturaPDF(d!))).getPageCount()).toBe(1);
    await sql`UPDATE empresas SET verifactu_activo = true WHERE id = ${empA}`;
    const g = await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cliA, fechaExpedicion: "2026-11-17", lineas: [linea] });
    expect(g.huellaAnterior).toBe(f.huella);
    expect((await enEmpresa(sql, empA, (tx) => cargarFacturaPDF(tx, g.id, "pruebas")))?.urlQR).toContain("numserie=");
    expect((await enEmpresa(sql, empA, (tx) => cargarFacturaPDF(tx, f.id, "pruebas")))?.urlQR).toBeNull();
    const envios = await enEmpresa(sql, empA, (tx) => tx`SELECT r.num_serie FROM envios_aeat e JOIN registros_facturacion r ON r.id = e.registro_id`);
    expect(envios.map((e) => e.num_serie)).toEqual([g.numSerie]);
  });

  it("genera desde lo guardado el XML de la AEAT y el PDF de cada factura", async () => {
    await sql`UPDATE empresas SET verifactu_activo = true WHERE id = ${empA}`;
    const f1 = await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cliA, fechaExpedicion: "2026-11-17", retencionPct: 15,
      lineas: [linea, { concepto: "Libros", cantidad: 1, precioUnitarioCent: 5000, tipoIva: 4 }] });
    const r = await emitirFactura(sql, ctx(), { serieCodigo: "R", clienteId: cliA, fechaExpedicion: "2026-11-17", rectificaId: f1.id,
      tipoRectificacion: "S", motivoRectificacion: "Precio erróneo", lineas: [{ ...linea, precioUnitarioCent: 45000 }] });
    await anularFactura(sql, ctx(), f1.id, "Duplicada");

    const registros = await enEmpresa(sql, empA, (tx) => cargarRegistros(tx, {}));
    expect(registros.map((x) => x.datos.tipo)).toEqual(["alta", "alta", "anulacion"]);
    expect(registros[0].datos.anterior).toBeNull();
    expect(registros[2].datos.anterior?.huella).toBe(r.huella);
    const alta = registros[0].datos;
    // La retención no se descuenta del importe total del registro.
    expect(alta.tipo === "alta" && alta.importeTotalCent).toBe(100000 + 21000 + 5000 + 200);
    const rect = registros[1].datos;
    expect(rect.tipo === "alta" && rect.rectificacion).toMatchObject({ tipo: "S", baseRectificadaCent: 105000, cuotaRectificadaCent: 21200 });

    const xml = documentoXML(alta.emisor, registros.map((x) => x.datos));
    if (hayXmllint) expect(validarContraXSD(xml)).toBeNull();

    // RLS: otra empresa no ve los registros.
    expect(await enEmpresa(sql, empB, (tx) => cargarRegistros(tx, { facturaId: f1.id }))).toHaveLength(0);

    const datosPDF = await enEmpresa(sql, empA, (tx) => cargarFacturaPDF(tx, r.id, "pruebas"));
    expect(datosPDF?.rectifica?.numSerie).toBe(f1.numSerie);
    expect(datosPDF?.urlQR).toContain("importe=1089.00");
    const pdf = await generarFacturaPDF(datosPDF!);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    expect((await enEmpresa(sql, empA, (tx) => cargarFacturaPDF(tx, f1.id)))?.anulada).toBe(true);
  });

  it("abre la serie del ejercicio siguiente con numeración desde 1", async () => {
    const f = await emitirFactura(sql, { empresaId: empA, hoy: "2027-01-02", ahora: new Date("2027-01-02T09:00:00Z") },
      { serieCodigo: "A", clienteId: cliA, fechaExpedicion: "2027-01-02", lineas: [linea] });
    expect(f.numSerie).toBe("A-2027-00001");
  });

  it("se niega a trabajar con un superusuario", async () => {
    await expect(comprobarRolSeguro(sql)).resolves.toBeUndefined();
    const [{ rolsuper }] = await sql`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`;
    expect(rolsuper).toBe(false);
  });

  it("aísla los datos entre empresas", async () => {
    await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cliA, fechaExpedicion: "2026-11-17", lineas: [linea] });
    const vistasB = await enEmpresa(sql, empB, (tx) => tx`SELECT count(*)::int AS n FROM facturas`);
    expect(vistasB[0].n).toBe(0);
    const sinContexto = await sql`SELECT count(*)::int AS n FROM facturas`;
    expect(sinContexto[0].n).toBe(0);
    await expect(enEmpresa(sql, empB, (tx) => tx`INSERT INTO terceros (empresa_id, es_cliente, razon_social, nif) VALUES (${empA}, true, 'Intruso', 'X')`)).rejects.toThrow(/row-level security/);
    await expect(emitirFactura(sql, { ...ctx(), empresaId: empB }, { serieCodigo: "A", clienteId: cliA, fechaExpedicion: "2026-11-17", lineas: [linea] })).rejects.toThrow(/Cliente no encontrado/);
  });
});
