import { describe, expect, it } from "vitest";
import { estadoCobro, hoyMadrid, validarImporteCobro } from "@/lib/cobros/estado";
import { calcularGasto, ErrorGasto } from "@/lib/gastos/registrar";

describe("estado de cobro", () => {
  const hoy = "2026-11-17";
  it("distingue pendiente, parcial, vencida, cobrada y anulada", () => {
    expect(estadoCobro({ totalCent: 1000, cobradoCent: 0, hoy })).toBe("pendiente");
    expect(estadoCobro({ totalCent: 1000, cobradoCent: 400, vencimiento: "2026-12-01", hoy })).toBe("parcial");
    expect(estadoCobro({ totalCent: 1000, cobradoCent: 400, vencimiento: "2026-11-16", hoy })).toBe("vencida");
    expect(estadoCobro({ totalCent: 1000, cobradoCent: 1000, vencimiento: "2026-11-01", hoy })).toBe("cobrada");
    expect(estadoCobro({ totalCent: 1000, cobradoCent: 0, hoy, anulada: true })).toBe("anulada");
  });
  it("trata las rectificativas negativas con su signo", () => {
    expect(estadoCobro({ totalCent: -500, cobradoCent: 0, hoy })).toBe("pendiente");
    expect(estadoCobro({ totalCent: -500, cobradoCent: -500, hoy })).toBe("cobrada");
  });
  it("no deja cobrar más de lo pendiente ni dejar lo cobrado en negativo", () => {
    expect(validarImporteCobro(1000, 400, 600)).toBeNull();
    expect(validarImporteCobro(1000, 400, 601)).toMatch(/supera lo pendiente \(6,00 €\)/);
    expect(validarImporteCobro(1000, 400, -400)).toBeNull();
    expect(validarImporteCobro(1000, 400, -401)).not.toBeNull();
    expect(validarImporteCobro(-500, 0, -500)).toBeNull();
    expect(validarImporteCobro(-500, 0, 100)).not.toBeNull();
    expect(validarImporteCobro(1000, 0, 0)).toMatch(/cero/);
  });
  it("calcula la fecha en Madrid", () => {
    expect(hoyMadrid(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });
});

describe("cálculo de gastos", () => {
  it("calcula cuotas, IVA deducible parcial, retención y total", () => {
    const t = calcularGasto([
      { baseCent: 10000, tipoIva: 21, deduciblePct: 100 },
      { baseCent: 5000, tipoIva: 21, deduciblePct: 50 },
      { baseCent: 2000, tipoIva: 10, deduciblePct: 100 },
    ], 15);
    expect(t.cuotaIvaCent).toBe(2100 + 1050 + 200);
    expect(t.cuotaDeducibleCent).toBe(2100 + 525 + 200);
    expect(t.retencionCent).toBe(2550);
    expect(t.totalCent).toBe(17000 + 3350 - 2550);
  });
  it("acepta la cuota de la factura con diferencias de redondeo, pero no errores", () => {
    expect(calcularGasto([{ baseCent: 3333, tipoIva: 21, cuotaCent: 701, deduciblePct: 100 }], 0).cuotaIvaCent).toBe(701);
    expect(() => calcularGasto([{ baseCent: 3333, tipoIva: 21, cuotaCent: 800, deduciblePct: 100 }], 0)).toThrow(ErrorGasto);
  });
});
