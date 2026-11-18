import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { causaIva } from "@/lib/fiscal/exenciones";
import QRCode from "qrcode";

import { LEYENDA_VERIFACTU } from "../verifactu/qr";
import { LOGO_VALUE_PNG } from "../marca/logo";
import { formatearIban } from "../tesoreria/iban";

/**
 * Factura en PDF con los datos que exige el art. 6 del RD 1619/2012 y, al inicio,
 * el QR tributario con la leyenda VERI*FACTU (Orden HAC/1177/2024, arts. 20 y 21).
 */

export interface DatosFacturaPDF {
  emisor: {
    razonSocial: string; nombreComercial?: string | null; nif: string; domicilio: string; codigoPostal: string;
    municipio: string; provincia: string; email?: string | null; telefono?: string | null; datosRegistrales?: string | null; iban?: string | null; banco?: string | null; textoPie?: string | null;
    web?: string | null; bic?: string | null; titularCuenta?: string | null; agradecimiento?: string | null;
    /** PNG o JPG. */
    logo?: { bytes: Uint8Array; mime: string } | null;
  };
  destinatario: {
    razonSocial: string; nif: string; direccion?: string | null; codigoPostal?: string | null;
    municipio?: string | null; provincia?: string | null; pais?: string | null; email?: string | null;
  } | null;
  numSerie: string;
  tipoFactura: string;
  fechaExpedicion: string;
  fechaOperacion?: string | null;
  vencimiento?: string | null;
  lineas: { concepto: string; cantidad: number; precioUnitarioCent: number; descuentoPct: number; tipoIva: number; causaIva?: string | null; baseCent: number }[];
  desglose: { tipoIva: number; causaIva?: string | null; baseCent: number; cuotaCent: number }[];
  baseCent: number;
  cuotaIvaCent: number;
  retencionPct: number;
  retencionCent: number;
  totalCent: number;
  rectifica?: { numSerie: string; fechaExpedicion: string; tipo: "S" | "I"; motivo?: string | null } | null;
  metodoCobro?: string | null;
  condicionesPago?: string | null;
  observaciones?: string | null;
  /** Referencia o número de pedido del cliente. */
  referencia?: string | null;
  anulada: boolean;
  /** Solo en facturas emitidas con VERI*FACTU; sin él no se imprime QR tributario ni leyenda. */
  urlQR: string | null;
  entornoPruebas: boolean;
}


const A4 = { ancho: 595.28, alto: 841.89 };
const MARGEN = 48;
const MM = 72 / 25.4;
// Paleta monocroma: se lee igual en color y en blanco y negro.
const TINTA = rgb(0.09, 0.1, 0.11);
const GRIS = rgb(0.4, 0.42, 0.45);
const TENUE = rgb(0.8, 0.81, 0.83);
const FONDO = rgb(0.955, 0.958, 0.962);
const ROJO = rgb(0.7, 0.1, 0.1);

export const fechaES = (iso: string) => iso.split("-").reverse().join("/");

function titulo(tipo: string): string {
  if (tipo.startsWith("R")) return "FACTURA RECTIFICATIVA";
  if (tipo === "F2") return "FACTURA SIMPLIFICADA";
  return "FACTURA";
}

const PAISES: Record<string, string> = {
  ES: "España", PT: "Portugal", FR: "Francia", DE: "Alemania", IT: "Italia", NL: "Países Bajos", BE: "Bélgica", IE: "Irlanda",
  GB: "Reino Unido", US: "Estados Unidos", AD: "Andorra", CH: "Suiza", AT: "Austria", LU: "Luxemburgo", MX: "México",
};

