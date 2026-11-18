import { enEmpresa, type Sql, type Tx } from "@/db/cliente";
import { ErrorCobro, registrarCobroTx, registrarPagoTx } from "@/lib/cobros/registrar";

/**
 * Conciliación bancaria: cada movimiento del banco se explica con un cobro de una factura emitida,
 * un pago de un gasto, o un concepto sin factura (comisiones, impuestos, nóminas…). Una conciliación
 * equivocada no se borra: se deshace con motivo y queda en el historial.
 */

export class ErrorConciliacion extends Error {}

export const CATEGORIAS_OTRO = {
  comisiones: "Comisiones y gastos bancarios",
  intereses: "Intereses",
  impuestos: "Impuestos (AEAT, ayuntamiento…)",
  seguridad_social: "Seguridad Social",
  nominas: "Nóminas",
  prestamo: "Cuota de préstamo o leasing",
  traspaso: "Traspaso entre cuentas propias",
  socios: "Otros movimientos con socios (sin registrar en Socios)",
  otros: "Otros",
} as const;
export type CategoriaOtro = keyof typeof CATEGORIAS_OTRO;

interface Contexto { empresaId: string; usuarioId?: string; hoy?: string }
interface Mov { id: string; importe_cent: string; fecha: string; descripcion: string; concepto_comun: string }

async function movimientoLibre(tx: Tx, id: string): Promise<Mov & { importe: number }> {
  const [m] = await tx<Mov[]>`
    SELECT id, importe_cent, to_char(fecha_operacion,'YYYY-MM-DD') AS fecha, descripcion, concepto_comun
    FROM movimientos_bancarios WHERE id = ${id} FOR UPDATE`;
  if (!m) throw new ErrorConciliacion("Movimiento no encontrado");
  const [ya] = await tx`SELECT 1 FROM conciliaciones WHERE movimiento_id = ${id} AND deshecha_en IS NULL`;
  if (ya) throw new ErrorConciliacion("Este movimiento ya está conciliado");
  return { ...m, importe: Number(m.importe_cent) };
}

