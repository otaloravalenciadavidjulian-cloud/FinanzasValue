import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { execSync } from "node:child_process";
import { enEmpresa } from "@/db/cliente";
import { emitirFactura } from "@/lib/facturacion/emitir";
import { registrarGasto } from "@/lib/gastos/registrar";
import { ErrorPresupuesto, guardarPresupuesto, leerPresupuesto, realPorPartida } from "@/lib/presupuestos/presupuesto";
import { altaTercero } from "@/lib/terceros/alta";

const URL_TEST = process.env.DATABASE_URL_TEST;
const d = URL_TEST ? describe : describe.skip;

d("presupuestos en PostgreSQL", () => {
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

  it("guarda, corrige con auditoría, no borra y aísla por empresa", async () => {
    const meses = Array(12).fill(0); meses[0] = 100000;
    expect(await guardarPresupuesto(sql, { empresaId: emp }, 2026, { ingresos: meses })).toEqual({ cambios: 1 });
    expect(await guardarPresupuesto(sql, { empresaId: emp }, 2026, { ingresos: meses })).toEqual({ cambios: 0 });
    const m2 = [...meses]; m2[0] = 0; m2[1] = 5000;
    expect(await guardarPresupuesto(sql, { empresaId: emp }, 2026, { ingresos: m2 })).toEqual({ cambios: 2 });
    const v = await enEmpresa(sql, emp, (tx) => leerPresupuesto(tx, 2026));
    expect(v.ingresos.slice(0, 2)).toEqual([0, 5000]);
    const aud = await enEmpresa(sql, emp, (tx) => tx`SELECT despues FROM eventos_auditoria WHERE accion = 'editar_presupuesto' ORDER BY id`);
    expect(aud).toHaveLength(2);
    expect(aud[1].despues.cambios).toContainEqual({ partida: "ingresos", mes: 1, antes: 100000, despues: 0 });
    await expect(enEmpresa(sql, emp, (tx) => tx`DELETE FROM presupuestos`)).rejects.toThrow();
    await expect(guardarPresupuesto(sql, { empresaId: emp }, 2026, { inventada: meses })).rejects.toBeInstanceOf(ErrorPresupuesto);
    await expect(guardarPresupuesto(sql, { empresaId: emp }, 2026, { ingresos: [-1, ...Array(11).fill(0)] })).rejects.toBeInstanceOf(ErrorPresupuesto);
    const [{ id: otra }] = await sql`INSERT INTO empresas (razon_social, nif, domicilio, codigo_postal, municipio, provincia)
      VALUES ('Otra', ${"B" + Math.floor(Math.random() * 1e8)}, 'C/ Mayor 1', '28013', 'Madrid', 'Madrid') RETURNING id`;
    expect((await enEmpresa(sql, otra, (tx) => leerPresupuesto(tx, 2026))).ingresos[1]).toBe(0);
  });

  it("calcula lo real por partida y mes", async () => {
    const cli = (await altaTercero(sql, { empresaId: emp }, "cliente", { razonSocial: "Cliente S.L.", nif: "B12345674" })).id;
    const prov = (await altaTercero(sql, { empresaId: emp }, "proveedor", { razonSocial: "Asesoría S.L.", nif: "A58818501" })).id;
    await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cli, fechaExpedicion: "2026-03-05",
      lineas: [{ concepto: "Diseño", cantidad: 1, precioUnitarioCent: 100000, tipoIva: 21 }] });
    const g = await registrarGasto(sql, ctx(), { proveedorId: prov, numero: "AS-1", fechaExpedicion: "2026-04-20", categoria: "profesionales",
      descripcion: "Asesoría", desglose: [{ baseCent: 20000, tipoIva: 21, deduciblePct: 50 }] });
    if (!g.guardado) throw new Error();
    const r = await enEmpresa(sql, emp, (tx) => realPorPartida(tx, 2026));
    expect(r.ingresos[2]).toBe(100000);
    expect(r.profesionales[3]).toBe(22100);
  });
});
