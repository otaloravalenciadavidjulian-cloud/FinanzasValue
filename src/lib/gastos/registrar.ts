import { z } from "zod";
import { enEmpresa, type Sql } from "@/db/cliente";
import { hoyMadrid } from "@/lib/cobros/estado";
import { redondear } from "@/lib/fiscal/dinero";
import { TIPOS_IVA } from "@/lib/fiscal/totales";
import { asignarBorrador, comprobarNoRepetido, ErrorDocumento } from "@/lib/documentos/almacen";
import { CODIGOS_CATEGORIA } from "./categorias";

export class ErrorGasto extends Error {}

const lineaDesglose = z.object({
  baseCent: z.number().int(),
  tipoIva: z.number().refine((n) => (TIPOS_IVA as readonly number[]).includes(n), "Tipo de IVA no admitido"),
  /** Cuota tal como figura en la factura del proveedor; si no se indica, se calcula. */
  cuotaCent: z.number().int().optional(),
  deduciblePct: z.number().min(0).max(100).default(100),
});

export const borradorGasto = z.object({
  proveedorId: z.string().uuid().optional(),
  numero: z.string().trim().max(60).optional(),
  tipoDocumento: z.enum(["factura", "factura_simplificada", "ticket", "otro"]).default("factura"),
  fechaExpedicion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida"),
  categoria: z.enum(CODIGOS_CATEGORIA, { errorMap: () => ({ message: "Elige una categoría" }) }),
  subcategoria: z.string().trim().max(80).optional(),
  proyectoId: z.string().uuid().optional(),
  descripcion: z.string().trim().min(1, "Describe el gasto").max(500),
  desglose: z.array(lineaDesglose).min(1, "Indica al menos una base imponible").max(6),
  retencionPct: z.number().min(0).max(47).default(0),
  vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  metodoPago: z.string().trim().optional(),
  notas: z.string().trim().optional(),
  /** Justificante ya subido y leído que se asigna a este gasto. */
  documentoId: z.string().uuid().optional(),
  /** El usuario ha visto los posibles duplicados y quiere guardarlo igualmente. */
  confirmarPosibleDuplicado: z.boolean().default(false),
});
export type BorradorGasto = z.input<typeof borradorGasto>;

export interface PosibleDuplicado { id: string; numero: string | null; fecha: string; totalCent: number; motivo: string }

/** Totales del gasto: cuota por tipo, parte deducible, retención y total. */
export function calcularGasto(desglose: z.infer<typeof lineaDesglose>[], retencionPct: number) {
  const lineas = desglose.map((l) => {
    const calculada = redondear((l.baseCent * l.tipoIva) / 100);
    const cuotaCent = l.cuotaCent ?? calculada;
    // Se admite la diferencia de redondeo de la factura del proveedor, pero no un error de tecleo.
    if (Math.abs(cuotaCent - calculada) > 2) {
      throw new ErrorGasto(`La cuota de IVA al ${l.tipoIva} % no corresponde a la base: debería ser unos ${(calculada / 100).toFixed(2).replace(".", ",")} €`);
    }
    return { ...l, cuotaCent, cuotaDeducibleCent: redondear((cuotaCent * l.deduciblePct) / 100) };
  });
  const baseCent = lineas.reduce((s, l) => s + l.baseCent, 0);
  const cuotaIvaCent = lineas.reduce((s, l) => s + l.cuotaCent, 0);
  const cuotaDeducibleCent = lineas.reduce((s, l) => s + l.cuotaDeducibleCent, 0);
  const retencionCent = redondear((baseCent * retencionPct) / 100);
  return { lineas, baseCent, cuotaIvaCent, cuotaDeducibleCent, retencionCent, totalCent: baseCent + cuotaIvaCent - retencionCent };
}

interface Contexto { empresaId: string; usuarioId?: string; hoy?: string }

/**
 * Registra una factura recibida o un ticket. Rechaza la misma factura del mismo proveedor y, si
 * hay gastos parecidos (mismo proveedor e importe en fechas cercanas), los devuelve sin guardar
 * hasta que el usuario confirme.
 */
