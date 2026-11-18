import { escaparXML } from "@/lib/verifactu/xml";
import type { DatosFacturaPDF } from "./pdf";

/**
 * Factura electrónica en formato Facturae 3.2.2 (Orden HAP/1650/2015), el que admite FACe y uno de
 * los formatos aceptados para la factura electrónica entre empresas (Ley 18/2022). Se genera sin firma:
 * para enviarla a FACe hay que firmarla (XAdES) con el certificado de la empresa, por ejemplo con AutoFirma.
 */

export const NS_FACTURAE = "http://www.facturae.gob.es/formato/Versiones/Facturaev3_2_2.xml";
export class ErrorFacturae extends Error {}

const ISO3: Record<string, string> = {
  ES: "ESP", PT: "PRT", FR: "FRA", DE: "DEU", IT: "ITA", NL: "NLD", BE: "BEL", LU: "LUX", IE: "IRL", AT: "AUT", DK: "DNK", SE: "SWE",
  FI: "FIN", PL: "POL", CZ: "CZE", SK: "SVK", HU: "HUN", RO: "ROU", BG: "BGR", GR: "GRC", HR: "HRV", SI: "SVN", EE: "EST", LV: "LVA",
  LT: "LTU", CY: "CYP", MT: "MLT", GB: "GBR", CH: "CHE", NO: "NOR", AD: "AND", US: "USA", MX: "MEX", CO: "COL", AR: "ARG", CL: "CHL",
  PE: "PER", MA: "MAR", CN: "CHN",
};
const UE = new Set(["PT", "FR", "DE", "IT", "NL", "BE", "LU", "IE", "AT", "DK", "SE", "FI", "PL", "CZ", "SK", "HU", "RO", "BG", "GR", "HR", "SI", "EE", "LV", "LT", "CY", "MT"]);
// Motivos de rectificación del esquema (ReasonCode → ReasonDescription). Por defecto, «Base imponible».
const MOTIVO = { codigo: "16", descripcion: "Base imponible" };

const e = (t: string | null | undefined, max: number) => escaparXML((t ?? "").trim().slice(0, max));
const eur = (cent: number) => (cent / 100).toFixed(2);
const tasa = (p: number) => p.toFixed(2);
const fin = (mes: string) => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** cantidad (hasta 4 decimales) × precio en céntimos, exacto, con 6 decimales. */
function costeLinea(cantidad: number, precioCent: number): { texto: string; cent: number } {
  const micro = BigInt(Math.round(cantidad * 10000)) * BigInt(precioCent); // 1e-6 €
  const neg = micro < 0n, abs = neg ? -micro : micro;
  const ent = abs / 1000000n, dec = (abs % 1000000n).toString().padStart(6, "0");
  return { texto: `${neg ? "-" : ""}${ent}.${dec}`, cent: Number(micro) / 10000 };
}

const esPersonaFisica = (nif: string) => /^[0-9KLMXYZ]/i.test(nif);

function direccion(d: { direccion?: string | null; codigoPostal?: string | null; municipio?: string | null; provincia?: string | null; pais?: string | null }) {
  const pais = (d.pais ?? "ES").toUpperCase();
  if (pais === "ES") {
    const cp = (d.codigoPostal ?? "").trim();
    if (!/^\d{5}$/.test(cp) || !d.direccion || !d.municipio || !d.provincia) throw new ErrorFacturae("Faltan la dirección, el código postal, el municipio o la provincia del cliente");
    return `<AddressInSpain><Address>${e(d.direccion, 80)}</Address><PostCode>${cp}</PostCode><Town>${e(d.municipio, 50)}</Town><Province>${e(d.provincia, 20)}</Province><CountryCode>ESP</CountryCode></AddressInSpain>`;
  }
  const iso3 = ISO3[pais];
  if (!iso3) throw new ErrorFacturae(`País del cliente no admitido en Facturae: ${pais}`);
  return `<OverseasAddress><Address>${e(d.direccion, 80)}</Address><PostCodeAndTown>${e(`${d.codigoPostal ?? ""} ${d.municipio ?? ""}`, 50)}</PostCodeAndTown><Province>${e(d.provincia || d.municipio, 20)}</Province><CountryCode>${iso3}</CountryCode></OverseasAddress>`;
}

function parte(p: { razonSocial: string; nif: string; residencia: "R" | "U" | "E"; direccionXML: string }) {
  const fisica = esPersonaFisica(p.nif);
  const nif = p.residencia === "R" ? p.nif.toUpperCase() : p.nif;
  let nombre: string;
  if (fisica) {
    const [n, ...ap] = p.razonSocial.trim().split(/\s+/);
    nombre = `<Individual><Name>${e(n, 40)}</Name><FirstSurname>${e(ap[0] ?? "-", 40)}</FirstSurname>${ap.length > 1 ? `<SecondSurname>${e(ap.slice(1).join(" "), 40)}</SecondSurname>` : ""}${p.direccionXML}</Individual>`;
  } else {
    nombre = `<LegalEntity><CorporateName>${e(p.razonSocial, 80)}</CorporateName>${p.direccionXML}</LegalEntity>`;
  }
  return `<TaxIdentification><PersonTypeCode>${fisica ? "F" : "J"}</PersonTypeCode><ResidenceTypeCode>${p.residencia}</ResidenceTypeCode><TaxIdentificationNumber>${e(nif, 30)}</TaxIdentificationNumber></TaxIdentification>${nombre}`;
}

