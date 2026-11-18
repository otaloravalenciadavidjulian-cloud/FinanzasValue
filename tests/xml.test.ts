import { describe, expect, it } from "vitest";
import { cadenaAlta, cadenaAnulacion, huella } from "@/lib/verifactu/huella";
import { documentoXML, ErrorXML, sobreSOAP, type DatosRegistroAlta, type DatosRegistroAnulacion } from "@/lib/verifactu/xml";
import { hayXmllint, validarContraXSD } from "./xsd";

const emisor = { nif: "B12345674", razonSocial: "Empresa & Hijos S.L." };
const sistema = {
  nombreRazon: "Value Software", nif: "B12345674", nombre: "Value", id: "VL", version: "0.2.0",
  numeroInstalacion: "inst-1", soloVerifactu: true, multiplesObligados: true, indicadorMultiplesObligados: true,
};

function alta(anterior: DatosRegistroAlta["anterior"], extra: Partial<DatosRegistroAlta> = {}): DatosRegistroAlta {
  const base: Omit<DatosRegistroAlta, "huella"> = {
    tipo: "alta", emisor, numSerie: "A-2026-00001", fechaExpedicion: "2026-11-17", tipoFactura: "F1",
    descripcion: "Consultoría <estratégica>", destinatario: { razonSocial: "Cliente S.L.", nif: "B87654321" },
    desglose: [{ tipoIva: 21, baseCent: 100000, cuotaCent: 21000 }, { tipoIva: 10, baseCent: 5000, cuotaCent: 500 }],
    cuotaTotalCent: 21500, importeTotalCent: 126500, anterior, sistema, fechaHoraHuso: "2026-11-17T10:00:00+01:00", ...extra,
  };
  const h = huella(cadenaAlta({
    nifEmisor: emisor.nif, numSerie: base.numSerie, fechaExpedicion: base.fechaExpedicion, tipoFactura: base.tipoFactura,
    cuotaTotalCent: base.cuotaTotalCent, importeTotalCent: base.importeTotalCent, huellaAnterior: anterior?.huella ?? "", fechaHoraHuso: base.fechaHoraHuso,
  }));
  return { ...base, huella: h };
}

