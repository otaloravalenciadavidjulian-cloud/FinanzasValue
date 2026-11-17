import type { Tx } from "@/db/cliente";
import { nombreCategoria } from "@/lib/gastos/categorias";
import { fechaCsv, importeCsv, pctCsv } from "./csv";

/**
 * Libros registro de IVA (art. 62 a 64 del Reglamento del IVA): una línea por factura y tipo
 * impositivo. Sirven para revisar y para entregar a la gestoría; no sustituyen al SII.
 */

const TIPOS: Record<string, string> = {
  F1: "Factura", F2: "Simplificada", F3: "Sustitutiva de simplificadas",
  R1: "Rectificativa (art. 80.1, 80.2 y error)", R2: "Rectificativa (art. 80.3)", R3: "Rectificativa (art. 80.4)", R4: "Rectificativa (resto)", R5: "Rectificativa de simplificada",
};
const DOCUMENTOS: Record<string, string> = { factura: "Factura", factura_simplificada: "Factura simplificada", ticket: "Ticket", otro: "Otro" };

export const CABECERA_EXPEDIDAS = ["Fecha expedición", "Fecha operación", "Número", "Tipo", "NIF destinatario", "Destinatario",
  "Base imponible", "Tipo IVA %", "Cuota IVA", "Retención IRPF", "Total factura", "Rectifica a", "Estado"];

export async function libroExpedidas(tx: Tx, desde: string, hasta: string) {
  const filas = await tx<{ fecha_expedicion: string; fecha_operacion: string | null; num_serie: string; tipo_factura: string; destinatario: { nif?: string; razon_social?: string } | null;
    tipo_iva: string | null; base: string; cuota: string; retencion_cent: string; total_cent: string; rectifica: string | null; anulada: boolean; primera: boolean }[]>`
    SELECT to_char(f.fecha_expedicion, 'YYYY-MM-DD') AS fecha_expedicion, to_char(f.fecha_operacion, 'YYYY-MM-DD') AS fecha_operacion,
      f.num_serie, f.tipo_factura, f.destinatario, d.tipo_iva, coalesce(d.base_cent, f.base_cent) AS base, coalesce(d.cuota_cent, f.cuota_iva_cent) AS cuota,
      f.retencion_cent, f.total_cent, r.num_serie AS rectifica, f.anulada,
      row_number() OVER (PARTITION BY f.id ORDER BY d.tipo_iva DESC) = 1 AS primera
    FROM facturas f LEFT JOIN desglose_iva d ON d.factura_id = f.id LEFT JOIN facturas r ON r.id = f.rectifica_id
    WHERE f.fecha_expedicion BETWEEN ${desde}::date AND ${hasta}::date
    ORDER BY f.fecha_expedicion, f.num_serie, d.tipo_iva DESC`;
  // La retención y el total son de la factura: se indican solo en su primera línea para que las sumas cuadren.
  return filas.map((f) => [
    fechaCsv(f.fecha_expedicion), fechaCsv(f.fecha_operacion), f.num_serie, TIPOS[f.tipo_factura] ?? f.tipo_factura,
    f.destinatario?.nif ?? "", f.destinatario?.razon_social ?? "",
    importeCsv(Number(f.base)), f.tipo_iva === null ? "" : pctCsv(f.tipo_iva), importeCsv(Number(f.cuota)),
    f.primera ? importeCsv(Number(f.retencion_cent)) : "", f.primera ? importeCsv(Number(f.total_cent)) : "",
    f.rectifica ?? "", f.anulada ? "Anulada" : "Emitida",
  ]);
}

export const CABECERA_RECIBIDAS = ["Nº orden", "Fecha expedición", "Fecha registro", "Número factura", "Tipo documento", "NIF proveedor", "Proveedor",
  "Base imponible", "Tipo IVA %", "Cuota IVA", "% deducible", "Cuota deducible", "Retención IRPF", "Total", "Categoría", "Justificante"];

export async function libroRecibidas(tx: Tx, desde: string, hasta: string) {
  const filas = await tx<{ orden: string; fecha_expedicion: string; fecha_registro: string; numero: string | null; tipo_documento: string; nif: string | null; proveedor: string | null;
    tipo_iva: string; base_cent: string; cuota_cent: string; deducible_pct: string; cuota_deducible_cent: string; retencion_cent: string; total_cent: string;
    categoria: string; pendiente_documentacion: boolean; primera: boolean }[]>`
    SELECT dense_rank() OVER (ORDER BY g.fecha_registro, g.creado_en, g.id) AS orden,
      to_char(g.fecha_expedicion, 'YYYY-MM-DD') AS fecha_expedicion, to_char(g.fecha_registro, 'YYYY-MM-DD') AS fecha_registro,
      g.numero, g.tipo_documento, t.nif, t.razon_social AS proveedor, d.tipo_iva, d.base_cent, d.cuota_cent, d.deducible_pct, d.cuota_deducible_cent,
      g.retencion_cent, g.total_cent, g.categoria, g.pendiente_documentacion,
      row_number() OVER (PARTITION BY g.id ORDER BY d.tipo_iva DESC, d.id) = 1 AS primera
    FROM gastos g JOIN desglose_gasto d ON d.gasto_id = g.id LEFT JOIN terceros t ON t.id = g.proveedor_id
    WHERE g.borrado_en IS NULL AND g.fecha_expedicion BETWEEN ${desde}::date AND ${hasta}::date
    ORDER BY 1, d.tipo_iva DESC`;
  return filas.map((f) => [
    f.orden, fechaCsv(f.fecha_expedicion), fechaCsv(f.fecha_registro), f.numero ?? "", DOCUMENTOS[f.tipo_documento] ?? f.tipo_documento,
    f.nif ?? "", f.proveedor ?? "", importeCsv(Number(f.base_cent)), pctCsv(f.tipo_iva), importeCsv(Number(f.cuota_cent)),
    pctCsv(f.deducible_pct), importeCsv(Number(f.cuota_deducible_cent)),
    f.primera ? importeCsv(Number(f.retencion_cent)) : "", f.primera ? importeCsv(Number(f.total_cent)) : "",
    nombreCategoria(f.categoria), f.pendiente_documentacion ? "Pendiente" : "Adjunto",
  ]);
}