function medioDePago(metodo: string | null | undefined, iban: string | null | undefined): { codigo: string; iban?: string } | null {
  const m = (metodo ?? "").toLowerCase();
  if (m.includes("domicili") || m.includes("recibo")) return { codigo: "02" };
  if (m.includes("efectivo") || m.includes("contado")) return { codigo: "01" };
  if (iban) return { codigo: "04", iban: iban.replace(/\s/g, "") };
  return null;
}

export function facturaeXML(d: DatosFacturaPDF): string {
  if (d.anulada) throw new ErrorFacturae("La factura está anulada");
  if (!d.destinatario?.nif) throw new ErrorFacturae("Facturae exige identificar al cliente: no se puede generar para una factura simplificada sin destinatario");
  if (d.desglose.some((x) => x.tipoIva === 0)) throw new ErrorFacturae("Las líneas al 0 % necesitan la causa de exención, que aún no se recoge");

  const pais = (d.destinatario.pais ?? "ES").toUpperCase();
  const residencia = pais === "ES" ? "R" : UE.has(pais) ? "U" : "E";
  const m = /^(.*)-(\d+)$/.exec(d.numSerie);
  const [serie, numero] = m ? [m[1], m[2]] : ["", d.numSerie];
  const total = d.baseCent + d.cuotaIvaCent - d.retencionCent;
  const importe = (c: number) => `<TotalAmount>${eur(c)}</TotalAmount>`;

  const lineas = d.lineas.map((l) => {
    const coste = costeLinea(l.cantidad, l.precioUnitarioCent);
    const dto = l.descuentoPct ? `<DiscountsAndRebates><Discount><DiscountReason>Descuento</DiscountReason><DiscountRate>${tasa(l.descuentoPct)}</DiscountRate><DiscountAmount>${(coste.cent / 100 - l.baseCent / 100).toFixed(6)}</DiscountAmount></Discount></DiscountsAndRebates>` : "";
    const ret = d.retencionPct ? `<TaxesWithheld><Tax><TaxTypeCode>04</TaxTypeCode><TaxRate>${tasa(d.retencionPct)}</TaxRate><TaxableBase>${importe(l.baseCent)}</TaxableBase><TaxAmount>${importe(Math.round((l.baseCent * d.retencionPct) / 100))}</TaxAmount></Tax></TaxesWithheld>` : "";
    return `<InvoiceLine><ItemDescription>${e(l.concepto, 2500)}</ItemDescription><Quantity>${l.cantidad}</Quantity><UnitOfMeasure>01</UnitOfMeasure>` +
      `<UnitPriceWithoutTax>${eur(l.precioUnitarioCent)}</UnitPriceWithoutTax><TotalCost>${coste.texto}</TotalCost>${dto}<GrossAmount>${eur(l.baseCent)}</GrossAmount>${ret}` +
      `<TaxesOutputs><Tax><TaxTypeCode>01</TaxTypeCode><TaxRate>${tasa(l.tipoIva)}</TaxRate><TaxableBase>${importe(l.baseCent)}</TaxableBase><TaxAmount>${importe(Math.round((l.baseCent * l.tipoIva) / 100))}</TaxAmount></Tax></TaxesOutputs></InvoiceLine>`;
  }).join("");

  const impuestos = d.desglose.map((x) => `<Tax><TaxTypeCode>01</TaxTypeCode><TaxRate>${tasa(x.tipoIva)}</TaxRate><TaxableBase>${importe(x.baseCent)}</TaxableBase><TaxAmount>${importe(x.cuotaCent)}</TaxAmount></Tax>`).join("");
  const retenciones = d.retencionCent ? `<TaxesWithheld><Tax><TaxTypeCode>04</TaxTypeCode><TaxRate>${tasa(d.retencionPct)}</TaxRate><TaxableBase>${importe(d.baseCent)}</TaxableBase><TaxAmount>${importe(d.retencionCent)}</TaxAmount></Tax></TaxesWithheld>` : "";

  let rectificativa = "";
  if (d.rectifica) {
    const o = /^(.*)-(\d+)$/.exec(d.rectifica.numSerie);
    const mes = d.rectifica.fechaExpedicion.slice(0, 7);
    const integra = d.rectifica.tipo === "S";
    rectificativa = `<Corrective><InvoiceNumber>${e(o ? o[2] : d.rectifica.numSerie, 20)}</InvoiceNumber>${o ? `<InvoiceSeriesCode>${e(o[1], 20)}</InvoiceSeriesCode>` : ""}` +
      `<ReasonCode>${MOTIVO.codigo}</ReasonCode><ReasonDescription>${MOTIVO.descripcion}</ReasonDescription>` +
      `<TaxPeriod><StartDate>${mes}-01</StartDate><EndDate>${fin(mes)}</EndDate></TaxPeriod>` +
      `<CorrectionMethod>${integra ? "01" : "02"}</CorrectionMethod><CorrectionMethodDescription>${integra ? "Rectificación íntegra" : "Rectificación por diferencias"}</CorrectionMethodDescription>` +
      `${d.rectifica.motivo ? `<AdditionalReasonDescription>${e(d.rectifica.motivo, 2500)}</AdditionalReasonDescription>` : ""}<InvoiceIssueDate>${d.rectifica.fechaExpedicion}</InvoiceIssueDate></Corrective>`;
  }

  const pago = d.vencimiento ? medioDePago(d.metodoCobro, d.emisor.iban) : null;
  const pagos = pago ? `<PaymentDetails><Installment><InstallmentDueDate>${d.vencimiento}</InstallmentDueDate><InstallmentAmount>${eur(total)}</InstallmentAmount><PaymentMeans>${pago.codigo}</PaymentMeans>` +
    `${pago.iban ? `<AccountToBeCredited><IBAN>${e(pago.iban, 34)}</IBAN></AccountToBeCredited>` : ""}</Installment></PaymentDetails>` : "";
  const notas = d.observaciones ? `<AdditionalData><InvoiceAdditionalInformation>${e(d.observaciones, 2500)}</InvoiceAdditionalInformation></AdditionalData>` : "";

  const vendedor = parte({ razonSocial: d.emisor.razonSocial, nif: d.emisor.nif, residencia: "R",
    direccionXML: direccion({ direccion: d.emisor.domicilio, codigoPostal: d.emisor.codigoPostal, municipio: d.emisor.municipio, provincia: d.emisor.provincia, pais: "ES" }) });
  const comprador = parte({ razonSocial: d.destinatario.razonSocial, nif: d.destinatario.nif, residencia, direccionXML: direccion({ ...d.destinatario, pais }) });

  return `<?xml version="1.0" encoding="UTF-8"?>\n<fe:Facturae xmlns:fe="${NS_FACTURAE}" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">` +
    `<FileHeader><SchemaVersion>3.2.2</SchemaVersion><Modality>I</Modality><InvoiceIssuerType>EM</InvoiceIssuerType><Batch>` +
    `<BatchIdentifier>${e(`${d.emisor.nif}${d.numSerie}`, 70)}</BatchIdentifier><InvoicesCount>1</InvoicesCount>` +
    `<TotalInvoicesAmount>${importe(total)}</TotalInvoicesAmount><TotalOutstandingAmount>${importe(total)}</TotalOutstandingAmount>` +
    `<TotalExecutableAmount>${importe(total)}</TotalExecutableAmount><InvoiceCurrencyCode>EUR</InvoiceCurrencyCode></Batch></FileHeader>` +
    `<Parties><SellerParty>${vendedor}</SellerParty><BuyerParty>${comprador}</BuyerParty></Parties>` +
    `<Invoices><Invoice><InvoiceHeader><InvoiceNumber>${e(numero, 20)}</InvoiceNumber>${serie ? `<InvoiceSeriesCode>${e(serie, 20)}</InvoiceSeriesCode>` : ""}` +
    `<InvoiceDocumentType>${d.tipoFactura === "F2" || d.tipoFactura === "R5" ? "FA" : "FC"}</InvoiceDocumentType><InvoiceClass>${d.rectifica ? "OR" : "OO"}</InvoiceClass>${rectificativa}</InvoiceHeader>` +
    `<InvoiceIssueData><IssueDate>${d.fechaExpedicion}</IssueDate>${d.fechaOperacion && d.fechaOperacion !== d.fechaExpedicion ? `<OperationDate>${d.fechaOperacion}</OperationDate>` : ""}` +
    `<InvoiceCurrencyCode>EUR</InvoiceCurrencyCode><TaxCurrencyCode>EUR</TaxCurrencyCode><LanguageName>es</LanguageName></InvoiceIssueData>` +
    `<TaxesOutputs>${impuestos}</TaxesOutputs>${retenciones}` +
    `<InvoiceTotals><TotalGrossAmount>${eur(d.baseCent)}</TotalGrossAmount><TotalGrossAmountBeforeTaxes>${eur(d.baseCent)}</TotalGrossAmountBeforeTaxes>` +
    `<TotalTaxOutputs>${eur(d.cuotaIvaCent)}</TotalTaxOutputs><TotalTaxesWithheld>${eur(d.retencionCent)}</TotalTaxesWithheld><InvoiceTotal>${eur(total)}</InvoiceTotal>` +
    `<TotalOutstandingAmount>${eur(total)}</TotalOutstandingAmount><TotalExecutableAmount>${eur(total)}</TotalExecutableAmount></InvoiceTotals>` +
    `<Items>${lineas}</Items>${pagos}${notas}</Invoice></Invoices></fe:Facturae>\n`;
}
