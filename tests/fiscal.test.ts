import { describe, expect, it } from "vitest";
import { aCentimos, aDecimalAEAT, redondear } from "@/lib/fiscal/dinero";
import { calcularTotales } from "@/lib/fiscal/totales";
import { validarNif } from "@/lib/fiscal/nif";

describe("dinero", () => {
  it("redondea medio céntimo alejándose de cero", () => {
    expect(redondear(0.5)).toBe(1);
    expect(redondear(-0.5)).toBe(-1);
    expect(redondear(2.4999)).toBe(2);
  });
  it("formatea importes como la AEAT", () => {
    expect(aDecimalAEAT(12345)).toBe("123.45");
    expect(aDecimalAEAT(5)).toBe("0.05");
    expect(aDecimalAEAT(-1200)).toBe("-12.00");
    expect(() => aDecimalAEAT(1.5)).toThrow();
  });
  it("lee importes en formato español", () => {
    expect(aCentimos("1.234,56")).toBe(123456);
    expect(aCentimos("99.9")).toBe(9990);
    expect(aCentimos("-3,05")).toBe(-305);
    expect(() => aCentimos("abc")).toThrow();
  });
});

describe("totales de factura", () => {
  it("agrupa por tipo de IVA y calcula la cuota sobre la base agregada", () => {
    const t = calcularTotales([
      { concepto: "Consultoría", cantidad: 3, precioUnitarioCent: 3333, tipoIva: 21 },
      { concepto: "Consultoría", cantidad: 1, precioUnitarioCent: 1, tipoIva: 21 },
      { concepto: "Libro", cantidad: 2, precioUnitarioCent: 1500, descuentoPct: 10, tipoIva: 4 },
    ]);
    expect(t.desglose).toEqual([
      { tipoIva: 21, baseCent: 10000, cuotaCent: 2100 },
      { tipoIva: 4, baseCent: 2700, cuotaCent: 108 },
    ]);
    expect(t.totalCent).toBe(10000 + 2100 + 2700 + 108);
  });
  it("aplica la retención de IRPF sobre la base", () => {
    const t = calcularTotales([{ concepto: "Servicio profesional", cantidad: 1, precioUnitarioCent: 100000, tipoIva: 21 }], 15);
    expect(t.retencionCent).toBe(15000);
    expect(t.totalCent).toBe(100000 + 21000 - 15000);
  });
  it("admite cantidades negativas para rectificativas por diferencias", () => {
    const t = calcularTotales([{ concepto: "Ajuste de precio", cantidad: -1, precioUnitarioCent: 5000, tipoIva: 21 }]);
    expect(t.totalCent).toBe(-6050);
  });
  it("rechaza tipos de IVA inexistentes y facturas vacías", () => {
    expect(() => calcularTotales([{ concepto: "x", cantidad: 1, precioUnitarioCent: 1, tipoIva: 18 }])).toThrow();
    expect(() => calcularTotales([])).toThrow();
  });
});

describe("NIF", () => {
  it.each([
    ["12345678Z", true], ["12345678A", false],
    ["X1234567L", true], ["Y1234567X", true],
    ["B12345674", true], ["B12345675", false],
    ["Q2827003A", true], ["A58818501", true],
    ["", false], ["ABC", false],
  ])("%s → %s", (nif, ok) => expect(validarNif(nif)).toBe(ok));
});
