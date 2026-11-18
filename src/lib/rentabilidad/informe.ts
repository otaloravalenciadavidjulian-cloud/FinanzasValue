import type { Tx } from "@/db/cliente";

/**
 * Rentabilidad con criterio de devengo: ingresos = base imponible de las facturas emitidas (no
 * anuladas; las rectificativas restan); gastos = base de los gastos más el IVA que no se puede
 * deducir, que también es coste. No incluye nóminas ni otros pagos sin factura.
 */

export interface Fila { clave: string; nombre: string; ingresosCent: number; gastosCent: number; margenCent: number; margenPct: number | null }

const fila = (clave: string, nombre: string, ingresos: number, gastos: number): Fila => ({
  clave, nombre, ingresosCent: ingresos, gastosCent: gastos, margenCent: ingresos - gastos,
  margenPct: ingresos > 0 ? Math.round(((ingresos - gastos) / ingresos) * 1000) / 10 : null,
});

const COSTE_GASTO = "g.base_cent + g.cuota_iva_cent - g.cuota_deducible_cent";

export async function rentabilidad(tx: Tx, desde: string, hasta: string) {
  const meses = await tx<{ mes: string; ingresos: string; gastos: string }[]>`
    WITH m AS (SELECT to_char(d, 'YYYY-MM') AS mes FROM generate_series(date_trunc('month', ${desde}::date), ${hasta}::date, interval '1 month') d)
    SELECT m.mes,
      coalesce((SELECT sum(base_cent) FROM facturas f WHERE NOT f.anulada AND to_char(f.fecha_expedicion,'YYYY-MM') = m.mes
                AND f.fecha_expedicion BETWEEN ${desde}::date AND ${hasta}::date), 0) AS ingresos,
      coalesce((SELECT sum(${tx.unsafe(COSTE_GASTO)}) FROM gastos g WHERE g.borrado_en IS NULL AND to_char(g.fecha_expedicion,'YYYY-MM') = m.mes
                AND g.fecha_expedicion BETWEEN ${desde}::date AND ${hasta}::date), 0) AS gastos
    FROM m ORDER BY m.mes`;
  const clientes = await tx<{ id: string | null; nombre: string | null; ingresos: string; gastos: string }[]>`
    WITH i AS (SELECT f.cliente_id AS id, sum(f.base_cent) AS v FROM facturas f
               WHERE NOT f.anulada AND f.fecha_expedicion BETWEEN ${desde}::date AND ${hasta}::date GROUP BY 1),
         g AS (SELECT p.cliente_id AS id, sum(${tx.unsafe(COSTE_GASTO)}) AS v FROM gastos g JOIN proyectos p ON p.id = g.proyecto_id
               WHERE g.borrado_en IS NULL AND p.cliente_id IS NOT NULL AND g.fecha_expedicion BETWEEN ${desde}::date AND ${hasta}::date GROUP BY 1)
    SELECT coalesce(i.id, g.id) AS id, t.razon_social AS nombre, coalesce(i.v, 0) AS ingresos, coalesce(g.v, 0) AS gastos
    FROM i FULL JOIN g ON g.id = i.id LEFT JOIN terceros t ON t.id = coalesce(i.id, g.id)`;
  const proyectos = await tx<{ id: string; nombre: string; ingresos: string; gastos: string }[]>`
    SELECT p.id, p.nombre,
      coalesce((SELECT sum(base_cent) FROM facturas f WHERE f.proyecto_id = p.id AND NOT f.anulada AND f.fecha_expedicion BETWEEN ${desde}::date AND ${hasta}::date), 0) AS ingresos,
      coalesce((SELECT sum(${tx.unsafe(COSTE_GASTO)}) FROM gastos g WHERE g.proyecto_id = p.id AND g.borrado_en IS NULL AND g.fecha_expedicion BETWEEN ${desde}::date AND ${hasta}::date), 0) AS gastos
    FROM proyectos p`;
  const categorias = await tx<{ categoria: string; gastos: string }[]>`
    SELECT g.categoria, sum(${tx.unsafe(COSTE_GASTO)}) AS gastos FROM gastos g
    WHERE g.borrado_en IS NULL AND g.fecha_expedicion BETWEEN ${desde}::date AND ${hasta}::date GROUP BY 1 ORDER BY 2 DESC`;

  const porMes = meses.map((m) => fila(m.mes, m.mes, Number(m.ingresos), Number(m.gastos)));
  const ingresos = porMes.reduce((s, m) => s + m.ingresosCent, 0), gastos = porMes.reduce((s, m) => s + m.gastosCent, 0);
  return {
    total: fila("total", "Total", ingresos, gastos),
    porMes,
    porCliente: clientes.map((c) => fila(c.id ?? "sin", c.nombre ?? "Sin cliente (facturas simplificadas)", Number(c.ingresos), Number(c.gastos)))
      .sort((a, b) => b.ingresosCent - a.ingresosCent),
    porProyecto: proyectos.map((p) => fila(p.id, p.nombre, Number(p.ingresos), Number(p.gastos)))
      .filter((p) => p.ingresosCent || p.gastosCent).sort((a, b) => b.margenCent - a.margenCent),
    gastosPorCategoria: categorias.map((c) => ({ categoria: c.categoria, gastosCent: Number(c.gastos), pct: gastos ? Math.round((Number(c.gastos) / gastos) * 1000) / 10 : 0 })),
  };
}