async function guardar(tx: Tx, ctx: Contexto, movId: string, d: { tipo: "cobro" | "pago" | "otro" | "socio"; cobroId?: string; pagoId?: string; operacionSocioId?: string; categoria?: string; nota?: string }) {
  try {
    const [c] = await tx<{ id: string }[]>`
      INSERT INTO conciliaciones (empresa_id, movimiento_id, tipo, cobro_id, pago_id, operacion_socio_id, categoria, nota, creado_por)
      VALUES (${ctx.empresaId}, ${movId}, ${d.tipo}, ${d.cobroId ?? null}, ${d.pagoId ?? null}, ${d.operacionSocioId ?? null}, ${d.categoria ?? null}, ${d.nota?.trim() || null}, ${ctx.usuarioId ?? null})
      RETURNING id`;
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
      VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, 'conciliar', 'movimiento_bancario', ${movId}, ${tx.json({ conciliacion: c.id, ...d } as never)})`;
    return c;
  } catch (e) {
    if (e instanceof Error && /conciliacion_(cobro|pago|socio)/.test(e.message)) throw new ErrorConciliacion("Ese cobro, pago u operación ya está conciliado con otro movimiento");
    if (e instanceof Error && /conciliacion_movimiento/.test(e.message)) throw new ErrorConciliacion("Este movimiento ya está conciliado");
    throw e;
  }
}

const conErrores = async <T>(f: () => Promise<T>) => {
  try { return await f(); } catch (e) {
    if (e instanceof ErrorCobro) throw new ErrorConciliacion(e.message);
    throw e;
  }
};

/** Concilia un abono con un cobro ya registrado del mismo importe. */
export async function conciliarConCobro(sql: Sql, ctx: Contexto, movId: string, cobroId: string) {
  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    const m = await movimientoLibre(tx, movId);
    const [c] = await tx<{ importe_cent: string }[]>`SELECT importe_cent FROM cobros WHERE id = ${cobroId}`;
    if (!c) throw new ErrorConciliacion("Cobro no encontrado");
    if (Number(c.importe_cent) !== m.importe) throw new ErrorConciliacion("El importe del cobro no coincide con el del banco");
    return guardar(tx, ctx, movId, { tipo: "cobro", cobroId });
  });
}

/** Concilia un cargo con un pago ya registrado del mismo importe. */
export async function conciliarConPago(sql: Sql, ctx: Contexto, movId: string, pagoId: string) {
  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    const m = await movimientoLibre(tx, movId);
    const [p] = await tx<{ importe_cent: string }[]>`SELECT importe_cent FROM pagos WHERE id = ${pagoId}`;
    if (!p) throw new ErrorConciliacion("Pago no encontrado");
    if (Number(p.importe_cent) !== -m.importe) throw new ErrorConciliacion("El importe del pago no coincide con el del banco");
    return guardar(tx, ctx, movId, { tipo: "pago", pagoId });
  });
}

/** Concilia un movimiento con una aportación, préstamo o devolución de un socio del mismo importe. */
export async function conciliarConSocio(sql: Sql, ctx: Contexto, movId: string, operacionId: string) {
  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    const m = await movimientoLibre(tx, movId);
    const [o] = await tx<{ importe_cent: string; tipo: string }[]>`SELECT importe_cent, tipo FROM operaciones_socios WHERE id = ${operacionId} AND borrado_en IS NULL`;
    if (!o) throw new ErrorConciliacion("Operación del socio no encontrada");
    const esperado = o.tipo === "devolucion" ? -Number(o.importe_cent) : Number(o.importe_cent);
    if (esperado !== m.importe) throw new ErrorConciliacion("El importe de la operación no coincide con el del banco");
    return guardar(tx, ctx, movId, { tipo: "socio", operacionSocioId: operacionId });
  });
}

const metodo = (conceptoComun: string) => (conceptoComun === "03" ? "Domiciliación" : conceptoComun === "12" ? "Tarjeta" : "Transferencia");

/** Registra el cobro de una factura con los datos del abono del banco y lo concilia, todo a la vez. */
export async function cobrarYConciliar(sql: Sql, ctx: Contexto, movId: string, facturaId: string) {
  return conErrores(() => enEmpresa(sql, ctx.empresaId, async (tx) => {
    const m = await movimientoLibre(tx, movId);
    if (m.importe <= 0) throw new ErrorConciliacion("Un cargo no puede ser el cobro de una factura");
    const c = await registrarCobroTx(tx, ctx, facturaId, { fecha: m.fecha, importeCent: m.importe, metodo: metodo(m.concepto_comun), notas: "Desde el extracto bancario" });
    return guardar(tx, ctx, movId, { tipo: "cobro", cobroId: c.id });
  }));
}

/** Registra el pago de un gasto con los datos del cargo del banco y lo concilia, todo a la vez. */
export async function pagarYConciliar(sql: Sql, ctx: Contexto, movId: string, gastoId: string) {
  return conErrores(() => enEmpresa(sql, ctx.empresaId, async (tx) => {
    const m = await movimientoLibre(tx, movId);
    if (m.importe >= 0) throw new ErrorConciliacion("Un abono no puede ser el pago de un gasto");
    const p = await registrarPagoTx(tx, ctx, gastoId, { fecha: m.fecha, importeCent: -m.importe, metodo: metodo(m.concepto_comun), notas: "Desde el extracto bancario" });
    return guardar(tx, ctx, movId, { tipo: "pago", pagoId: p.id });
  }));
}

/** Explica un movimiento sin factura ni gasto: comisiones, impuestos, nóminas, traspasos… */
export async function conciliarOtro(sql: Sql, ctx: Contexto, movId: string, categoria: string, nota?: string) {
  if (!(categoria in CATEGORIAS_OTRO)) throw new ErrorConciliacion("Elige el tipo de movimiento");
  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    await movimientoLibre(tx, movId);
    return guardar(tx, ctx, movId, { tipo: "otro", categoria, nota });
  });
}

/** Deshace una conciliación. El cobro o pago registrado sigue existiendo: se corrige aparte. */
export async function deshacerConciliacion(sql: Sql, ctx: Contexto, movId: string, motivo: string) {
  if (!motivo.trim()) throw new ErrorConciliacion("Indica el motivo");
  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    const [c] = await tx<{ id: string }[]>`
      UPDATE conciliaciones SET deshecha_en = now(), deshecha_por = ${ctx.usuarioId ?? null}, motivo_deshacer = ${motivo.trim()}
      WHERE movimiento_id = ${movId} AND deshecha_en IS NULL RETURNING id`;
    if (!c) throw new ErrorConciliacion("El movimiento no está conciliado");
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
      VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, 'deshacer_conciliacion', 'movimiento_bancario', ${movId}, ${tx.json({ conciliacion: c.id, motivo: motivo.trim() })})`;
  });
}