describe("XML de registros VERI*FACTU", () => {
  const r1 = alta(null);
  const r2 = alta({ numSerie: r1.numSerie, fechaExpedicion: r1.fechaExpedicion, huella: r1.huella }, {
    numSerie: "R-2026-00001", tipoFactura: "R1", desglose: [{ tipoIva: 21, baseCent: -10000, cuotaCent: -2100 }],
    cuotaTotalCent: -2100, importeTotalCent: -12100, destinatario: { razonSocial: "Client GmbH", nif: "DE123456789", pais: "DE" },
    rectificacion: { tipo: "I", facturas: [{ numSerie: r1.numSerie, fechaExpedicion: r1.fechaExpedicion }] },
  });
  const anul: DatosRegistroAnulacion = {
    tipo: "anulacion", emisor, numSerie: r1.numSerie, fechaExpedicion: r1.fechaExpedicion, sistema,
    anterior: { numSerie: r2.numSerie, fechaExpedicion: r2.fechaExpedicion, huella: r2.huella }, fechaHoraHuso: "2026-11-17T11:00:00+01:00",
    huella: huella(cadenaAnulacion({ nifEmisor: emisor.nif, numSerie: r1.numSerie, fechaExpedicion: r1.fechaExpedicion, huellaAnterior: r2.huella, fechaHoraHuso: "2026-11-17T11:00:00+01:00" })),
  };

  it("genera alta, rectificativa y anulación encadenadas", () => {
    const xml = documentoXML(emisor, [r1, r2, anul]);
    expect(xml).toContain("<sf:PrimerRegistro>S</sf:PrimerRegistro>");
    expect(xml).toContain(`<sf:Huella>${r1.huella}</sf:Huella></sf:RegistroAnterior>`);
    expect(xml).toContain("<sf:FechaExpedicionFactura>17-11-2026</sf:FechaExpedicionFactura>");
    expect(xml).toContain("<sf:ImporteTotal>1265.00</sf:ImporteTotal>");
    expect(xml).toContain("<sf:CuotaTotal>-21.00</sf:CuotaTotal>");
    expect(xml).toContain("Empresa &amp; Hijos S.L.");
    expect(xml).toContain("Consultoría &lt;estratégica&gt;");
    expect(xml).toContain("<sf:IDOtro><sf:CodigoPais>DE</sf:CodigoPais><sf:IDType>02</sf:IDType>");
    expect(xml).toContain("<sf:TipoRectificativa>I</sf:TipoRectificativa>");
    expect(xml).toContain("<sf:NumSerieFacturaAnulada>A-2026-00001</sf:NumSerieFacturaAnulada>");
  });

  it.runIf(hayXmllint)("cumple el esquema XSD de la AEAT", () => {
    expect(validarContraXSD(documentoXML(emisor, [r1, r2, anul]))).toBeNull();
  });

  it.runIf(hayXmllint)("una rectificativa por sustitución lleva los importes rectificados y valida", () => {
    const s = alta({ numSerie: r1.numSerie, fechaExpedicion: r1.fechaExpedicion, huella: r1.huella }, {
      numSerie: "R-2026-00002", tipoFactura: "R1",
      rectificacion: { tipo: "S", facturas: [{ numSerie: r1.numSerie, fechaExpedicion: r1.fechaExpedicion }], baseRectificadaCent: 105000, cuotaRectificadaCent: 21500 },
    });
    const xml = documentoXML(emisor, [s]);
    expect(xml).toContain("<sf:ImporteRectificacion><sf:BaseRectificada>1050.00</sf:BaseRectificada>");
    expect(validarContraXSD(xml)).toBeNull();
  });

  it("rechaza un registro cuya huella no corresponde a sus datos", () => {
    expect(() => documentoXML(emisor, [{ ...r1, importeTotalCent: 1 }])).toThrow(ErrorXML);
  });

  it("no adivina la causa de exención de las líneas al 0 %", () => {
    const r = alta(null, { desglose: [{ tipoIva: 0, baseCent: 1000, cuotaCent: 0 }], cuotaTotalCent: 0, importeTotalCent: 1000 });
    expect(() => documentoXML(emisor, [r])).toThrow(/exención/);
  });

  it("declara exentas, no sujetas e inversión del sujeto pasivo según su causa", () => {
    const r = alta(null, {
      desglose: [{ tipoIva: 21, baseCent: 1000, cuotaCent: 210 }, { tipoIva: 0, causaIva: "E2", baseCent: 2000, cuotaCent: 0 },
        { tipoIva: 0, causaIva: "E5", baseCent: 3000, cuotaCent: 0 }, { tipoIva: 0, causaIva: "N2", baseCent: 4000, cuotaCent: 0 },
        { tipoIva: 0, causaIva: "S2", baseCent: 5000, cuotaCent: 0 }],
      cuotaTotalCent: 210, importeTotalCent: 15210,
    });
    const xml = documentoXML(emisor, [r]);
    expect(xml).toContain("<sf:ClaveRegimen>02</sf:ClaveRegimen><sf:OperacionExenta>E2</sf:OperacionExenta><sf:BaseImponibleOimporteNoSujeto>20.00</sf:BaseImponibleOimporteNoSujeto>");
    expect(xml).toContain("<sf:OperacionExenta>E5</sf:OperacionExenta>");
    expect(xml).toContain("<sf:CalificacionOperacion>N2</sf:CalificacionOperacion><sf:BaseImponibleOimporteNoSujeto>40.00</sf:BaseImponibleOimporteNoSujeto>");
    expect(xml).toContain("<sf:CalificacionOperacion>S2</sf:CalificacionOperacion><sf:TipoImpositivo>0.00</sf:TipoImpositivo>");
    if (hayXmllint) expect(validarContraXSD(xml)).toBeNull();
  });

  it("exige destinatario en facturas completas", () => {
    expect(() => documentoXML(emisor, [alta(null, { destinatario: null })])).toThrow(/destinatario/);
  });

  it("envuelve el mensaje en un sobre SOAP", () => {
    const soap = sobreSOAP(emisor, [r1]);
    expect(soap).toMatch(/^<\?xml[^>]+>\n<soapenv:Envelope/);
    expect(soap).toContain("<soapenv:Body><sfLR:RegFactuSistemaFacturacion");
  });
});
