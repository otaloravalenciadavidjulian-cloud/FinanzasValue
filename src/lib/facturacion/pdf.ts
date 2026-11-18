import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { causaIva } from "@/lib/fiscal/exenciones";
import QRCode from "qrcode";
import { formatearEuros } from "../fiscal/dinero";
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
    /** PNG o JPG. */
    logo?: { bytes: Uint8Array; mime: string } | null;
  };
  destinatario: {
    razonSocial: string; nif: string; direccion?: string | null; codigoPostal?: string | null;
    municipio?: string | null; provincia?: string | null; pais?: string | null;
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
  anulada: boolean;
  urlQR: string;
  entornoPruebas: boolean;
}

const A4 = { ancho: 595.28, alto: 841.89 };
const MARGEN = 42;
const MM = 72 / 25.4;
const GRIS = rgb(0.38, 0.4, 0.45);
const TINTA = rgb(0.09, 0.11, 0.16);
const LINEA = rgb(0.85, 0.87, 0.9);
const ROJO = rgb(0.75, 0.1, 0.1);

export const fechaES = (iso: string) => iso.split("-").reverse().join("/");

function titulo(tipo: string): string {
  if (tipo.startsWith("R")) return "FACTURA RECTIFICATIVA";
  if (tipo === "F2") return "FACTURA SIMPLIFICADA";
  return "FACTURA";
}

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
  const admitidos = new Set(normal.getCharacterSet());
  // Las fuentes estándar usan WinAnsi: se sustituye lo que no se puede representar.
  const limpio = (t: string) => Array.from(t.replace(/[−–—]/g, "-").replace(/[  ]/g, " "))
    .map((c) => (admitidos.has(c.codePointAt(0)!) ? c : "?")).join("");

  let pagina = pdf.addPage([A4.ancho, A4.alto]);
  let y = A4.alto - MARGEN;

  const escribir = (p: PDFPage, texto: string, x: number, yy: number, o: { tam?: number; fuente?: PDFFont; color?: ReturnType<typeof rgb>; derecha?: boolean } = {}) => {
    const tam = o.tam ?? 9;
    const fuente = o.fuente ?? normal;
    const t = limpio(texto);
    const xx = o.derecha ? x - fuente.widthOfTextAtSize(t, tam) : x;
    p.drawText(t, { x: xx, y: yy, size: tam, font: fuente, color: o.color ?? TINTA });
  };

  const partir = (texto: string, ancho: number, tam: number, fuente: PDFFont = normal): string[] => {
    const lineas: string[] = [];
    for (const parrafo of limpio(texto).split(/\n/)) {
      let actual = "";
      for (const palabra of parrafo.split(/\s+/)) {
        const prueba = actual ? `${actual} ${palabra}` : palabra;
        if (fuente.widthOfTextAtSize(prueba, tam) <= ancho) { actual = prueba; continue; }
        if (actual) lineas.push(actual);
        actual = palabra;
        while (fuente.widthOfTextAtSize(actual, tam) > ancho && actual.length > 1) {
          let corte = actual.length - 1;
          while (corte > 1 && fuente.widthOfTextAtSize(actual.slice(0, corte), tam) > ancho) corte--;
          lineas.push(actual.slice(0, corte));
          actual = actual.slice(corte);
        }
      }
      lineas.push(actual);
    }
    return lineas;
  };

  // Texto libre de la empresa al pie de cada página: se reserva su sitio para que el contenido no lo pise.
  const lineasPie = d.emisor.textoPie ? partir(d.emisor.textoPie, A4.ancho - 2 * MARGEN, 7) : [];
  const reservaPie = lineasPie.length ? lineasPie.length * 9 + 6 : 0;
  const nuevaPaginaSiHaceFalta = (alto: number) => {
    if (y - alto >= MARGEN + 30 + reservaPie) return;
    pagina = pdf.addPage([A4.ancho, A4.alto]);
    y = A4.alto - MARGEN;
    escribir(pagina, `${titulo(d.tipoFactura)} ${d.numSerie} (continuación)`, MARGEN, y, { fuente: negrita, tam: 10 });
    y -= 24;
  };

  // QR tributario al inicio de la factura, entre 30 y 40 mm, con nivel de corrección M.
  const ladoQR = 32 * MM;
  const png = await QRCode.toBuffer(d.urlQR, { errorCorrectionLevel: "M", type: "png", margin: 0, width: 400 });
  const qr = await pdf.embedPng(png);
  const xQR = A4.ancho - MARGEN - ladoQR;
  escribir(pagina, "QR tributario:", xQR, y - 2, { tam: 7, color: GRIS });
  pagina.drawImage(qr, { x: xQR, y: y - 8 - ladoQR, width: ladoQR, height: ladoQR });
  escribir(pagina, "VERI*FACTU", xQR + ladoQR / 2 - negrita.widthOfTextAtSize("VERI*FACTU", 8) / 2, y - 20 - ladoQR, { tam: 8, fuente: negrita });
  for (const [i, l] of partir(LEYENDA_VERIFACTU, ladoQR + 20, 6).entries()) {
    escribir(pagina, l, xQR - 10, y - 30 - ladoQR - i * 7.5, { tam: 6, color: GRIS });
  }

  // Emisor, con su logotipo encima (como máximo 160 × 48 puntos); sin logotipo propio, el de Value.
  const e = d.emisor;
  const logo = e.logo ?? { bytes: LOGO_VALUE_PNG, mime: "image/png" };
  let yLogo = y;
  {
    try {
      const img = logo.mime === "image/png" ? await pdf.embedPng(logo.bytes) : await pdf.embedJpg(logo.bytes);
      const escala = Math.min(160 / img.width, 48 / img.height, 1);
      pagina.drawImage(img, { x: MARGEN, y: y - img.height * escala, width: img.width * escala, height: img.height * escala });
      yLogo = y - img.height * escala - 8;
    } catch { /* Un logotipo dañado no impide generar la factura. */ }
  }
  escribir(pagina, e.razonSocial, MARGEN, yLogo - 10, { tam: 15, fuente: negrita });
  let ye = yLogo - 26;
  const datosEmisor = [
    e.nombreComercial && e.nombreComercial !== e.razonSocial ? e.nombreComercial : null,
    `NIF ${e.nif}`,
    e.domicilio,
    `${e.codigoPostal} ${e.municipio} (${e.provincia})`,
    [e.telefono, e.email].filter(Boolean).join(" · ") || null,
  ].filter(Boolean) as string[];
  for (const l of datosEmisor) { escribir(pagina, l, MARGEN, ye, { color: GRIS }); ye -= 12; }

  // Título y datos de la factura
  ye -= 14;
  escribir(pagina, titulo(d.tipoFactura), MARGEN, ye, { tam: 18, fuente: negrita });
  ye -= 18;
  const datosFactura: [string, string][] = [
    ["Número", d.numSerie],
    ["Fecha de expedición", fechaES(d.fechaExpedicion)],
  ];
  if (d.fechaOperacion && d.fechaOperacion !== d.fechaExpedicion) datosFactura.push(["Fecha de la operación", fechaES(d.fechaOperacion)]);
  if (d.vencimiento) datosFactura.push(["Vencimiento", fechaES(d.vencimiento)]);
  for (const [k, v] of datosFactura) {
    escribir(pagina, k, MARGEN, ye, { color: GRIS });
    escribir(pagina, v, MARGEN + 110, ye, { fuente: negrita });
    ye -= 12;
  }
  y = Math.min(ye, y - 40 - ladoQR - 16) - 10;

  if (d.entornoPruebas) {
    pagina.drawRectangle({ x: MARGEN, y: y - 16, width: A4.ancho - 2 * MARGEN, height: 20, color: rgb(1, 0.93, 0.93) });
    escribir(pagina, "ENTORNO DE PRUEBAS: documento sin validez fiscal, no remitido a la AEAT", MARGEN + 8, y - 10, { fuente: negrita, color: ROJO });
    y -= 30;
  }

  // Destinatario
  if (d.destinatario) {
    const t = d.destinatario;
    const filas = [
      t.razonSocial,
      `NIF ${t.nif}`,
      t.direccion,
      [t.codigoPostal, t.municipio, t.provincia ? `(${t.provincia})` : null].filter(Boolean).join(" ") || null,
      t.pais && t.pais !== "ES" ? t.pais : null,
    ].filter(Boolean) as string[];
    const alto = 22 + filas.length * 12;
    pagina.drawRectangle({ x: MARGEN, y: y - alto, width: 260, height: alto, borderColor: LINEA, borderWidth: 1 });
    escribir(pagina, "CLIENTE", MARGEN + 10, y - 14, { tam: 7, color: GRIS, fuente: negrita });
    filas.forEach((l, i) => escribir(pagina, l, MARGEN + 10, y - 28 - i * 12, { fuente: i === 0 ? negrita : normal }));
    y -= alto + 18;
  }

  if (d.rectifica) {
    const r = d.rectifica;
    const texto = `Rectifica la factura ${r.numSerie} de ${fechaES(r.fechaExpedicion)} (${r.tipo === "S" ? "por sustitución" : "por diferencias"}).` +
      (r.motivo ? ` Motivo: ${r.motivo}` : "");
    for (const l of partir(texto, A4.ancho - 2 * MARGEN, 9)) { escribir(pagina, l, MARGEN, y, {}); y -= 12; }
    y -= 6;
  }

  // Líneas
  const ancho = A4.ancho - 2 * MARGEN;
  const col = { concepto: MARGEN + 6, cantidad: MARGEN + ancho * 0.6, precio: MARGEN + ancho * 0.72, dto: MARGEN + ancho * 0.8, iva: MARGEN + ancho * 0.87, base: MARGEN + ancho - 6 };
  const cabecera = () => {
    pagina.drawRectangle({ x: MARGEN, y: y - 6, width: ancho, height: 18, color: rgb(0.95, 0.96, 0.97) });
    escribir(pagina, "Concepto", col.concepto, y, { fuente: negrita, tam: 8 });
    escribir(pagina, "Cantidad", col.cantidad, y, { fuente: negrita, tam: 8, derecha: true });
    escribir(pagina, "Precio", col.precio, y, { fuente: negrita, tam: 8, derecha: true });
    escribir(pagina, "Dto.", col.dto, y, { fuente: negrita, tam: 8, derecha: true });
    escribir(pagina, "IVA", col.iva, y, { fuente: negrita, tam: 8, derecha: true });
    escribir(pagina, "Base", col.base, y, { fuente: negrita, tam: 8, derecha: true });
    y -= 20;
  };
  cabecera();
  const num = (n: number) => n.toLocaleString("es-ES", { maximumFractionDigits: 4 });
  for (const l of d.lineas) {
    const texto = partir(l.concepto, ancho * 0.6 - 60, 9);
    const alto = texto.length * 11 + 10;
    if (y - alto < MARGEN + 30) { nuevaPaginaSiHaceFalta(alto + 40); cabecera(); }
    texto.forEach((t, i) => escribir(pagina, t, col.concepto, y - i * 11));
    escribir(pagina, num(l.cantidad), col.cantidad, y, { derecha: true });
    escribir(pagina, formatearEuros(l.precioUnitarioCent), col.precio, y, { derecha: true });
    escribir(pagina, l.descuentoPct ? `${num(l.descuentoPct)} %` : "", col.dto, y, { derecha: true });
    escribir(pagina, l.causaIva ? l.causaIva : `${num(l.tipoIva)} %`, col.iva, y, { derecha: true });
    escribir(pagina, formatearEuros(l.baseCent), col.base, y, { derecha: true });
    y -= alto;
    pagina.drawLine({ start: { x: MARGEN, y: y + 10 }, end: { x: MARGEN + ancho, y: y + 10 }, color: LINEA, thickness: 0.5 });
  }

  // Desglose y totales
  const filasTotales = d.desglose.length * 2 + (d.retencionCent ? 1 : 0) + 2;
  nuevaPaginaSiHaceFalta(filasTotales * 13 + 30);
  y -= 10;
  const xEtiqueta = MARGEN + ancho * 0.55;
  const fila = (k: string, v: string, fuerte = false) => {
    escribir(pagina, k, xEtiqueta, y, { fuente: fuerte ? negrita : normal, tam: fuerte ? 11 : 9, color: fuerte ? TINTA : GRIS });
    escribir(pagina, v, col.base, y, { fuente: fuerte ? negrita : normal, tam: fuerte ? 11 : 9, derecha: true });
    y -= fuerte ? 16 : 13;
  };
  for (const g of d.desglose) {
    if (g.causaIva) {
      // Etiqueta corta: la mención completa va debajo de los totales.
      const tipo = g.causaIva.startsWith("E") ? "exenta" : g.causaIva.startsWith("N") ? "no sujeta" : "inv. sujeto pasivo";
      fila(`Base ${tipo} (${g.causaIva})`, formatearEuros(g.baseCent));
      fila("Cuota de IVA", formatearEuros(0));
      continue;
    }
    fila(`Base imponible al ${num(g.tipoIva)} %`, formatearEuros(g.baseCent));
    fila(`Cuota de IVA (${num(g.tipoIva)} %)`, formatearEuros(g.cuotaCent));
  }
  if (d.retencionCent) fila(`Retención IRPF (${num(d.retencionPct)} %)`, `-${formatearEuros(d.retencionCent)}`);
  pagina.drawLine({ start: { x: xEtiqueta, y: y + 9 }, end: { x: MARGEN + ancho, y: y + 9 }, color: TINTA, thickness: 0.8 });
  y -= 4;
  fila("TOTAL FACTURA", formatearEuros(d.totalCent), true);

  // Cobro y observaciones. La mención de la exención es obligatoria (art. 6.1.j RD 1619/2012).
  const menciones = [...new Set(d.desglose.map((g) => causaIva(g.causaIva)?.mencion).filter(Boolean))] as string[];
  const notas = [
    ...menciones,
    d.metodoCobro ? `Forma de pago: ${d.metodoCobro}` : null,
    e.iban ? `Realizar el pago a la cuenta ${formatearIban(e.iban)}${e.banco ? ` (${e.banco})` : ""}` : null,
    d.condicionesPago ? `Condiciones: ${d.condicionesPago}` : null,
    d.observaciones ? `Observaciones: ${d.observaciones}` : null,
  ].filter(Boolean) as string[];
  if (notas.length) {
    y -= 10;
    for (const n of notas) {
      for (const l of partir(n, ancho, 8.5)) { nuevaPaginaSiHaceFalta(12); escribir(pagina, l, MARGEN, y, { tam: 8.5 }); y -= 11; }
    }
  }

  // Pie, marca de anulación y numeración de páginas
  const paginas = pdf.getPages();
  paginas.forEach((p, i) => {
    lineasPie.forEach((l, j) => escribir(p, l, MARGEN, MARGEN + (lineasPie.length - 1 - j) * 9, { tam: 7, color: GRIS }));
    if (e.datosRegistrales) escribir(p, e.datosRegistrales, MARGEN, MARGEN - 12, { tam: 6.5, color: GRIS });
    escribir(p, `Página ${i + 1} de ${paginas.length}`, A4.ancho - MARGEN, MARGEN - 12, { tam: 7, color: GRIS, derecha: true });
    if (d.anulada) {
      p.drawText("ANULADA", { x: 150, y: 330, size: 90, font: negrita, color: ROJO, opacity: 0.15, rotate: degrees(30) });
    }
  });

  return pdf.save({ useObjectStreams: false });
}
