import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { execSync } from "node:child_process";
import { enEmpresa } from "@/db/cliente";
import { emitirFactura } from "@/lib/facturacion/emitir";
import { borrarFacturasDePrueba } from "@/lib/facturacion/pruebas";
import { registrarCobro } from "@/lib/cobros/registrar";
import { altaTercero } from "@/lib/terceros/alta";

const URL_TEST = process.env.DATABASE_URL_TEST;
const d = URL_TEST ? describe : describe.skip;

d("borrado de facturas de prueba en PostgreSQL", () => {
  const sql = postgres(URL_TEST ?? "", { max: 8, onnotice: () => {} });
  let emp = "", otra = "";
  const ctx = () => ({ empresaId: emp, hoy: "2026-11-18", ahora: new Date("2026-11-18T09:00:00Z") });
  const empresa = async () => {
    const [{ id }] = await sql`INSERT INTO empresas (razon_social, nif, domicilio, codigo_postal, municipio, provincia)
      VALUES ('Empresa', ${"B" + Math.floor(Math.random() * 1e8)}, 'C/ Mayor 1', '28013', 'Madrid', 'Madrid') RETURNING id`;
    await enEmpresa(sql, id, (tx) => tx`INSERT INTO series (empresa_id, codigo, descripcion, tipo_factura, ejercicio) VALUES (${id}, 'A', 'Ordinarias', 'F1', 2026)`);
    return id as string;
  };
  const emitir = async (empresaId: string) => {
    const cli = (await altaTercero(sql, { empresaId }, "cliente", { razonSocial: "Cliente S.L.", nif: "B12345674" }).catch(() => null))?.id
      ?? (await enEmpresa(sql, empresaId, (tx) => tx`SELECT id FROM terceros LIMIT 1`))[0].id;
    return emitirFactura(sql, { ...ctx(), empresaId }, { serieCodigo: "A", clienteId: cli, fechaExpedicion: "2026-11-18",
      lineas: [{ concepto: "X", cantidad: 1, precioUnitarioCent: 10000, tipoIva: 21 }] });
  };

  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    execSync("npx tsx scripts/migrate.ts", { env: { ...process.env, DATABASE_URL: URL_TEST }, stdio: "pipe" });
    emp = await empresa();
    otra = await empresa();
  });
  afterAll(async () => { await sql.end(); });

  it("sin activar el borrado, una factura sigue sin poder borrarse", async () => {
    const f = await emitir(emp);
    await expect(enEmpresa(sql, emp, (tx) => tx`DELETE FROM facturas WHERE id = ${f.id}`)).rejects.toThrow(/no se puede borrar/);
  });

  it("borra las facturas de prueba de la empresa y la numeración vuelve a empezar", async () => {
    const f = await emitir(emp);
    await registrarCobro(sql, ctx(), f.id, { fecha: "2026-11-18", importeCent: 5000, metodo: "transferencia" });
    await emitir(otra);
    const r = await borrarFacturasDePrueba(sql, { empresaId: emp });
    expect(r.facturas).toBe(2);
    const cuenta = (id: string) => enEmpresa(sql, id, async (tx) => (await tx<{ n: number }[]>`
      SELECT (SELECT count(*) FROM facturas) + (SELECT count(*) FROM registros_facturacion) + (SELECT count(*) FROM cobros) AS n`)[0].n);
    expect(Number(await cuenta(emp))).toBe(0);
    expect(Number(await cuenta(otra))).toBeGreaterThan(0);
    const nueva = await emitir(emp);
    expect(nueva.numSerie).toBe("A-2026-00001");
    expect(nueva.huellaAnterior).toBeNull();
  });

  it("en producción la base de datos no permite el borrado", async () => {
    await sql`UPDATE entorno_sistema SET entorno = 'produccion'`;
    await expect(borrarFacturasDePrueba(sql, { empresaId: emp })).rejects.toThrow(/producción/);
    await expect(sql`UPDATE entorno_sistema SET entorno = 'pruebas'`).rejects.toThrow(/no vuelve/);
  });
});
