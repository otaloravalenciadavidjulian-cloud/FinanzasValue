import { aDecimalAEAT } from "../fiscal/dinero";
import { cadenaAlta, cadenaAnulacion, fechaAEAT, huella, type TipoFacturaAEAT } from "./huella";

/**
 * XML de los registros de facturación VERI*FACTU según los esquemas de la AEAT
 * (SuministroLR.xsd y SuministroInformacion.xsd, versión 1.0, copiados en docs/aeat/xsd).
 * Las funciones son puras: el mismo registro guardado produce siempre el mismo XML.
 */

export const NS_LR = "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd";
export const NS_INFO = "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd";

export interface SistemaInformatico {
  /** Productor del software (quien lo desarrolla). */
  nombreRazon: string;
  nif: string;
  nombre: string;
  /** Código de dos caracteres que identifica el sistema dentro del productor. */
  id: string;
  version: string;
  numeroInstalacion: string;
  soloVerifactu: boolean;
  multiplesObligados: boolean;
  indicadorMultiplesObligados: boolean;
}

export interface Persona {
  razonSocial: string;
  nif: string;
  /** Código ISO 3166-1 alfa-2. Si no es ES se identifica con IDOtro (NIF-IVA). */
  pais?: string;
}

export interface LineaDesglose {
  tipoIva: number;
  /** Al 0 %: E1–E6 (exenta), N1/N2 (no sujeta) o S2 (inversión del sujeto pasivo). */
  causaIva?: string | null;
  baseCent: number;
  cuotaCent: number;
}

export interface RegistroAnterior {
  numSerie: string;
  fechaExpedicion: string;
  huella: string;
}

interface Comun {
  emisor: Persona;
  numSerie: string;
  fechaExpedicion: string;
  /** Registro inmediatamente anterior de la cadena del obligado; null en el primero. */
  anterior: RegistroAnterior | null;
  sistema: SistemaInformatico;
  fechaHoraHuso: string;
  huella: string;
}

export interface DatosRegistroAlta extends Comun {
  tipo: "alta";
  tipoFactura: TipoFacturaAEAT;
  fechaOperacion?: string | null;
  descripcion: string;
  destinatario?: Persona | null;
  desglose: LineaDesglose[];
  cuotaTotalCent: number;
  importeTotalCent: number;
  rectificacion?: {
    tipo: "S" | "I";
    facturas: { numSerie: string; fechaExpedicion: string }[];
    /** Solo en rectificativas por sustitución: importes de la factura original. */
    baseRectificadaCent?: number;
    cuotaRectificadaCent?: number;
  } | null;
}

export interface DatosRegistroAnulacion extends Comun {
  tipo: "anulacion";
}

export type DatosRegistro = DatosRegistroAlta | DatosRegistroAnulacion;

export class ErrorXML extends Error {}

