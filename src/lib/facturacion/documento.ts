import type { Tx } from "@/db/cliente";
import { contenidoLogotipo, empresaEn } from "@/lib/empresas/datos";
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
           o.num_serie AS o_num_serie, to_char(o.fecha_expedicion,'YYYY-MM-DD') AS o_fecha
    FROM facturas f LEFT JOIN facturas o ON o.id = f.rectifica_id
    WHERE f.id = ${id}`;
  if (!f) return null;
  // Datos del emisor tal como estaban al emitir la factura.
  const e = await empresaEn(tx, f.empresa_id, f.emitida_en);
  const logo = e.logotipoId ? await contenidoLogotipo(tx, e.logotipoId) : null;
  const lineas = await tx`SELECT * FROM lineas_factura WHERE factura_id = ${id} ORDER BY orden`;
  const desglose = await tx`SELECT * FROM desglose_iva WHERE factura_id = ${id} ORDER BY tipo_iva DESC, causa_iva`;
  const dest = f.destinatario as Record<string, string | null> | null;
  const baseCent = Number(f.base_cent);
  const cuotaIvaCent = Number(f.cuota_iva_cent);
  return {
    emisor: {
      razonSocial: e.razonSocial, nombreComercial: e.nombreComercial, nif: e.nif, domicilio: e.domicilio, codigoPostal: e.codigoPostal,
      municipio: e.municipio, provincia: e.provincia, email: e.email, telefono: e.telefono, datosRegistrales: e.datosRegistrales, iban: e.iban, banco: e.banco, textoPie: e.textoPie,
      web: e.web, bic: e.bic, titularCuenta: e.titularCuenta, agradecimiento: e.agradecimiento,
      logo,
    },
    destinatario: dest ? {
      razonSocial: dest.razon_social ?? "", nif: dest.nif ?? "", direccion: dest.direccion, codigoPostal: dest.codigo_postal,
      municipio: dest.municipio, provincia: dest.provincia, pais: dest.pais, email: dest.email,
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
    referencia: f.referencia,
    anulada: f.anulada,
    urlQR: urlQR({ nifEmisor: e.nif, numSerie: f.num_serie, fechaExpedicion: f.fecha, importeTotalCent: importeTotalRegistro({ baseCent, cuotaIvaCent }), entorno }),
    entornoPruebas: entorno === "pruebas",
  };
}
