import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { execSync } from "node:child_process";
import { enEmpresa } from "@/db/cliente";
import { emitirFactura } from "@/lib/facturacion/emitir";
import { registrarGasto } from "@/lib/gastos/registrar";
import { rentabilidad } from "@/lib/rentabilidad/informe";
import { altaProyecto, cambiarEstadoProyecto, ErrorProyecto } from "@/lib/rentabilidad/proyectos";
import { altaTercero } from "@/lib/terceros/alta";

const URL_TEST = process.env.DATABASE_URL_TEST;
const d = URL_TEST ? describe : describe.skip;

d("rentabilidad en PostgreSQL", () => {
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

  it("calcula ingresos, coste y margen por mes, cliente, proyecto y categoría", async () => {
    const cli = (await altaTercero(sql, { empresaId: emp }, "cliente", { razonSocial: "Cliente S.L.", nif: "B12345674" })).id;
    const prov = (await altaTercero(sql, { empresaId: emp }, "proveedor", { razonSocial: "Asesoría S.L.", nif: "A58818501" })).id;
    const proy = (await altaProyecto(sql, { empresaId: emp }, { nombre: "Web nueva", clienteId: cli })).id;
    await expect(altaProyecto(sql, { empresaId: emp }, { nombre: "web NUEVA" })).rejects.toBeInstanceOf(ErrorProyecto);

    await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cli, proyectoId: proy, fechaExpedicion: "2026-10-05",
      lineas: [{ concepto: "Diseño", cantidad: 1, precioUnitarioCent: 100000, tipoIva: 21 }] });
    await emitirFactura(sql, ctx(), { serieCodigo: "A", clienteId: cli, fechaExpedicion: "2026-11-02",
      lineas: [{ concepto: "Mantenimiento", cantidad: 1, precioUnitarioCent: 50000, tipoIva: 21 }] });
    // 200 € + 21 % con la mitad del IVA deducible: cuesta 221 €.
    const g = await registrarGasto(sql, ctx(), { proveedorId: prov, numero: "AS-1", fechaExpedicion: "2026-10-20", categoria: "profesionales",
      proyectoId: proy, descripcion: "Asesoría", desglose: [{ baseCent: 20000, tipoIva: 21, deduciblePct: 50 }] });
    if (!g.guardado) throw new Error();

    const r = await enEmpresa(sql, emp, (tx) => rentabilidad(tx, "2026-10-01", "2026-11-30"));
    expect(r.total).toMatchObject({ ingresosCent: 150000, gastosCent: 22100, margenCent: 127900, margenPct: 85.3 });
    expect(r.porMes.map((m) => [m.clave, m.ingresosCent, m.gastosCent])).toEqual([["2026-10", 100000, 22100], ["2026-11", 50000, 0]]);
    expect(r.porCliente).toEqual([expect.objectContaining({ nombre: "Cliente S.L.", ingresosCent: 150000, gastosCent: 22100 })]);
    expect(r.porProyecto).toEqual([expect.objectContaining({ nombre: "Web nueva", ingresosCent: 100000, gastosCent: 22100, margenCent: 77900 })]);
    expect(r.gastosPorCategoria).toEqual([{ categoria: "profesionales", gastosCent: 22100, pct: 100 }]);

    await cambiarEstadoProyecto(sql, { empresaId: emp }, proy, false);
    const [p] = await enEmpresa(sql, emp, (tx) => tx`SELECT activo FROM proyectos WHERE id = ${proy}`);
    expect(p.activo).toBe(false);
  });
});
