import { describe, expect, it } from "vitest";
import { periodoTrimestral, plazo347, plazoTrimestral, trimestreAPresentar, trimestreDe } from "@/lib/impuestos/periodos";

describe("periodos y plazos", () => {
  it("calcula trimestres y sus plazos", () => {
    expect(periodoTrimestral(2026, 1)).toMatchObject({ desde: "2026-01-01", hasta: "2026-03-31", etiqueta: "1T 2026" });
    expect(periodoTrimestral(2024, 1).hasta).toBe("2024-03-31");
    expect(periodoTrimestral(2026, 2).hasta).toBe("2026-06-30");
    expect(plazoTrimestral(2026, 3)).toEqual({ desde: "2026-10-01", hasta: "2026-10-20" });
    expect(plazoTrimestral(2026, 4)).toEqual({ desde: "2027-01-01", hasta: "2027-01-30" });
    expect(plazo347(2026).hasta).toBe("2027-02-28");
    expect(trimestreDe("2026-11-17")).toEqual({ ejercicio: 2026, trimestre: 4 });
    expect(trimestreAPresentar("2026-11-17")).toEqual({ ejercicio: 2026, trimestre: 3 });
    expect(trimestreAPresentar("2027-01-10")).toEqual({ ejercicio: 2026, trimestre: 4 });
  });
});