/** Importe con separador de miles siempre (Intl no agrupa los números de cuatro cifras en español). */
export function formatearEuros(centimos: number): string {
  const signo = centimos < 0 ? "-" : "";
  const abs = Math.abs(Math.round(centimos));
  const enteros = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${signo}${enteros},${String(abs % 100).padStart(2, "0")} €`;
}

type Color = ReturnType<typeof rgb>;
interface OpcionesTexto { tam?: number; fuente?: PDFFont; color?: Color; derecha?: boolean; espaciado?: number }

export async function generarFacturaPDF(d: DatosFacturaPDF): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Factura ${d.numSerie}`);
  pdf.setAuthor(d.emisor.razonSocial);
  pdf.setCreator("Value");
  pdf.setProducer("Value");
  // Fecha fija para que el mismo documento produzca siempre el mismo PDF.
  const fecha = new Date(`${d.fechaExpedicion}T12:00:00Z`);
  pdf.setCreationDate(fecha);
  pdf.setModificationDate(fecha);

  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);
  const cursiva = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const admitidos = new Set(normal.getCharacterSet());
  // Las fuentes estándar usan WinAnsi: se sustituye lo que no se puede representar.
  const limpio = (t: string) => Array.from(t.replace(/[−–—]/g, "-").replace(/[  ]/g, " "))
    .map((c) => (admitidos.has(c.codePointAt(0)!) ? c : "?")).join("");

  const ancho = A4.ancho - 2 * MARGEN;
  const derecha = A4.ancho - MARGEN;
  let pagina = pdf.addPage([A4.ancho, A4.alto]);
  let y = A4.alto - MARGEN;

  const medir = (t: string, tam: number, fuente: PDFFont, espaciado = 0) =>
    fuente.widthOfTextAtSize(t, tam) + Math.max(0, t.length - 1) * espaciado;

  const escribir = (p: PDFPage, texto: string, x: number, yy: number, o: OpcionesTexto = {}) => {
    const tam = o.tam ?? 9;
    const fuente = o.fuente ?? normal;
    const esp = o.espaciado ?? 0;
    const t = limpio(texto);
    let xx = o.derecha ? x - medir(t, tam, fuente, esp) : x;
    if (!esp) { p.drawText(t, { x: xx, y: yy, size: tam, font: fuente, color: o.color ?? TINTA }); return; }
    for (const c of t) {
      p.drawText(c, { x: xx, y: yy, size: tam, font: fuente, color: o.color ?? TINTA });
      xx += fuente.widthOfTextAtSize(c, tam) + esp;
    }
  };
  /** Rótulo pequeño en mayúsculas espaciadas, para separar bloques sin recargar. */
  const rotulo = (p: PDFPage, texto: string, x: number, yy: number, der = false) =>
    escribir(p, texto.toUpperCase(), x, yy, { tam: 6.5, fuente: negrita, color: GRIS, espaciado: 0.9, derecha: der });
  const raya = (p: PDFPage, x1: number, x2: number, yy: number, grosor = 0.5, color: Color = TENUE) =>
    p.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: grosor, color });

  const partir = (texto: string, anchoMax: number, tam: number, fuente: PDFFont = normal): string[] => {
    const lineas: string[] = [];
    for (const parrafo of limpio(texto).split(/\n/)) {
      let actual = "";
      for (const palabra of parrafo.split(/\s+/)) {
        const prueba = actual ? `${actual} ${palabra}` : palabra;
        if (fuente.widthOfTextAtSize(prueba, tam) <= anchoMax) { actual = prueba; continue; }
        if (actual) lineas.push(actual);
        actual = palabra;
        while (fuente.widthOfTextAtSize(actual, tam) > anchoMax && actual.length > 1) {
          let corte = actual.length - 1;
          while (corte > 1 && fuente.widthOfTextAtSize(actual.slice(0, corte), tam) > anchoMax) corte--;
          lineas.push(actual.slice(0, corte));
          actual = actual.slice(corte);
        }
      }
      lineas.push(actual);
    }
    return lineas;
  };

  const e = d.emisor;
  const num = (n: number) => n.toLocaleString("es-ES", { maximumFractionDigits: 4 });
  const pct = (n: number) => `${num(n)} %`;

  // Pie de página: texto libre de la empresa y datos registrales. Se reserva su sitio en todas las páginas.
  const lineasPie = e.textoPie ? partir(e.textoPie, ancho, 7) : [];
  const lineasRegistro = e.datosRegistrales ? partir(e.datosRegistrales, ancho - 70, 6.5) : [];
  const altoPie = 14 + lineasPie.length * 9 + lineasRegistro.length * 8.5;
  const suelo = MARGEN - 18 + altoPie + 14;

  let enTabla = false;
  const cabeceraContinuacion = () => {
    escribir(pagina, `${titulo(d.tipoFactura)} ${d.numSerie}`, MARGEN, y, { tam: 9, fuente: negrita });
    escribir(pagina, "continuación", derecha, y, { tam: 8, color: GRIS, derecha: true });
    y -= 10;
    raya(pagina, MARGEN, derecha, y);
    y -= 22;
  };
  // Devuelve true si ha empezado una página nueva.
  const asegurar = (alto: number): boolean => {
    if (y - alto >= suelo) return false;
    pagina = pdf.addPage([A4.ancho, A4.alto]);
    y = A4.alto - MARGEN;
    cabeceraContinuacion();
    if (enTabla) cabeceraTabla();
    return true;
  };

  // ── Encabezado: logotipo y emisor a la izquierda; QR tributario arriba a la derecha (Orden HAC/1177/2024).
  const ladoQR = 30 * MM;
  const xQR = derecha - ladoQR;
  let finQR = y;
  if (d.urlQR) {
    const png = await QRCode.toBuffer(d.urlQR, { errorCorrectionLevel: "M", type: "png", margin: 0, width: 400 });
    const qr = await pdf.embedPng(png);
    escribir(pagina, "QR tributario:", xQR, y - 6, { tam: 6.5, color: GRIS });
    pagina.drawImage(qr, { x: xQR, y: y - 12 - ladoQR, width: ladoQR, height: ladoQR });
    escribir(pagina, "VERI*FACTU", xQR + ladoQR / 2 - negrita.widthOfTextAtSize("VERI*FACTU", 7.5) / 2, y - 23 - ladoQR, { tam: 7.5, fuente: negrita });
    const leyenda = partir(LEYENDA_VERIFACTU, ladoQR + 16, 5.5);
    leyenda.forEach((l, i) => escribir(pagina, l, xQR + ladoQR / 2 - normal.widthOfTextAtSize(l, 5.5) / 2, y - 31 - ladoQR - i * 6.5, { tam: 5.5, color: GRIS }));
    finQR = y - 31 - ladoQR - leyenda.length * 6.5;
  }

  const logo = e.logo ?? { bytes: LOGO_VALUE_PNG, mime: "image/png" };
  let ye = y;
  try {
    const img = logo.mime === "image/png" ? await pdf.embedPng(logo.bytes) : await pdf.embedJpg(logo.bytes);
    const escala = Math.min(170 / img.width, 44 / img.height, 1);
    pagina.drawImage(img, { x: MARGEN, y: y - img.height * escala, width: img.width * escala, height: img.height * escala });
    ye = y - img.height * escala - 22;
  } catch { ye = y - 6; /* Un logotipo dañado no impide generar la factura. */ }

  const nombrePrincipal = e.nombreComercial || e.razonSocial;
  escribir(pagina, nombrePrincipal, MARGEN, ye, { tam: 10.5, fuente: negrita });
  ye -= 13;
  const datosEmisor = [
    e.nombreComercial && e.nombreComercial !== e.razonSocial ? e.razonSocial : null,
    `NIF ${e.nif}`,
    e.domicilio,
    `${e.codigoPostal} ${e.municipio} (${e.provincia})`,
    [e.telefono, e.email, e.web].filter(Boolean).join("   ·   ") || null,
  ].filter(Boolean) as string[];
  for (const l of datosEmisor) { escribir(pagina, l, MARGEN, ye, { tam: 8.5, color: GRIS }); ye -= 11.5; }

  y = Math.min(ye, finQR) - 16;
  raya(pagina, MARGEN, derecha, y, 0.8, TINTA);
  y -= 34;

  // ── Título, número y fechas
  const tituloTexto = titulo(d.tipoFactura);
  escribir(pagina, tituloTexto, MARGEN, y, { tam: tituloTexto.length > 8 ? 17 : 24, fuente: negrita, espaciado: 1.5 });
  escribir(pagina, `Nº ${d.numSerie}`, MARGEN, y - 18, { tam: 10, color: GRIS });

  const datos: [string, string][] = [["Fecha de emisión", fechaES(d.fechaExpedicion)]];
  if (d.fechaOperacion && d.fechaOperacion !== d.fechaExpedicion) datos.push(["Fecha de operación", fechaES(d.fechaOperacion)]);
  if (d.vencimiento) datos.push(["Vencimiento", fechaES(d.vencimiento)]);
  if (d.referencia) datos.push(["Referencia / pedido", d.referencia]);
  const anchoDato = 104;
  datos.forEach(([k, v], i) => {
    const fila = Math.floor(i / 2), colD = i % 2;
    const x = derecha - (2 - colD) * anchoDato + 8;
    const yy = y + 8 - fila * 28;
    rotulo(pagina, k, x, yy);
    escribir(pagina, partir(v, anchoDato - 10, 9.5, negrita)[0], x, yy - 13, { tam: 9.5, fuente: negrita });
  });
  y -= Math.max(32, Math.ceil(datos.length / 2) * 28 + 4) + 8;

  if (d.entornoPruebas) {
    pagina.drawRectangle({ x: MARGEN, y: y - 18, width: ancho, height: 22, borderColor: ROJO, borderWidth: 0.8 });
    escribir(pagina, "ENTORNO DE PRUEBAS · Documento sin validez fiscal, no remitido a la AEAT", MARGEN + 10, y - 10, { tam: 8, fuente: negrita, color: ROJO });
    y -= 34;
  }

  // ── Cliente a la izquierda; total a pagar destacado a la derecha
  const anchoTarjeta = 190;
  const xTarjeta = derecha - anchoTarjeta;
  const altoTarjeta = d.vencimiento ? 74 : 62;
  let yc = y;
  if (d.destinatario) {
    const t = d.destinatario;
    rotulo(pagina, "Facturar a", MARGEN, yc);
    yc -= 16;
    escribir(pagina, partir(t.razonSocial, xTarjeta - MARGEN - 24, 10.5, negrita)[0] ?? "", MARGEN, yc, { tam: 10.5, fuente: negrita });
    yc -= 13;
    const pais = t.pais && t.pais !== "ES" ? PAISES[t.pais] ?? t.pais : null;
    const filas = [
      t.nif ? `NIF ${t.nif}` : null,
      t.direccion,
      [t.codigoPostal, t.municipio, t.provincia ? `(${t.provincia})` : null].filter(Boolean).join(" ") || null,
      pais,
      t.email,
    ].filter(Boolean) as string[];
    for (const f of filas) {
      for (const l of partir(f, xTarjeta - MARGEN - 24, 8.5)) { escribir(pagina, l, MARGEN, yc, { tam: 8.5, color: GRIS }); yc -= 11.5; }
    }
  }
  pagina.drawRectangle({ x: xTarjeta, y: y - altoTarjeta + 6, width: anchoTarjeta, height: altoTarjeta, color: FONDO });
  pagina.drawRectangle({ x: xTarjeta, y: y - altoTarjeta + 6, width: 2.5, height: altoTarjeta, color: TINTA });
  rotulo(pagina, "Total a pagar", derecha - 14, y - 10, true);
  escribir(pagina, formatearEuros(d.totalCent), derecha - 14, y - 36, { tam: 21, fuente: negrita, derecha: true });
  if (d.vencimiento) escribir(pagina, `Vence el ${fechaES(d.vencimiento)}`, derecha - 14, y - 52, { tam: 8, color: GRIS, derecha: true });
  y = Math.min(yc, y - altoTarjeta) - 22;

  if (d.rectifica) {
    const r = d.rectifica;
    const texto = `Rectifica la factura ${r.numSerie} de ${fechaES(r.fechaExpedicion)} (${r.tipo === "S" ? "por sustitución" : "por diferencias"}).` +
      (r.motivo ? ` Motivo: ${r.motivo}` : "");
    for (const l of partir(texto, ancho, 9)) { escribir(pagina, l, MARGEN, y); y -= 12; }
    y -= 10;
  }

  // ── Detalle: concepto, cantidad, precio unitario, descuento, base, IVA e importe
  const col = { imp: derecha, iva: derecha - 74, base: derecha - 112, dto: derecha - 178, precio: derecha - 212, cant: derecha - 276 };
  const anchoConcepto = col.cant - 40 - MARGEN;
  function cabeceraTabla() {
    rotulo(pagina, "Descripción", MARGEN, y);
    rotulo(pagina, "Cant.", col.cant, y, true);
    rotulo(pagina, "Precio unit.", col.precio, y, true);
    rotulo(pagina, "Dto.", col.dto, y, true);
    rotulo(pagina, "Base imp.", col.base, y, true);
    rotulo(pagina, "IVA", col.iva, y, true);
    rotulo(pagina, "Importe", col.imp, y, true);
    y -= 8;
    raya(pagina, MARGEN, derecha, y, 0.8, TINTA);
    y -= 15;
  }
  asegurar(60);
  cabeceraTabla();
  enTabla = true;
  let brutoCent = 0;
  for (const l of d.lineas) {
    const texto = partir(l.concepto, anchoConcepto, 9);
    asegurar(texto.length * 11.5 + 12);
    const cuota = l.causaIva ? 0 : Math.round((l.baseCent * l.tipoIva) / 100);
    brutoCent += Math.round(l.cantidad * l.precioUnitarioCent);
    texto.forEach((t, i) => escribir(pagina, t, MARGEN, y - i * 11.5));
    escribir(pagina, num(l.cantidad), col.cant, y, { derecha: true });
    escribir(pagina, formatearEuros(l.precioUnitarioCent), col.precio, y, { derecha: true });
    escribir(pagina, l.descuentoPct ? pct(l.descuentoPct) : "-", col.dto, y, { derecha: true, color: l.descuentoPct ? TINTA : GRIS });
    escribir(pagina, formatearEuros(l.baseCent), col.base, y, { derecha: true });
    escribir(pagina, l.causaIva ? l.causaIva : pct(l.tipoIva), col.iva, y, { derecha: true });
    escribir(pagina, formatearEuros(l.baseCent + cuota), col.imp, y, { derecha: true, fuente: negrita });
    y -= (texto.length - 1) * 11.5 + 9;
    raya(pagina, MARGEN, derecha, y);
    y -= 14;
  }
  enTabla = false;

  // ── Datos de pago (izquierda) y resumen económico (derecha)
  const descuentoCent = brutoCent - d.baseCent;
  const resumen: { k: string; v: string }[] = [];
  if (descuentoCent > 0) {
    resumen.push({ k: "Subtotal", v: formatearEuros(brutoCent) });
    resumen.push({ k: "Descuentos", v: `-${formatearEuros(descuentoCent)}` });
  }
  resumen.push({ k: "Base imponible", v: formatearEuros(d.baseCent) });
  for (const g of d.desglose) {
    if (g.causaIva) {
      const tipo = g.causaIva.startsWith("E") ? "Exenta" : g.causaIva.startsWith("N") ? "No sujeta" : "Inversión sujeto pasivo";
      resumen.push({ k: `${tipo} (${g.causaIva}) · base ${formatearEuros(g.baseCent)}`, v: formatearEuros(0) });
    } else {
      resumen.push({ k: `IVA ${pct(g.tipoIva)} · base ${formatearEuros(g.baseCent)}`, v: formatearEuros(g.cuotaCent) });
    }
  }
  if (d.retencionCent) resumen.push({ k: `Retención IRPF ${pct(d.retencionPct)}`, v: `-${formatearEuros(d.retencionCent)}` });

  const pago: [string, string][] = [];
  if (e.iban) {
    pago.push(["Titular", e.titularCuenta || e.razonSocial]);
    if (e.banco) pago.push(["Entidad", e.banco]);
    pago.push(["IBAN", formatearIban(e.iban)]);
    if (e.bic) pago.push(["BIC/SWIFT", e.bic]);
  }
  if (d.metodoCobro) pago.push(["Forma de pago", d.metodoCobro]);
  if (d.vencimiento) pago.push(["Fecha límite", fechaES(d.vencimiento)]);

  const altoResumen = resumen.length * 15 + 44;
  const altoPago = pago.length ? pago.length * 13 + 22 : 0;
  asegurar(Math.max(altoResumen, altoPago) + 10);
  y -= 6;
  const xResumen = derecha - 236;
  let yr = y;
  for (const r of resumen) {
    escribir(pagina, r.k, xResumen, yr, { tam: 8.5, color: GRIS });
    escribir(pagina, r.v, derecha, yr, { tam: 9, derecha: true });
    yr -= 15;
  }
  yr += 4;
  raya(pagina, xResumen, derecha, yr, 1.2, TINTA);
  yr -= 20;
  escribir(pagina, "TOTAL A PAGAR", xResumen, yr, { tam: 9, fuente: negrita, espaciado: 0.8 });
  escribir(pagina, formatearEuros(d.totalCent), derecha, yr - 1, { tam: 15, fuente: negrita, derecha: true });
  yr -= 12;

  let yp = y;
  if (pago.length) {
    rotulo(pagina, "Datos de pago", MARGEN, yp);
    yp -= 17;
    for (const [k, v] of pago) {
      escribir(pagina, k, MARGEN, yp, { tam: 8, color: GRIS });
      escribir(pagina, partir(v, xResumen - MARGEN - 100, 8.5, k === "IBAN" ? negrita : normal)[0] ?? "", MARGEN + 72, yp, { tam: 8.5, fuente: k === "IBAN" ? negrita : normal });
      yp -= 13;
    }
  }
  y = Math.min(yr, yp) - 22;

  // ── Observaciones, condiciones e información legal (art. 6 RD 1619/2012)
  const menciones = [...new Set(d.desglose.map((g) => causaIva(g.causaIva)?.mencion).filter(Boolean))] as string[];
  const bloques: [string, string[]][] = [];
  if (d.observaciones) bloques.push(["Observaciones", [d.observaciones]]);
  if (d.condicionesPago) bloques.push(["Condiciones de pago", [d.condicionesPago]]);
  if (menciones.length) bloques.push(["Información legal", menciones]);
  for (const [k, textos] of bloques) {
    const lineas = textos.flatMap((t) => partir(t, ancho, 8.5));
    asegurar(18 + Math.min(lineas.length, 3) * 11.5);
    rotulo(pagina, k, MARGEN, y);
    y -= 14;
    for (const l of lineas) { asegurar(12); escribir(pagina, l, MARGEN, y, { tam: 8.5 }); y -= 11.5; }
    y -= 10;
  }
  if (e.agradecimiento) {
    const lineas = partir(e.agradecimiento, ancho, 10, cursiva);
    asegurar(lineas.length * 13 + 6);
    y -= 4;
    for (const l of lineas) { escribir(pagina, l, MARGEN, y, { tam: 10, fuente: cursiva }); y -= 13; }
  }

  // ── Pie en todas las páginas, marca de anulación y numeración
  const paginas = pdf.getPages();
  paginas.forEach((p, i) => {
    let yy = MARGEN - 18 + altoPie;
    raya(p, MARGEN, derecha, yy);
    yy -= 12;
    for (const l of lineasPie) { escribir(p, l, MARGEN, yy, { tam: 7, color: GRIS }); yy -= 9; }
    for (const l of lineasRegistro) { escribir(p, l, MARGEN, yy, { tam: 6.5, color: GRIS }); yy -= 8.5; }
    escribir(p, `${d.numSerie}  ·  ${i + 1} / ${paginas.length}`, derecha, MARGEN - 18, { tam: 7, color: GRIS, derecha: true });
    if (d.anulada) {
      p.drawText("ANULADA", { x: 150, y: 330, size: 90, font: negrita, color: ROJO, opacity: 0.15, rotate: degrees(30) });
    }
  });

  return pdf.save({ useObjectStreams: false });
}
