import { z } from "zod";
import type { Sql } from "@/db/cliente";
import { enEmpresa } from "@/db/cliente";
import { CODIGOS_CAUSA } from "@/lib/fiscal/exenciones";
import { calcularTotales, TIPOS_IVA } from "@/lib/fiscal/totales";
import { cadenaAlta, cadenaAnulacion, fechaHoraHusoMadrid, huella, type TipoFacturaAEAT } from "@/lib/verifactu/huella";

const linea = z.object({
  concepto: z.string().trim().min(1, "Cada línea necesita un concepto"),
  categoria: z.string().optional(),
  cantidad: z.number().refine((n) => n !== 0, "La cantidad no puede ser cero"),
  precioUnitarioCent: z.number().int(),
  descuentoPct: z.number().min(0).max(100).default(0),
  tipoIva: z.number().refine((n) => (TIPOS_IVA as readonly number[]).includes(n), "Tipo de IVA no admitido"),
  causaIva: z.enum(CODIGOS_CAUSA).optional(),
}).refine((l) => (l.tipoIva === 0) === !!l.causaIva, "Las líneas al 0 % deben indicar si son exentas, no sujetas o con inversión del sujeto pasivo (y las demás no)");

export const borradorFactura = z.object({
  serieCodigo: z.string().regex(/^[A-Z0-9]{1,10}$/),
  clienteId: z.string().uuid().optional(),
  fechaExpedicion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fechaOperacion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  proyectoId: z.string().uuid().optional(),
  retencionPct: z.number().min(0).max(47).default(0),
  metodoCobro: z.string().optional(),
  condicionesPago: z.string().optional(),
  observaciones: z.string().optional(),
  referencia: z.string().trim().max(100).optional(),
  rectificaId: z.string().uuid().optional(),
  tipoRectificacion: z.enum(["S", "I"]).optional(),
  motivoRectificacion: z.string().trim().min(1).optional(),
  lineas: z.array(linea).min(1, "La factura necesita al menos una línea"),
});
export type BorradorFactura = z.input<typeof borradorFactura>;

export class ErrorFacturacion extends Error {}

/**
 * Importe total que va al registro VERI*FACTU, a la huella y al QR: base más cuotas.
 * La retención de IRPF no se descuenta aquí (sí en el total a pagar de la factura).
 */
export function importeTotalRegistro(t: { baseCent: number; cuotaIvaCent: number }): number {
  return t.baseCent + t.cuotaIvaCent;
}

interface Contexto {
  empresaId: string;
  usuarioId?: string;
  /** Fecha de hoy en Madrid; inyectable para tests. */
  hoy?: string;
  ahora?: Date;
}

/**
 * Emite una factura de forma atómica:
 * bloquea la serie y asigna el siguiente número, guarda la factura con los datos congelados,
 * genera el registro de alta encadenado con huella SHA-256 y deja constancia en la auditoría.
 * Si cualquier paso falla, no queda nada escrito ni se consume número.
 */
