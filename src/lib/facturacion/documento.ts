import type { Tx } from "@/db/cliente";
import { urlQR, type EntornoAEAT } from "@/lib/verifactu/qr";
import { importeTotalRegistro } from "./emitir";
import type { DatosFacturaPDF } from "./pdf";

export function entornoAEAT(): EntornoAEAT {
  return process.env.VERIFACTU_ENTORNO === "produccion" ? "produccion" : "pruebas";
}

/** Lee una factura emitida con todo lo necesario para su PDF. Ejecutar dentro de enEmpresa(). */
export async function cargarFacturaPDF(tx: Tx, id: string, entorno: EntornoAEAT = entornoAEAT()): Promise<DatosFacturaPDF | null> {
  const [f] = await tx`
    SELECT f.*, to_char(f.fecha_expedicion,'YYYY-MM-DD') AS fecha, to_char(f.fecha_operacion,'YYYY-MM-DD') AS fecha_op,
           to_char(f.vencimiento,'YYYY-MM-DD') AS venc,
           e.razon_social AS e_razon, e.nombre_comercial AS e_comercial, e.nif AS e_nif, e.domicilio AS e_domicilio,
           e.codigo_postal AS e_cp, e.municipio AS e_municipio, e.provincia AS e_provincia, e.email AS e_email,
           e.telefono AS e_telefono, e.datos_registrales AS e_registro, e.iban AS e_iban,
           o.num_serie AS o_num_serie, to_char(o.fecha_expedicion,'YYYY-MM-DD') AS o_fecha
    FROM facturas f JOIN empresas e ON e.id = f.empresa_id LEFT JOIN facturas o ON o.id = f.rectifica_id
    WHERE f.id = ${id}`;
  if (!f) return null;
  const lineas = await tx`SELECT * FROM lineas_factura WHERE factura_id = ${id} ORDER BY orden`;
  const desglose = await tx`SELECT * FROM desglose_iva WHERE factura_id = ${id} ORDER BY tipo_iva DESC, causa_iva`;
  const dest = f.destinatario as Record<string, string | null> | null;
  const baseCent = Number(f.base_cent);
  const cuotaIvaCent = Number(f.cuota_iva_cent);
  return {
    emisor: {
      razonSocial: f.e_razon, nombreComercial: f.e_comercial, nif: f.e_nif, domicilio: f.e_domicilio, codigoPostal: f.e_cp,
      municipio: f.e_municipio, provincia: f.e_provincia, email: f.e_email, telefono: f.e_telefono, datosRegistrales: f.e_registro, iban: f.e_iban,
    },
    destinatario: dest ? {
      razonSocial: dest.razon_social ?? "", nif: dest.nif ?? "", direccion: dest.direccion, codigoPostal: dest.codigo_postal,
      municipio: dest.municipio, provincia: dest.provincia, pais: dest.pais,
    } : null,
    numSerie: f.num_serie,
    tipoFactura: f.tipo_factura,
    fechaExpedicion: f.fecha,
    fechaOperacion: f.fecha_op,
    vencimiento: f.venc,
    lineas: lineas.map((l) => ({
      concepto: l.concepto, cantidad: Number(l.cantidad), precioUnitarioCent: Number(l.precio_unitario_cent),
      descuentoPct: Number(l.descuento_pct), tipoIva: Number(l.tipo_iva), causaIva: l.causa_iva, baseCent: Number(l.base_cent),
    })),
    desglose: desglose.map((d) => ({ tipoIva: Number(d.tipo_iva), causaIva: d.causa_iva, baseCent: Number(d.base_cent), cuotaCent: Number(d.cuota_cent) })),
    baseCent,
    cuotaIvaCent,
    retencionPct: Number(f.retencion_pct),
    retencionCent: Number(f.retencion_cent),
    totalCent: Number(f.total_cent),
    rectifica: f.o_num_serie ? { numSerie: f.o_num_serie, fechaExpedicion: f.o_fecha, tipo: f.tipo_rectificacion ?? "I", motivo: f.motivo_rectificacion } : null,
    metodoCobro: f.metodo_cobro,
    condicionesPago: f.condiciones_pago,
    observaciones: f.observaciones,
    anulada: f.anulada,
    urlQR: urlQR({ nifEmisor: f.e_nif, numSerie: f.num_serie, fechaExpedicion: f.fecha, importeTotalCent: importeTotalRegistro({ baseCent, cuotaIvaCent }), entorno }),
    entornoPruebas: entorno === "pruebas",
  };
}
