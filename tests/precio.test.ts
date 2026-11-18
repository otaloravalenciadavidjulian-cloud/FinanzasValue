import { describe, expect, it } from "vitest";
import { baseDesdeConIva, conIva } from "@/lib/fiscal/precio";

describe("precio con IVA incluido", () => {
  it("calcula la base y la suma cuadra al céntimo", () => {
    expect(baseDesdeConIva(12100, 21)).toBe(10000);
    expect(baseDesdeConIva(100000, 21)).toBe(82645);
    expect(conIva(82645, 21)).toBe(100000);
    expect(baseDesdeConIva(5000, 10)).toBe(4545);
    expect(baseDesdeConIva(999, 0)).toBe(999);
  });
  it("cuadra en todos los importes de 0,01 € a 50 € cuando es posible", () => {
    for (const t of [21, 10, 4]) for (let c = 1; c <= 5000; c++) {
      const b = baseDesdeConIva(c, t);
      expect(Math.abs(conIva(b, t) - c)).toBeLessThanOrEqual(1);
    }
  });
});
