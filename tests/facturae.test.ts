import { describe, expect, it } from "vitest";
import { ErrorFacturae, facturaeXML } from "@/lib/facturacion/facturae";
import type { DatosFacturaPDF } from "@/lib/facturacion/pdf";
import { hayXmllint, validarContraXSD } from "./xsd";

const XSD = "docs/facturae/xsd/Facturaev3_2_2.xsd";
const base = (extra: Partial<DatosFacturaPDF> = {}): DatosFacturaPDF => ({
  emisor: { razonSocial: "Value Demo, S.L.", nif: "B00000000", domicilio: "C/ Mayor 1", codigoPostal: "28013", municipio: "Madrid", provincia: "Madrid", iban: "ES91 2100 0418 4502 0005 1332" },
  destinatario: { razonSocial: "Cliente & Hijos, S.A.", nif: "A58818501", direccion: "Av. Diagonal 100", codigoPostal: "08019", municipio: "Barcelona", provincia: "Santa Cruz de Tenerife", pais: "ES" },
  numSerie: "A-2026-00007", tipoFactura: "F1", fechaExpedicion: "2026-11-17", fechaOperacion: null, vencimiento: "2026-12-17",
  lineas: [
    { concepto: "Consultoría <estratégica>", cantidad: 1.5, precioUnitarioCent: 33333, descuentoPct: 10, tipoIva: 21, baseCent: 45000 },
    { concepto: "Libro", cantidad: 2, precioUnitarioCent: 1000, descuentoPct: 0, tipoIva: 4, baseCent: 2000 },
  ],
  desglose: [{ tipoIva: 21, baseCent: 45000, cuotaCent: 9450 }, { tipoIva: 4, baseCent: 2000, cuotaCent: 80 }],
  baseCent: 47000, cuotaIvaCent: 9530, retencionPct: 15, retencionCent: 7050, totalCent: 49480,
  metodoCobro: "Transferencia", observaciones: "Gracias", anulada: false, urlQR: "", entornoPruebas: true, ...extra,
});

describe("Facturae 3.2.2", () => {
  it("genera una factura válida contra el XSD oficial", () => {
    const xml = facturaeXML(base());
    expect(xml).toContain("<InvoiceNumber>00007</InvoiceNumber><InvoiceSeriesCode>A-2026</InvoiceSeriesCode>");
    expect(xml).toContain("<InvoiceTotal>494.80</InvoiceTotal>");
    expect(xml).toContain("<TotalCost>499.995000</TotalCost>");
    expect(xml).toContain("<Province>Santa Cruz de Teneri</Province>");
    expect(xml).toContain("Consultoría &lt;estratégica&gt;");
    expect(xml).toContain("<IBAN>ES9121000418450200051332</IBAN>");
    if (hayXmllint) expect(validarContraXSD(xml, XSD)).toBeNull();
  });

  it("rectificativa por diferencias a persona física de otro país de la UE", () => {
    const xml = facturaeXML(base({
      tipoFactura: "R1", numSerie: "R-2026-00001", vencimiento: null, retencionPct: 0, retencionCent: 0,
      destinatario: { razonSocial: "Ana María Souza Lima", nif: "123456789", direccion: "Rua Augusta 1", codigoPostal: "1100-048", municipio: "Lisboa", provincia: null, pais: "PT" },
      lineas: [{ concepto: "Abono", cantidad: -1, precioUnitarioCent: 10000, descuentoPct: 0, tipoIva: 21, baseCent: -10000 }],
      desglose: [{ tipoIva: 21, baseCent: -10000, cuotaCent: -2100 }], baseCent: -10000, cuotaIvaCent: -2100, totalCent: -12100,
      rectifica: { numSerie: "A-2026-00007", fechaExpedicion: "2026-11-17", tipo: "I", motivo: "Precio mal aplicado" },
    }));
    expect(xml).toContain("<InvoiceClass>OR</InvoiceClass>");
    expect(xml).toContain("<PersonTypeCode>F</PersonTypeCode><ResidenceTypeCode>U</ResidenceTypeCode>");
    expect(xml).toContain("<Name>Ana</Name><FirstSurname>María</FirstSurname><SecondSurname>Souza Lima</SecondSurname>");
    expect(xml).toContain("<CountryCode>PRT</CountryCode>");
    expect(xml).toContain("<TaxPeriod><StartDate>2026-11-01</StartDate><EndDate>2026-11-30</EndDate></TaxPeriod>");
    if (hayXmllint) expect(validarContraXSD(xml, XSD)).toBeNull();
  });

  it("rechaza lo que Facturae no admite", () => {
    expect(() => facturaeXML(base({ anulada: true }))).toThrow(ErrorFacturae);
    expect(() => facturaeXML(base({ destinatario: null }))).toThrow(ErrorFacturae);
    expect(() => facturaeXML(base({ destinatario: { ...base().destinatario!, codigoPostal: null } }))).toThrow(/código postal/);
  });
});
