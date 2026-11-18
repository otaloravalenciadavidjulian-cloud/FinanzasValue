import { enEmpresa, type Sql, type Tx } from "@/db/cliente";
import { CATEGORIAS_GASTO } from "@/lib/gastos/categorias";

/**
 * Presupuesto anual: un importe sin IVA por partida y mes. Las partidas son los ingresos (base de
 * las facturas emitidas) y cada categoría de gasto (base más IVA no deducible, como en rentabilidad).
 */

export const PARTIDAS = [{ codigo: "ingresos", nombre: "Ingresos (facturación sin IVA)" }, ...CATEGORIAS_GASTO.map((c) => ({ codigo: c.codigo, nombre: c.nombre }))];
const CODIGOS = new Set(PARTIDAS.map((p) => p.codigo));
export type Valores = Record<string, number[]>; // partida → 12 importes en céntimos

export class ErrorPresupuesto extends Error {}

const vacio = (): Valores => Object.fromEntries(PARTIDAS.map((p) => [p.codigo, Array(12).fill(0)]));

export async function leerPresupuesto(tx: Tx, ejercicio: number): Promise<Valores> {
  const v = vacio();
  const filas = await tx<{ partida: string; mes: number; importe_cent: string }[]>`
    SELECT partida, mes, importe_cent FROM presupuestos WHERE ejercicio = ${ejercicio}`;
  for (const f of filas) if (v[f.partida]) v[f.partida][f.mes - 1] = Number(f.importe_cent);
  return v;
}

/** Guarda los importes indicados (las partidas que no vienen no se tocan) y audita lo que cambia. */
export async function guardarPresupuesto(sql: Sql, ctx: { empresaId: string; usuarioId?: string }, ejercicio: number, valores: Valores) {
  if (!Number.isInteger(ejercicio) || ejercicio < 2000 || ejercicio > 2100) throw new ErrorPresupuesto("Ejercicio no válido");
  for (const [partida, meses] of Object.entries(valores)) {
    if (!CODIGOS.has(partida)) throw new ErrorPresupuesto(`Partida desconocida: ${partida}`);
    if (meses.length !== 12 || meses.some((m) => !Number.isSafeInteger(m) || m < 0)) throw new ErrorPresupuesto("Los importes deben ser positivos o cero");
  }
  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${"presupuesto:" + ejercicio}))`;
    const antes = await leerPresupuesto(tx, ejercicio);
    const cambios: { partida: string; mes: number; antes: number; despues: number }[] = [];
    for (const [partida, meses] of Object.entries(valores)) {
      meses.forEach((importe, i) => { if (antes[partida][i] !== importe) cambios.push({ partida, mes: i + 1, antes: antes[partida][i], despues: importe }); });
    }
    for (const c of cambios) {
      await tx`INSERT INTO presupuestos (empresa_id, ejercicio, partida, mes, importe_cent, actualizado_por)
        VALUES (${ctx.empresaId}, ${ejercicio}, ${c.partida}, ${c.mes}, ${c.despues}, ${ctx.usuarioId ?? null})
        ON CONFLICT (empresa_id, ejercicio, partida, mes) DO UPDATE SET importe_cent = EXCLUDED.importe_cent,
          actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`;
    }
    if (cambios.length) {
      await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
        VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, 'editar_presupuesto', 'presupuesto', null, ${tx.json({ ejercicio, cambios })})`;
    }
    return { cambios: cambios.length };
  });
}

const COSTE_GASTO = "g.base_cent + g.cuota_iva_cent - g.cuota_deducible_cent";

/** Lo real de un ejercicio por partida y mes, con el mismo criterio que el informe de rentabilidad. */
export async function realPorPartida(tx: Tx, ejercicio: number): Promise<Valores> {
  const v = vacio();
  const ing = await tx<{ mes: number; v: string }[]>`
    SELECT extract(month FROM fecha_expedicion)::int AS mes, sum(base_cent) AS v FROM facturas
    WHERE NOT anulada AND extract(year FROM fecha_expedicion) = ${ejercicio} GROUP BY 1`;
  for (const r of ing) v.ingresos[r.mes - 1] = Number(r.v);
  const gas = await tx<{ categoria: string; mes: number; v: string }[]>`
    SELECT g.categoria, extract(month FROM g.fecha_expedicion)::int AS mes, sum(${tx.unsafe(COSTE_GASTO)}) AS v FROM gastos g
    WHERE g.borrado_en IS NULL AND extract(year FROM g.fecha_expedicion) = ${ejercicio} GROUP BY 1, 2`;
  for (const r of gas) if (v[r.categoria]) v[r.categoria][r.mes - 1] = Number(r.v);
  return v;
}

/** Propuesta a partir de lo real de otro ejercicio, con un ajuste en %, redondeada a euros. */
export function proponerDesdeReal(real: Valores, ajustePct: number): Valores {
  return Object.fromEntries(Object.entries(real).map(([p, meses]) => [p, meses.map((m) => Math.round((m * (1 + ajustePct / 100)) / 100) * 100)]));
}

export interface Comparacion {
  partida: string; nombre: string; esIngreso: boolean;
  presupuestoCent: number; realCent: number; desviacionCent: number; ejecucionPct: number | null;
  presupuestoAnualCent: number; desfavorable: boolean;
}

/**
 * Compara presupuesto y real hasta el mes `hastaMes` (incluido). Una desviación es desfavorable si
 * se ingresa menos o se gasta más de lo previsto.
 */
export function comparar(presupuesto: Valores, real: Valores, hastaMes: number): { filas: Comparacion[]; resultado: { presupuestoCent: number; realCent: number } } {
  const suma = (a: number[], n = 12) => a.slice(0, n).reduce((s, x) => s + x, 0);
  const filas = PARTIDAS.map((p) => {
    const pres = suma(presupuesto[p.codigo], hastaMes), r = suma(real[p.codigo], hastaMes);
    const esIngreso = p.codigo === "ingresos";
    return {
      partida: p.codigo, nombre: p.nombre, esIngreso,
      presupuestoCent: pres, realCent: r, desviacionCent: r - pres,
      ejecucionPct: pres > 0 ? Math.round((r / pres) * 1000) / 10 : null,
      presupuestoAnualCent: suma(presupuesto[p.codigo]),
      desfavorable: esIngreso ? r < pres : r > pres,
    };
  }).filter((f) => f.esIngreso || f.presupuestoAnualCent || f.realCent);
  const res = (k: "presupuestoCent" | "realCent") => filas.reduce((s, f) => s + (f.esIngreso ? f[k] : -f[k]), 0);
  return { filas, resultado: { presupuestoCent: res("presupuestoCent"), realCent: res("realCent") } };
}