export async function emitirFactura(sql: Sql, ctx: Contexto, entrada: BorradorFactura) {
  const b = borradorFactura.parse(entrada);
  const ahora = ctx.ahora ?? new Date();
  const fechaHoraHuso = fechaHoraHusoMadrid(ahora);
  const hoy = ctx.hoy ?? fechaHoraHuso.slice(0, 10);
  if (b.fechaExpedicion > hoy) throw new ErrorFacturacion("La fecha de expedición no puede ser futura");
  if (b.rectificaId && !b.motivoRectificacion) throw new ErrorFacturacion("Indica el motivo de la rectificación");

  const t = calcularTotales(b.lineas, b.retencionPct);

  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    const [empresa] = await tx<{ nif: string }[]>`SELECT nif FROM empresas WHERE id = ${ctx.empresaId}`;
    if (!empresa) throw new ErrorFacturacion("Empresa no encontrada");

    const ejercicio = Number(b.fechaExpedicion.slice(0, 4));
    // Al empezar un ejercicio nuevo, la serie se abre con la misma configuración y numeración desde 1.
    await tx`INSERT INTO series (empresa_id, codigo, descripcion, tipo_factura, ejercicio)
      SELECT empresa_id, codigo, descripcion, tipo_factura, ${ejercicio} FROM series
      WHERE empresa_id = ${ctx.empresaId} AND codigo = ${b.serieCodigo} AND ejercicio < ${ejercicio}
      ORDER BY ejercicio DESC LIMIT 1
      ON CONFLICT (empresa_id, codigo, ejercicio) DO NOTHING`;
    const [serie] = await tx<{ id: string; tipo_factura: TipoFacturaAEAT; ultimo_numero: number }[]>`
      SELECT id, tipo_factura, ultimo_numero FROM series
      WHERE empresa_id = ${ctx.empresaId} AND codigo = ${b.serieCodigo} AND ejercicio = ${ejercicio}
      FOR UPDATE`;
    if (!serie) throw new ErrorFacturacion(`No existe la serie ${b.serieCodigo} para ${ejercicio}`);
    const esRect = serie.tipo_factura.startsWith("R");
    if (esRect !== Boolean(b.rectificaId)) {
      throw new ErrorFacturacion(esRect ? "Una rectificativa debe indicar la factura que rectifica" : "Esta serie no es de rectificativas");
    }

    // Correlatividad: no se puede emitir con fecha anterior a la última factura de la serie.
    const [ultima] = await tx<{ fecha: string }[]>`
      SELECT to_char(max(fecha_expedicion), 'YYYY-MM-DD') AS fecha FROM facturas WHERE serie_id = ${serie.id}`;
    if (ultima?.fecha && b.fechaExpedicion < ultima.fecha) {
      throw new ErrorFacturacion(`La serie ${b.serieCodigo} ya tiene facturas del ${ultima.fecha}; la numeración debe seguir el orden de fechas`);
    }

    let destinatario: unknown = null;
    if (b.clienteId) {
      const [c] = await tx`SELECT razon_social, nif, direccion, codigo_postal, municipio, provincia, pais, email FROM terceros WHERE id = ${b.clienteId} AND es_cliente`;
      if (!c) throw new ErrorFacturacion("Cliente no encontrado");
      destinatario = c;
    } else if (serie.tipo_factura !== "F2" && serie.tipo_factura !== "R5") {
      throw new ErrorFacturacion("Las facturas completas deben identificar al destinatario");
    }

    if (b.rectificaId) {
      const [o] = await tx`SELECT id FROM facturas WHERE id = ${b.rectificaId} AND NOT anulada`;
      if (!o) throw new ErrorFacturacion("La factura a rectificar no existe o está anulada");
    }

    const numero = serie.ultimo_numero + 1;
    const numSerie = `${b.serieCodigo}-${ejercicio}-${String(numero).padStart(5, "0")}`;
    await tx`UPDATE series SET ultimo_numero = ${numero} WHERE id = ${serie.id}`;

    const [factura] = await tx<{ id: string }[]>`
      INSERT INTO facturas (empresa_id, serie_id, numero, num_serie, tipo_factura, fecha_expedicion, fecha_operacion,
        cliente_id, destinatario, proyecto_id, base_cent, cuota_iva_cent, retencion_pct, retencion_cent, total_cent,
        vencimiento, metodo_cobro, condiciones_pago, observaciones, referencia, rectifica_id, tipo_rectificacion, motivo_rectificacion, emitida_por)
      VALUES (${ctx.empresaId}, ${serie.id}, ${numero}, ${numSerie}, ${serie.tipo_factura}, ${b.fechaExpedicion}, ${b.fechaOperacion ?? null},
        ${b.clienteId ?? null}, ${destinatario ? tx.json(destinatario as never) : null}, ${b.proyectoId ?? null},
        ${t.baseCent}, ${t.cuotaIvaCent}, ${b.retencionPct}, ${t.retencionCent}, ${t.totalCent},
        ${b.vencimiento ?? null}, ${b.metodoCobro ?? null}, ${b.condicionesPago ?? null}, ${b.observaciones ?? null}, ${b.referencia || null},
        ${b.rectificaId ?? null}, ${b.rectificaId ? (b.tipoRectificacion ?? "I") : null}, ${b.motivoRectificacion ?? null}, ${ctx.usuarioId ?? null})
      RETURNING id`;

    for (const [i, l] of b.lineas.entries()) {
      await tx`INSERT INTO lineas_factura (empresa_id, factura_id, orden, concepto, categoria, cantidad, precio_unitario_cent, descuento_pct, tipo_iva, causa_iva, base_cent)
        VALUES (${ctx.empresaId}, ${factura.id}, ${i + 1}, ${l.concepto}, ${l.categoria ?? null}, ${l.cantidad}, ${l.precioUnitarioCent}, ${l.descuentoPct}, ${l.tipoIva}, ${l.causaIva ?? null}, ${t.lineas[i].baseCent})`;
    }
    for (const d of t.desglose) {
      await tx`INSERT INTO desglose_iva (empresa_id, factura_id, tipo_iva, causa_iva, base_cent, cuota_cent) VALUES (${ctx.empresaId}, ${factura.id}, ${d.tipoIva}, ${d.causaIva ?? null}, ${d.baseCent}, ${d.cuotaCent})`;
    }

    const registro = await encadenar(tx, ctx.empresaId, (anterior) =>
      cadenaAlta({
        nifEmisor: empresa.nif, numSerie, fechaExpedicion: b.fechaExpedicion, tipoFactura: serie.tipo_factura,
        cuotaTotalCent: t.cuotaIvaCent, importeTotalCent: importeTotalRegistro(t), huellaAnterior: anterior, fechaHoraHuso,
      }), { tipo: "alta", facturaId: factura.id, numSerie, fechaExpedicion: b.fechaExpedicion, fechaHoraHuso });

    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
      VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, 'emitir_factura', 'factura', ${factura.id}, ${tx.json({ numSerie, totalCent: t.totalCent, huella: registro.huella })})`;

    return { id: factura.id, numSerie, totales: t, huella: registro.huella, huellaAnterior: registro.huellaAnterior };
  });
}

/** Anula una factura emitida por error: genera un registro de anulación encadenado. */
export async function anularFactura(sql: Sql, ctx: Contexto, facturaId: string, motivo: string) {
  if (!motivo.trim()) throw new ErrorFacturacion("Indica el motivo de la anulación");
  const fechaHoraHuso = fechaHoraHusoMadrid(ctx.ahora ?? new Date());
  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    const [f] = await tx<{ num_serie: string; fecha: string; anulada: boolean; nif: string }[]>`
      SELECT f.num_serie, to_char(f.fecha_expedicion, 'YYYY-MM-DD') AS fecha, f.anulada, e.nif
      FROM facturas f JOIN empresas e ON e.id = f.empresa_id WHERE f.id = ${facturaId} FOR UPDATE OF f`;
    if (!f) throw new ErrorFacturacion("Factura no encontrada");
    if (f.anulada) throw new ErrorFacturacion("La factura ya está anulada");
    const registro = await encadenar(tx, ctx.empresaId, (anterior) =>
      cadenaAnulacion({ nifEmisor: f.nif, numSerie: f.num_serie, fechaExpedicion: f.fecha, huellaAnterior: anterior, fechaHoraHuso }),
      { tipo: "anulacion", facturaId, numSerie: f.num_serie, fechaExpedicion: f.fecha, fechaHoraHuso });
    await tx`UPDATE facturas SET anulada = true WHERE id = ${facturaId}`;
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
      VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, 'anular_factura', 'factura', ${facturaId}, ${tx.json({ motivo, huella: registro.huella })})`;
    return registro;
  });
}