export function escaparXML(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Texto limitado a la longitud máxima del esquema. */
function texto(valor: string, max: number): string {
  const limpio = valor.replace(/\s+/g, " ").trim();
  if (!limpio) throw new ErrorXML("Falta un texto obligatorio en el registro");
  return escaparXML(Array.from(limpio).slice(0, max).join(""));
}

const el = (nombre: string, contenido: string) => `<sf:${nombre}>${contenido}</sf:${nombre}>`;
const tipoImpositivo = (t: number) => t.toFixed(2);

function persona(p: Persona): string {
  const pais = (p.pais ?? "ES").toUpperCase();
  const id = pais === "ES"
    ? el("NIF", texto(p.nif, 9))
    : el("IDOtro", el("CodigoPais", pais) + el("IDType", "02") + el("ID", texto(p.nif, 20)));
  return el("NombreRazon", texto(p.razonSocial, 120)) + id;
}

function encadenamiento(d: Comun): string {
  if (!d.anterior) return el("Encadenamiento", el("PrimerRegistro", "S"));
  return el("Encadenamiento", el("RegistroAnterior",
    el("IDEmisorFactura", texto(d.emisor.nif, 9)) +
    el("NumSerieFactura", texto(d.anterior.numSerie, 60)) +
    el("FechaExpedicionFactura", fechaAEAT(d.anterior.fechaExpedicion)) +
    el("Huella", d.anterior.huella)));
}

function sistemaInformatico(s: SistemaInformatico): string {
  const sn = (b: boolean) => (b ? "S" : "N");
  return el("SistemaInformatico",
    el("NombreRazon", texto(s.nombreRazon, 120)) +
    el("NIF", texto(s.nif, 9)) +
    el("NombreSistemaInformatico", texto(s.nombre, 30)) +
    el("IdSistemaInformatico", texto(s.id, 2)) +
    el("Version", texto(s.version, 50)) +
    el("NumeroInstalacion", texto(s.numeroInstalacion, 100)) +
    el("TipoUsoPosibleSoloVerifactu", sn(s.soloVerifactu)) +
    el("TipoUsoPosibleMultiOT", sn(s.multiplesObligados)) +
    el("IndicadorMultiplesOT", sn(s.indicadorMultiplesObligados)));
}

function desglose(lineas: LineaDesglose[]): string {
  if (lineas.length === 0 || lineas.length > 12) throw new ErrorXML("El desglose debe tener entre 1 y 12 líneas");
  return el("Desglose", lineas.map((l) => {
    if (l.tipoIva === 0) {
      const c = l.causaIva ?? "";
      // Exportaciones (E2) van con la clave de régimen 02; el resto, régimen general.
      const regimen = el("Impuesto", "01") + el("ClaveRegimen", c === "E2" ? "02" : "01");
      if (/^E[1-6]$/.test(c)) return el("DetalleDesglose", regimen + el("OperacionExenta", c) + el("BaseImponibleOimporteNoSujeto", aDecimalAEAT(l.baseCent)));
      if (c === "N1" || c === "N2") return el("DetalleDesglose", regimen + el("CalificacionOperacion", c) + el("BaseImponibleOimporteNoSujeto", aDecimalAEAT(l.baseCent)));
      if (c === "S2") return el("DetalleDesglose", regimen + el("CalificacionOperacion", "S2") + el("TipoImpositivo", tipoImpositivo(0)) +
        el("BaseImponibleOimporteNoSujeto", aDecimalAEAT(l.baseCent)) + el("CuotaRepercutida", aDecimalAEAT(0)));
      // Facturas antiguas al 0 % sin causa: no se adivina.
      throw new ErrorXML("Esta factura tiene líneas al 0 % sin causa de exención o no sujeción");
    }
    return el("DetalleDesglose",
      el("Impuesto", "01") +
      el("ClaveRegimen", "01") +
      el("CalificacionOperacion", "S1") +
      el("TipoImpositivo", tipoImpositivo(l.tipoIva)) +
      el("BaseImponibleOimporteNoSujeto", aDecimalAEAT(l.baseCent)) +
      el("CuotaRepercutida", aDecimalAEAT(l.cuotaCent)));
  }).join(""));
}

/** Comprueba que la huella guardada corresponde a los datos que van en el XML. */
export function comprobarHuella(d: DatosRegistro): void {
  const anterior = d.anterior?.huella ?? "";
  const cadena = d.tipo === "alta"
    ? cadenaAlta({
      nifEmisor: d.emisor.nif, numSerie: d.numSerie, fechaExpedicion: d.fechaExpedicion, tipoFactura: d.tipoFactura,
      cuotaTotalCent: d.cuotaTotalCent, importeTotalCent: d.importeTotalCent, huellaAnterior: anterior, fechaHoraHuso: d.fechaHoraHuso,
    })
    : cadenaAnulacion({ nifEmisor: d.emisor.nif, numSerie: d.numSerie, fechaExpedicion: d.fechaExpedicion, huellaAnterior: anterior, fechaHoraHuso: d.fechaHoraHuso });
  if (huella(cadena) !== d.huella) throw new ErrorXML(`La huella del registro ${d.numSerie} no corresponde a sus datos`);
}

/** Elemento sf:RegistroAlta o sf:RegistroAnulacion. */
export function registroXML(d: DatosRegistro): string {
  comprobarHuella(d);
  const cola = encadenamiento(d) + sistemaInformatico(d.sistema) +
    el("FechaHoraHusoGenRegistro", d.fechaHoraHuso) + el("TipoHuella", "01") + el("Huella", d.huella);

  if (d.tipo === "anulacion") {
    return el("RegistroAnulacion",
      el("IDVersion", "1.0") +
      el("IDFactura",
        el("IDEmisorFacturaAnulada", texto(d.emisor.nif, 9)) +
        el("NumSerieFacturaAnulada", texto(d.numSerie, 60)) +
        el("FechaExpedicionFacturaAnulada", fechaAEAT(d.fechaExpedicion))) +
      cola);
  }

  const sinDestinatario = d.tipoFactura === "F2" || d.tipoFactura === "R5";
  if (!sinDestinatario && !d.destinatario) throw new ErrorXML("Las facturas completas deben identificar al destinatario");
  const esRect = d.tipoFactura.startsWith("R");
  if (esRect && !d.rectificacion?.facturas.length) throw new ErrorXML("Una rectificativa debe indicar la factura que rectifica");

  let rect = "";
  if (esRect && d.rectificacion) {
    const r = d.rectificacion;
    rect = el("TipoRectificativa", r.tipo) +
      el("FacturasRectificadas", r.facturas.map((f) => el("IDFacturaRectificada",
        el("IDEmisorFactura", texto(d.emisor.nif, 9)) +
        el("NumSerieFactura", texto(f.numSerie, 60)) +
        el("FechaExpedicionFactura", fechaAEAT(f.fechaExpedicion)))).join(""));
    if (r.tipo === "S") {
      if (r.baseRectificadaCent === undefined || r.cuotaRectificadaCent === undefined) {
        throw new ErrorXML("Una rectificativa por sustitución debe indicar la base y la cuota rectificadas");
      }
      rect += el("ImporteRectificacion", el("BaseRectificada", aDecimalAEAT(r.baseRectificadaCent)) + el("CuotaRectificada", aDecimalAEAT(r.cuotaRectificadaCent)));
    }
  }

  return el("RegistroAlta",
    el("IDVersion", "1.0") +
    el("IDFactura",
      el("IDEmisorFactura", texto(d.emisor.nif, 9)) +
      el("NumSerieFactura", texto(d.numSerie, 60)) +
      el("FechaExpedicionFactura", fechaAEAT(d.fechaExpedicion))) +
    el("NombreRazonEmisor", texto(d.emisor.razonSocial, 120)) +
    el("TipoFactura", d.tipoFactura) +
    rect +
    (d.fechaOperacion && d.fechaOperacion !== d.fechaExpedicion ? el("FechaOperacion", fechaAEAT(d.fechaOperacion)) : "") +
    el("DescripcionOperacion", texto(d.descripcion, 500)) +
    (d.destinatario && !sinDestinatario ? el("Destinatarios", el("IDDestinatario", persona(d.destinatario))) : "") +
    desglose(d.desglose) +
    el("CuotaTotal", aDecimalAEAT(d.cuotaTotalCent)) +
    el("ImporteTotal", aDecimalAEAT(d.importeTotalCent)) +
    cola);
}

/** Mensaje RegFactuSistemaFacturacion con la cabecera del obligado y hasta 1000 registros. */
export function envioXML(obligado: Persona, registros: DatosRegistro[]): string {
  if (registros.length === 0 || registros.length > 1000) throw new ErrorXML("Un envío lleva entre 1 y 1000 registros");
  return `<sfLR:RegFactuSistemaFacturacion xmlns:sfLR="${NS_LR}" xmlns:sf="${NS_INFO}">` +
    `<sfLR:Cabecera>${el("ObligadoEmision", el("NombreRazon", texto(obligado.razonSocial, 120)) + el("NIF", texto(obligado.nif, 9)))}</sfLR:Cabecera>` +
    registros.map((r) => `<sfLR:RegistroFactura>${registroXML(r)}</sfLR:RegistroFactura>`).join("") +
    `</sfLR:RegFactuSistemaFacturacion>`;
}

/** Documento XML completo y legible para descargar o guardar. */
export function documentoXML(obligado: Persona, registros: DatosRegistro[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${envioXML(obligado, registros)}\n`;
}

/** Sobre SOAP 1.1 con el que se envía el mensaje al servicio web de la AEAT. */
export function sobreSOAP(obligado: Persona, registros: DatosRegistro[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Header/><soapenv:Body>` +
    envioXML(obligado, registros) +
    `</soapenv:Body></soapenv:Envelope>`;
}