export interface Sugerencia {
  tipo: "cobro" | "factura" | "pago" | "gasto" | "socio";
  id: string;
  etiqueta: string;
  importeCent: number;
  /** Más alto, más probable. */
  puntuacion: number;
}

const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** ¿Aparece el número de documento (sin separadores, al menos 3 caracteres) en el concepto del banco? */
const aparece = (texto: string, numero: string | null) => Boolean(numero && normal(numero).length >= 3 && normal(texto).includes(normal(numero)));
/** ¿Aparece alguna palabra significativa del nombre (más de 3 letras) en el concepto? */
const nombreEn = (texto: string, nombre: string | null) => {
  if (!nombre) return false;
  const t = ` ${texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()} `;
  return nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().split(/[^A-Z0-9]+/)
    .filter((p) => p.length > 3 && !["SOCIEDAD", "LIMITADA", "ANONIMA"].includes(p)).some((p) => t.includes(` ${p} `));
};
const dias = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

/**
 * Propone con qué puede conciliarse un movimiento, de más a menos probable. Se admiten facturas y
 * gastos fechados hasta 10 días después del movimiento (anticipos, tickets emitidos tras el cargo).
 */
export async function sugerencias(tx: Tx, movId: string): Promise<Sugerencia[]> {
  const [m] = await tx<Mov[]>`SELECT id, importe_cent, to_char(fecha_operacion,'YYYY-MM-DD') AS fecha, descripcion, concepto_comun FROM movimientos_bancarios WHERE id = ${movId}`;
  if (!m) return [];
  const importe = Number(m.importe_cent), abs = Math.abs(importe);
  const out: Sugerencia[] = [];
  const euros = (c: number) => (c / 100).toFixed(2).replace(".", ",") + " €";
  if (importe > 0) {
    const cobros = await tx<{ id: string; fecha: string; num_serie: string; cliente: string | null }[]>`
      SELECT c.id, to_char(c.fecha,'YYYY-MM-DD') AS fecha, f.num_serie, f.destinatario->>'razon_social' AS cliente
      FROM cobros c JOIN facturas f ON f.id = c.factura_id
      WHERE c.importe_cent = ${importe} AND abs(c.fecha - ${m.fecha}::date) <= 15
        AND NOT EXISTS (SELECT 1 FROM conciliaciones k WHERE k.cobro_id = c.id AND k.deshecha_en IS NULL)`;
    for (const c of cobros) {
      out.push({ tipo: "cobro", id: c.id, importeCent: importe, etiqueta: `Cobro ya registrado de ${c.num_serie}${c.cliente ? ` (${c.cliente})` : ""} del ${c.fecha.split("-").reverse().join("/")}`,
        puntuacion: 100 - dias(c.fecha, m.fecha) + (aparece(m.descripcion, c.num_serie) ? 30 : 0) });
    }
    const facturas = await tx<{ id: string; num_serie: string; cliente: string | null; pendiente: string; vencimiento: string | null }[]>`
      SELECT f.id, f.num_serie, f.destinatario->>'razon_social' AS cliente, to_char(f.vencimiento,'YYYY-MM-DD') AS vencimiento,
             f.total_cent - coalesce((SELECT sum(importe_cent) FROM cobros c WHERE c.factura_id = f.id), 0) AS pendiente
      FROM facturas f WHERE NOT f.anulada AND f.fecha_expedicion <= ${m.fecha}::date + 10`;
    for (const f of facturas) {
      const pendiente = Number(f.pendiente);
      if (pendiente <= 0 || abs > pendiente) continue;
      const numero = aparece(m.descripcion, f.num_serie), nombre = nombreEn(m.descripcion, f.cliente), exacto = pendiente === abs;
      if (!exacto && !numero) continue;
      out.push({ tipo: "factura", id: f.id, importeCent: pendiente,
        etiqueta: `Registrar cobro${exacto ? "" : " parcial"} de ${f.num_serie}${f.cliente ? ` (${f.cliente})` : ""}: pendiente ${euros(pendiente)}`,
        puntuacion: (exacto ? 50 : 10) + (numero ? 40 : 0) + (nombre ? 20 : 0) - (f.vencimiento ? Math.min(dias(f.vencimiento, m.fecha), 30) / 3 : 5) });
    }
  } else {
    const pagos = await tx<{ id: string; fecha: string; numero: string | null; proveedor: string | null }[]>`
      SELECT p.id, to_char(p.fecha,'YYYY-MM-DD') AS fecha, g.numero, t.razon_social AS proveedor
      FROM pagos p JOIN gastos g ON g.id = p.gasto_id LEFT JOIN terceros t ON t.id = g.proveedor_id
      WHERE p.importe_cent = ${abs} AND abs(p.fecha - ${m.fecha}::date) <= 15
        AND NOT EXISTS (SELECT 1 FROM conciliaciones k WHERE k.pago_id = p.id AND k.deshecha_en IS NULL)`;
    for (const p of pagos) {
      out.push({ tipo: "pago", id: p.id, importeCent: abs, etiqueta: `Pago ya registrado${p.numero ? ` de ${p.numero}` : ""}${p.proveedor ? ` (${p.proveedor})` : ""} del ${p.fecha.split("-").reverse().join("/")}`,
        puntuacion: 100 - dias(p.fecha, m.fecha) + (aparece(m.descripcion, p.numero) ? 30 : 0) });
    }
    const gastos = await tx<{ id: string; numero: string | null; proveedor: string | null; descripcion: string; pendiente: string; vencimiento: string | null }[]>`
      SELECT g.id, g.numero, t.razon_social AS proveedor, g.descripcion, to_char(g.vencimiento,'YYYY-MM-DD') AS vencimiento,
             g.total_cent - coalesce((SELECT sum(importe_cent) FROM pagos p WHERE p.gasto_id = g.id), 0) AS pendiente
      FROM gastos g LEFT JOIN terceros t ON t.id = g.proveedor_id WHERE g.borrado_en IS NULL AND g.fecha_expedicion <= ${m.fecha}::date + 10`;
    for (const g of gastos) {
      const pendiente = Number(g.pendiente);
      if (pendiente <= 0 || abs > pendiente) continue;
      const numero = aparece(m.descripcion, g.numero), nombre = nombreEn(m.descripcion, g.proveedor), exacto = pendiente === abs;
      if (!exacto && !numero) continue;
      out.push({ tipo: "gasto", id: g.id, importeCent: pendiente,
        etiqueta: `Registrar pago${exacto ? "" : " parcial"} de ${g.numero ?? g.descripcion}${g.proveedor ? ` (${g.proveedor})` : ""}: pendiente ${euros(pendiente)}`,
        puntuacion: (exacto ? 50 : 10) + (numero ? 40 : 0) + (nombre ? 20 : 0) - (g.vencimiento ? Math.min(dias(g.vencimiento, m.fecha), 30) / 3 : 5) });
    }
  }
  const socios = await tx<{ id: string; fecha: string; tipo: string; socio: string }[]>`
    SELECT o.id, to_char(o.fecha,'YYYY-MM-DD') AS fecha, o.tipo, s.nombre AS socio
    FROM operaciones_socios o JOIN socios s ON s.id = o.socio_id
    WHERE o.borrado_en IS NULL AND o.importe_cent = ${abs} AND abs(o.fecha - ${m.fecha}::date) <= 15
      AND (o.tipo = 'devolucion') = ${importe < 0}
      AND NOT EXISTS (SELECT 1 FROM conciliaciones k WHERE k.operacion_socio_id = o.id AND k.deshecha_en IS NULL)`;
  const nombres: Record<string, string> = { capital: "Aportación de capital", aportacion: "Aportación", prestamo: "Préstamo", devolucion: "Devolución de préstamo" };
  for (const o of socios) {
    out.push({ tipo: "socio", id: o.id, importeCent: abs, etiqueta: `${nombres[o.tipo]} de ${o.socio} del ${o.fecha.split("-").reverse().join("/")}`,
      puntuacion: 100 - dias(o.fecha, m.fecha) + (nombreEn(m.descripcion, o.socio) ? 20 : 0) });
  }
  return out.sort((a, b) => b.puntuacion - a.puntuacion).slice(0, 5);
}
