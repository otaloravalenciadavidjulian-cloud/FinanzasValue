import type { Tx } from "@/db/cliente";
import type { DatosRegistro, Persona, SistemaInformatico } from "./xml";
import type { TipoFacturaAEAT } from "./huella";

/** Versión del sistema informático que figura en cada registro. Cambiarla al publicar versiones. */
export const VERSION_SISTEMA = "0.2.0";

/**
 * Datos del sistema informático de facturación (SIF). El productor es quien desarrolla el software:
 * se toma de SIF_PRODUCTOR_NIF y SIF_PRODUCTOR_NOMBRE y, si no están, se entiende que la empresa
 * se lo ha desarrollado ella misma.
 */
export function sistemaInformatico(empresa: { id: string; nif: string; razonSocial: string }): SistemaInformatico {
  return {
    nombreRazon: process.env.SIF_PRODUCTOR_NOMBRE?.trim() || empresa.razonSocial,
    nif: process.env.SIF_PRODUCTOR_NIF?.trim() || empresa.nif,
    nombre: "Value",
    id: "VL",
    version: VERSION_SISTEMA,
    numeroInstalacion: empresa.id,
    soloVerifactu: true,
    multiplesObligados: true,
    indicadorMultiplesObligados: true,
  };
}

interface Fila {
  id: string;
  tipo: "alta" | "anulacion";
  secuencia: string;
  num_serie: string;
  fecha: string;
  fecha_hora_huso: string;
  huella: string;
  ant_num_serie: string | null;
  ant_fecha: string | null;
  ant_huella: string | null;
  factura_id: string;
  tipo_factura: TipoFacturaAEAT;
  fecha_operacion: string | null;
  destinatario: { razon_social: string; nif: string; pais?: string } | null;
  base_cent: string;
  cuota_iva_cent: string;
  observaciones: string | null;
  tipo_rectificacion: "S" | "I" | null;
  orig_num_serie: string | null;
  orig_fecha: string | null;
  orig_base: string | null;
  orig_cuota: string | null;
  empresa_id: string;
  nif: string;
  razon_social: string;
}

/**
 * Reconstruye, a partir de lo guardado, los datos de los registros de facturación para generar su XML.
 * Debe ejecutarse dentro de enEmpresa(): RLS limita la consulta a la empresa de la sesión.
 */
export async function cargarRegistros(tx: Tx, filtro: { facturaId?: string; registroIds?: string[] }) {
  const porFactura = filtro.facturaId ?? null;
  const porIds = filtro.registroIds ?? null;
  const filas = await tx<Fila[]>`
    SELECT r.id, r.tipo, r.secuencia, r.num_serie, to_char(r.fecha_expedicion,'YYYY-MM-DD') AS fecha, r.fecha_hora_huso, r.huella,
           p.num_serie AS ant_num_serie, to_char(p.fecha_expedicion,'YYYY-MM-DD') AS ant_fecha, p.huella AS ant_huella,
           f.id AS factura_id, f.tipo_factura, to_char(f.fecha_operacion,'YYYY-MM-DD') AS fecha_operacion, f.destinatario,
           f.base_cent, f.cuota_iva_cent, f.observaciones, f.tipo_rectificacion,
           o.num_serie AS orig_num_serie, to_char(o.fecha_expedicion,'YYYY-MM-DD') AS orig_fecha, o.base_cent AS orig_base, o.cuota_iva_cent AS orig_cuota,
           e.id AS empresa_id, e.nif, e.razon_social
    FROM registros_facturacion r
    JOIN facturas f ON f.id = r.factura_id
    JOIN empresas e ON e.id = r.empresa_id
    LEFT JOIN registros_facturacion p ON p.empresa_id = r.empresa_id AND p.secuencia = r.secuencia - 1
    LEFT JOIN facturas o ON o.id = f.rectifica_id
    WHERE (${porFactura}::uuid IS NULL OR r.factura_id = ${porFactura}::uuid)
      AND (${porIds}::uuid[] IS NULL OR r.id = ANY(${porIds}::uuid[]))
    ORDER BY r.secuencia`;
  if (filas.length === 0) return [];

  const facturaIds = [...new Set(filas.map((f) => f.factura_id))];
  const desgloses = await tx<{ factura_id: string; tipo_iva: string; base_cent: string; cuota_cent: string }[]>`
    SELECT factura_id, tipo_iva, base_cent, cuota_cent FROM desglose_iva WHERE factura_id = ANY(${facturaIds}::uuid[]) ORDER BY tipo_iva DESC`;
  const conceptos = await tx<{ factura_id: string; concepto: string }[]>`
    SELECT factura_id, concepto FROM lineas_factura WHERE factura_id = ANY(${facturaIds}::uuid[]) ORDER BY orden`;

  return filas.map((f) => {
    const emisor: Persona = { nif: f.nif, razonSocial: f.razon_social };
    const comun = {
      emisor,
      numSerie: f.num_serie,
      fechaExpedicion: f.fecha,
      anterior: f.ant_huella ? { numSerie: f.ant_num_serie!, fechaExpedicion: f.ant_fecha!, huella: f.ant_huella } : null,
      sistema: sistemaInformatico({ id: f.empresa_id, nif: f.nif, razonSocial: f.razon_social }),
      fechaHoraHuso: f.fecha_hora_huso,
      huella: f.huella,
    };
    const datos: DatosRegistro = f.tipo === "anulacion"
      ? { ...comun, tipo: "anulacion" }
      : {
        ...comun,
        tipo: "alta",
        tipoFactura: f.tipo_factura,
        fechaOperacion: f.fecha_operacion,
        descripcion: f.observaciones?.trim() || conceptos.filter((c) => c.factura_id === f.factura_id).map((c) => c.concepto).join("; "),
        destinatario: f.destinatario ? { razonSocial: f.destinatario.razon_social, nif: f.destinatario.nif, pais: f.destinatario.pais } : null,
        desglose: desgloses.filter((d) => d.factura_id === f.factura_id)
          .map((d) => ({ tipoIva: Number(d.tipo_iva), baseCent: Number(d.base_cent), cuotaCent: Number(d.cuota_cent) })),
        cuotaTotalCent: Number(f.cuota_iva_cent),
        importeTotalCent: Number(f.base_cent) + Number(f.cuota_iva_cent),
        rectificacion: f.orig_num_serie ? {
          tipo: f.tipo_rectificacion ?? "I",
          facturas: [{ numSerie: f.orig_num_serie, fechaExpedicion: f.orig_fecha! }],
          baseRectificadaCent: f.tipo_rectificacion === "S" ? Number(f.orig_base) : undefined,
          cuotaRectificadaCent: f.tipo_rectificacion === "S" ? Number(f.orig_cuota) : undefined,
        } : null,
      };
    return { id: f.id, secuencia: Number(f.secuencia), datos };
  });
}
