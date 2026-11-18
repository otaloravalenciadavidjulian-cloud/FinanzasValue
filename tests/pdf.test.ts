import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { generarFacturaPDF, type DatosFacturaPDF } from "@/lib/facturacion/pdf";

const base: DatosFacturaPDF = {
  emisor: { razonSocial: "Empresa Ñandú S.L.", nif: "B12345674", domicilio: "C/ Mayor 1", codigoPostal: "28013", municipio: "Madrid", provincia: "Madrid", datosRegistrales: "Inscrita en el Registro Mercantil de Madrid", iban: "ES9121000418450200051332" },
  destinatario: { razonSocial: "Cliente S.L.", nif: "B87654321", direccion: "Av. Diagonal 10", codigoPostal: "08019", municipio: "Barcelona", provincia: "Barcelona" },
  numSerie: "A-2026-00001", tipoFactura: "F1", fechaExpedicion: "2026-11-17",
  lineas: [{ concepto: "Consultoría estratégica − fase 1", cantidad: 2, precioUnitarioCent: 50000, descuentoPct: 0, tipoIva: 21, baseCent: 100000 }],
  desglose: [{ tipoIva: 21, baseCent: 100000, cuotaCent: 21000 }],
  baseCent: 100000, cuotaIvaCent: 21000, retencionPct: 15, retencionCent: 15000, totalCent: 106000,
  anulada: false, urlQR: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345674&numserie=A-2026-00001&fecha=17-11-2026&importe=1210.00",
  entornoPruebas: true,
};

describe("factura en PDF", () => {
  it("genera un PDF válido con título y metadatos", async () => {
    const bytes = await generarFacturaPDF(base);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("Factura A-2026-00001");
  });

  it("es reproducible: los mismos datos dan el mismo PDF", async () => {
    const a = Buffer.from(await generarFacturaPDF(base));
    const b = Buffer.from(await generarFacturaPDF(base));
    expect(a.equals(b)).toBe(true);
  });

  it("pasa a varias páginas cuando hay muchas líneas", async () => {
    const lineas = Array.from({ length: 80 }, (_, i) => ({ ...base.lineas[0], concepto: `Línea ${i + 1} con una descripción larga que ocupa más de una fila en la tabla de conceptos de la factura` }));
    const doc = await PDFDocument.load(await generarFacturaPDF({ ...base, lineas }));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it("admite rectificativas, simplificadas sin destinatario y anuladas", async () => {
    const bytes = await generarFacturaPDF({ ...base, tipoFactura: "R1", anulada: true, destinatario: null, rectifica: { numSerie: "A-2026-00001", fechaExpedicion: "2026-11-17", tipo: "I", motivo: "Error en el precio" } });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