async function encadenar(
  tx: Parameters<Parameters<typeof enEmpresa>[2]>[0],
  empresaId: string,
  construir: (huellaAnterior: string) => string,
  r: { tipo: "alta" | "anulacion"; facturaId: string; numSerie: string; fechaExpedicion: string; fechaHoraHuso: string },
) {
  await tx`INSERT INTO cadena_registros (empresa_id) VALUES (${empresaId}) ON CONFLICT DO NOTHING`;
  const [cab] = await tx<{ ultima_secuencia: string; ultima_huella: string | null }[]>`
    SELECT ultima_secuencia, ultima_huella FROM cadena_registros WHERE empresa_id = ${empresaId} FOR UPDATE`;
  const anterior = cab.ultima_huella ?? "";
  const cadena = construir(anterior);
  const h = huella(cadena);
  const secuencia = Number(cab.ultima_secuencia) + 1;
  await tx`INSERT INTO registros_facturacion (empresa_id, secuencia, tipo, factura_id, num_serie, fecha_expedicion, fecha_hora_huso, cadena, huella, huella_anterior)
    VALUES (${empresaId}, ${secuencia}, ${r.tipo}, ${r.facturaId}, ${r.numSerie}, ${r.fechaExpedicion}, ${r.fechaHoraHuso}, ${cadena}, ${h}, ${anterior || null})`;
  await tx`UPDATE cadena_registros SET ultima_secuencia = ${secuencia}, ultima_huella = ${h} WHERE empresa_id = ${empresaId}`;
  await tx`INSERT INTO envios_aeat (empresa_id, registro_id, intento, estado)
    SELECT ${empresaId}, id, 1, 'pendiente' FROM registros_facturacion WHERE empresa_id = ${empresaId} AND secuencia = ${secuencia}`;
  return { huella: h, huellaAnterior: anterior || null, secuencia };
}
