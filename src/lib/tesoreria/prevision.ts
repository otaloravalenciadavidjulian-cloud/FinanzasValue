import type { Tx } from "@/db/cliente";

/**
 * Previsión de tesorería por semanas: parte del saldo en bancos y suma los cobros pendientes y resta
 * los pagos pendientes según su vencimiento. Lo vencido y no cobrado o pagado se cuenta en la primera
 * semana y se señala aparte, porque es lo menos seguro. Los pagos recurrentes sin factura (nóminas,
 * Seguridad Social, préstamos, impuestos) se estiman con la media de los últimos 90 días conciliados.
 */

export interface Vencimiento { fecha: string; importeCent: number; vencido: boolean }

export interface Semana {
  desde: string;
  hasta: string;
  cobrosCent: number;
  pagosCent: number;
  recurrentesCent: number;
  saldoFinalCent: number;
}

export interface Prevision {
  saldoInicialCent: number;
  semanas: Semana[];
  cobrosVencidosCent: number;
  pagosVencidosCent: number;
  recurrenteMensualCent: number;
  /** Primera semana en que el saldo previsto queda por debajo de cero. */
  primeraSemanaNegativa: Semana | null;
  saldoMinimoCent: number;
}

const sumarDias = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Cálculo puro, sin base de datos. */
export function calcularPrevision(p: { hoy: string; saldoInicialCent: number; cobros: Vencimiento[]; pagos: Vencimiento[]; recurrenteMensualCent: number; semanas?: number }): Prevision {
  const n = p.semanas ?? 13;
  const semanal = Math.round((p.recurrenteMensualCent * 12) / 52);
  let saldo = p.saldoInicialCent;
  const semanas: Semana[] = [];
  for (let i = 0; i < n; i++) {
    const desde = sumarDias(p.hoy, i * 7), hasta = sumarDias(p.hoy, i * 7 + 6);
    // Lo vencido entra en la primera semana.
    const dentro = (v: Vencimiento) => (i === 0 ? v.fecha <= hasta : v.fecha >= desde && v.fecha <= hasta);
    const cobrosCent = p.cobros.filter(dentro).reduce((s, v) => s + v.importeCent, 0);
    const pagosCent = p.pagos.filter(dentro).reduce((s, v) => s + v.importeCent, 0);
    saldo += cobrosCent - pagosCent - semanal;
    semanas.push({ desde, hasta, cobrosCent, pagosCent, recurrentesCent: semanal, saldoFinalCent: saldo });
  }
  const vencido = (vs: Vencimiento[]) => vs.filter((v) => v.vencido).reduce((s, v) => s + v.importeCent, 0);
  return {
    saldoInicialCent: p.saldoInicialCent,
    semanas,
    cobrosVencidosCent: vencido(p.cobros),
    pagosVencidosCent: vencido(p.pagos),
    recurrenteMensualCent: p.recurrenteMensualCent,
    primeraSemanaNegativa: semanas.find((s) => s.saldoFinalCent < 0) ?? null,
    saldoMinimoCent: Math.min(p.saldoInicialCent, ...semanas.map((s) => s.saldoFinalCent)),
  };
}

/** Categorías de movimientos sin factura que se repiten cada mes. */
const RECURRENTES = ["nominas", "seguridad_social", "prestamo", "impuestos"];

/** Carga los datos de la empresa de la sesión (dentro de enEmpresa) y calcula la previsión. */
export async function cargarPrevision(tx: Tx, hoy: string, semanas = 13): Promise<Prevision> {
  const [{ saldo }] = await tx<{ saldo: string }[]>`
    SELECT coalesce(sum(c.saldo_inicial_cent + coalesce((SELECT sum(importe_cent) FROM movimientos_bancarios m WHERE m.cuenta_id = c.id), 0)), 0) AS saldo
    FROM cuentas_bancarias c WHERE c.activa`;
  // Sin vencimiento, se usan los días de pago del tercero (30 por defecto) desde la fecha de la factura.
  const cobros = await tx<{ fecha: string; pendiente: string }[]>`
    SELECT to_char(coalesce(f.vencimiento, f.fecha_expedicion + coalesce(t.dias_pago, 30)),'YYYY-MM-DD') AS fecha,
           f.total_cent - coalesce((SELECT sum(importe_cent) FROM cobros c WHERE c.factura_id = f.id), 0) AS pendiente
    FROM facturas f LEFT JOIN terceros t ON t.id = f.cliente_id WHERE NOT f.anulada`;
  const pagos = await tx<{ fecha: string; pendiente: string }[]>`
    SELECT to_char(coalesce(g.vencimiento, g.fecha_expedicion + coalesce(t.dias_pago, 30)),'YYYY-MM-DD') AS fecha,
           g.total_cent - coalesce((SELECT sum(importe_cent) FROM pagos p WHERE p.gasto_id = g.id), 0) AS pendiente
    FROM gastos g LEFT JOIN terceros t ON t.id = g.proveedor_id WHERE g.borrado_en IS NULL`;
  const [{ recurrente }] = await tx<{ recurrente: string }[]>`
    SELECT coalesce(-sum(m.importe_cent), 0) / 3 AS recurrente
    FROM conciliaciones k JOIN movimientos_bancarios m ON m.id = k.movimiento_id
    WHERE k.deshecha_en IS NULL AND k.tipo = 'otro' AND k.categoria = ANY(${RECURRENTES}) AND m.importe_cent < 0
      AND m.fecha_operacion > ${hoy}::date - 90 AND m.fecha_operacion <= ${hoy}::date`;
  const aVenc = (filas: { fecha: string; pendiente: string }[]) => filas
    .map((f) => ({ fecha: f.fecha, importeCent: Number(f.pendiente), vencido: f.fecha < hoy }))
    .filter((v) => v.importeCent > 0);
  return calcularPrevision({ hoy, saldoInicialCent: Number(saldo), cobros: aVenc(cobros), pagos: aVenc(pagos), recurrenteMensualCent: Math.round(Number(recurrente)), semanas });
}