export async function registrarGasto(sql: Sql, ctx: Contexto, entrada: BorradorGasto):
  Promise<{ guardado: true; id: string; totalCent: number } | { guardado: false; posiblesDuplicados: PosibleDuplicado[] }> {
  const b = borradorGasto.parse(entrada);
  if (b.fechaExpedicion > (ctx.hoy ?? hoyMadrid())) throw new ErrorGasto("La fecha del gasto no puede ser futura");
  if (b.tipoDocumento === "factura" && (!b.proveedorId || !b.numero)) {
    throw new ErrorGasto("Una factura completa necesita proveedor y número; si es un ticket, elige ese tipo");
  }
  const t = calcularGasto(b.desglose, b.retencionPct);

  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    if (b.proveedorId) {
      const [p] = await tx`SELECT id FROM terceros WHERE id = ${b.proveedorId} AND es_proveedor AND borrado_en IS NULL`;
      if (!p) throw new ErrorGasto("Proveedor no encontrado");
      // Serializa los registros del mismo proveedor para que la comprobación de duplicados sea fiable.
      await tx`SELECT pg_advisory_xact_lock(hashtext(${b.proveedorId}))`;
    }
    if (b.proveedorId && b.numero) {
      const [igual] = await tx<{ fecha: string }[]>`
        SELECT to_char(fecha_expedicion,'DD/MM/YYYY') AS fecha FROM gastos
        WHERE proveedor_id = ${b.proveedorId} AND upper(numero) = upper(${b.numero}) AND borrado_en IS NULL`;
      if (igual) throw new ErrorGasto(`La factura ${b.numero} de este proveedor ya está registrada (fecha ${igual.fecha})`);
    }
    if (!b.confirmarPosibleDuplicado) {
      const parecidos = await tx<{ id: string; numero: string | null; fecha: string; total_cent: string }[]>`
        SELECT id, numero, to_char(fecha_expedicion,'YYYY-MM-DD') AS fecha, total_cent FROM gastos
        WHERE borrado_en IS NULL AND total_cent = ${t.totalCent}
          AND abs(fecha_expedicion - ${b.fechaExpedicion}::date) <= 7
          AND (proveedor_id IS NOT DISTINCT FROM ${b.proveedorId ?? null}::uuid)
        ORDER BY fecha_expedicion DESC LIMIT 5`;
      if (parecidos.length) {
        return {
          guardado: false as const,
          posiblesDuplicados: parecidos.map((p) => ({
            id: p.id, numero: p.numero, fecha: p.fecha, totalCent: Number(p.total_cent),
            motivo: "Mismo proveedor e importe con menos de 7 días de diferencia",
          })),
        };
      }
    }

    const [g] = await tx<{ id: string }[]>`
      INSERT INTO gastos (empresa_id, proveedor_id, numero, tipo_documento, fecha_expedicion, categoria, subcategoria, proyecto_id, descripcion,
        base_cent, cuota_iva_cent, cuota_deducible_cent, retencion_pct, retencion_cent, total_cent, vencimiento, metodo_pago, notas, creado_por)
      VALUES (${ctx.empresaId}, ${b.proveedorId ?? null}, ${b.numero || null}, ${b.tipoDocumento}, ${b.fechaExpedicion}, ${b.categoria},
        ${b.subcategoria || null}, ${b.proyectoId ?? null}, ${b.descripcion}, ${t.baseCent}, ${t.cuotaIvaCent}, ${t.cuotaDeducibleCent},
        ${b.retencionPct}, ${t.retencionCent}, ${t.totalCent}, ${b.vencimiento ?? null}, ${b.metodoPago || null}, ${b.notas || null}, ${ctx.usuarioId ?? null})
      RETURNING id`;
    for (const l of t.lineas) {
      await tx`INSERT INTO desglose_gasto (empresa_id, gasto_id, tipo_iva, base_cent, cuota_cent, deducible_pct, cuota_deducible_cent)
        VALUES (${ctx.empresaId}, ${g.id}, ${l.tipoIva}, ${l.baseCent}, ${l.cuotaCent}, ${l.deduciblePct}, ${l.cuotaDeducibleCent})`;
    }
    if (b.documentoId) await asignarBorrador(tx, ctx, b.documentoId, g.id);
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
      VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, 'registrar_gasto', 'gasto', ${g.id},
        ${tx.json({ numero: b.numero ?? null, totalCent: t.totalCent, categoria: b.categoria, posibleDuplicadoConfirmado: b.confirmarPosibleDuplicado })})`;
    return { guardado: true as const, id: g.id, totalCent: t.totalCent };
  });
}

/** Mueve un gasto a la papelera. No se borra nunca: queda con su motivo y la auditoría. */
export async function moverGastoAPapelera(sql: Sql, ctx: Contexto, gastoId: string, motivo: string) {
  if (!motivo.trim()) throw new ErrorGasto("Indica el motivo");
  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    const [g] = await tx<{ borrado_en: Date | null }[]>`SELECT borrado_en FROM gastos WHERE id = ${gastoId} FOR UPDATE`;
    if (!g) throw new ErrorGasto("Gasto no encontrado");
    if (g.borrado_en) throw new ErrorGasto("El gasto ya está en la papelera");
    const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM pagos WHERE gasto_id = ${gastoId}`;
    if (n > 0) throw new ErrorGasto("Tiene pagos registrados: anula primero los pagos con un movimiento de signo contrario");
    await tx`UPDATE gastos SET borrado_en = now(), borrado_por = ${ctx.usuarioId ?? null}, motivo_borrado = ${motivo.trim()}, actualizado_en = now() WHERE id = ${gastoId}`;
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
      VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, 'gasto_a_papelera', 'gasto', ${gastoId}, ${tx.json({ motivo: motivo.trim() })})`;
  });
}

/** Saca un gasto de la papelera, salvo que mientras tanto se haya registrado otra vez la misma factura. */
export async function restaurarGasto(sql: Sql, ctx: Contexto, gastoId: string) {
  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    try {
      const r = await tx`UPDATE gastos SET borrado_en = NULL, borrado_por = NULL, motivo_borrado = NULL, actualizado_en = now()
        WHERE id = ${gastoId} AND borrado_en IS NOT NULL RETURNING id`;
      if (!r.length) throw new ErrorGasto("El gasto no está en la papelera");
      const docs = await tx<{ sha256: string }[]>`SELECT sha256 FROM documentos WHERE entidad = 'gasto' AND entidad_id = ${gastoId} AND borrado_en IS NULL`;
      for (const d of docs) {
        try { await comprobarNoRepetido(tx, d.sha256, gastoId); } catch (e) {
          if (e instanceof ErrorDocumento) throw new ErrorGasto(`No se puede restaurar: ${e.message.charAt(0).toLowerCase()}${e.message.slice(1)}`);
          throw e;
        }
      }
    } catch (e) {
      if (e instanceof Error && /gastos_sin_duplicados/.test(e.message)) throw new ErrorGasto("Ya hay otro gasto activo con el mismo proveedor y número");
      throw e;
    }
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id)
      VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, 'gasto_restaurado', 'gasto', ${gastoId})`;
  });
}
