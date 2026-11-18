import { z } from "zod";
import { enEmpresa, type Sql } from "@/db/cliente";
import { hoyMadrid, validarImporteCobro } from "./estado";

export class ErrorCobro extends Error {}

const movimiento = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida"),
  importeCent: z.number().int(),
  metodo: z.string().trim().min(1, "Indica el método"),
  notas: z.string().trim().optional(),
});
export type Movimiento = z.input<typeof movimiento>;

interface Contexto { empresaId: string; usuarioId?: string; hoy?: string }

/** Registra un cobro de una factura emitida. Bloquea la factura para que dos cobros simultáneos no superen el total. */
export async function registrarCobro(sql: Sql, ctx: Contexto, facturaId: string, entrada: Movimiento) {
  const m = movimiento.parse(entrada);
  if (m.fecha > (ctx.hoy ?? hoyMadrid())) throw new ErrorCobro("La fecha del cobro no puede ser futura");
  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    const [f] = await tx<{ total_cent: string; anulada: boolean; num_serie: string }[]>`
      SELECT total_cent, anulada, num_serie FROM facturas WHERE id = ${facturaId} FOR UPDATE`;
    if (!f) throw new ErrorCobro("Factura no encontrada");
    if (f.anulada) throw new ErrorCobro("No se pueden registrar cobros de una factura anulada");
    const [{ cobrado }] = await tx<{ cobrado: string }[]>`SELECT coalesce(sum(importe_cent), 0) AS cobrado FROM cobros WHERE factura_id = ${facturaId}`;
    const error = validarImporteCobro(Number(f.total_cent), Number(cobrado), m.importeCent);
    if (error) throw new ErrorCobro(error);
    const [c] = await tx<{ id: string }[]>`
      INSERT INTO cobros (empresa_id, factura_id, fecha, importe_cent, metodo, notas, registrado_por)
      VALUES (${ctx.empresaId}, ${facturaId}, ${m.fecha}, ${m.importeCent}, ${m.metodo}, ${m.notas || null}, ${ctx.usuarioId ?? null})
      RETURNING id`;
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
      VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, 'registrar_cobro', 'factura', ${facturaId}, ${tx.json({ cobro: c.id, importeCent: m.importeCent, fecha: m.fecha })})`;
    return { id: c.id, cobradoCent: Number(cobrado) + m.importeCent, totalCent: Number(f.total_cent) };
  });
}

/** Registra un pago de una factura recibida, con las mismas reglas que los cobros. */
export async function registrarPago(sql: Sql, ctx: Contexto, gastoId: string, entrada: Movimiento) {
  const m = movimiento.parse(entrada);
  if (m.fecha > (ctx.hoy ?? hoyMadrid())) throw new ErrorCobro("La fecha del pago no puede ser futura");
  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    const [g] = await tx<{ total_cent: string; borrado_en: Date | null }[]>`
      SELECT total_cent, borrado_en FROM gastos WHERE id = ${gastoId} FOR UPDATE`;
    if (!g) throw new ErrorCobro("Gasto no encontrado");
    if (g.borrado_en) throw new ErrorCobro("El gasto está en la papelera");
    const [{ pagado }] = await tx<{ pagado: string }[]>`SELECT coalesce(sum(importe_cent), 0) AS pagado FROM pagos WHERE gasto_id = ${gastoId}`;
    const error = validarImporteCobro(Number(g.total_cent), Number(pagado), m.importeCent);
    if (error) throw new ErrorCobro(error);
    const [p] = await tx<{ id: string }[]>`
      INSERT INTO pagos (empresa_id, gasto_id, fecha, importe_cent, metodo, notas, registrado_por)
      VALUES (${ctx.empresaId}, ${gastoId}, ${m.fecha}, ${m.importeCent}, ${m.metodo}, ${m.notas || null}, ${ctx.usuarioId ?? null})
      RETURNING id`;
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
      VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, 'registrar_pago', 'gasto', ${gastoId}, ${tx.json({ pago: p.id, importeCent: m.importeCent, fecha: m.fecha })})`;
    return { id: p.id, pagadoCent: Number(pagado) + m.importeCent, totalCent: Number(g.total_cent) };
  });
}
