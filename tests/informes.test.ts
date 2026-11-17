import { describe, expect, it } from "vitest";
import { aCsv, celda, fechaValida } from "@/lib/informes/csv";

describe("CSV para Excel", () => {
  it("escapa separadores y comillas y neutraliza fórmulas", () => {
    expect(celda('Obra "A"; fase 1')).toBe('"Obra ""A""; fase 1"');
    expect(celda("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(celda("+34 600")).toBe("'+34 600");
    expect(celda("-12,50")).toBe("-12,50");
    expect(celda(null)).toBe("");
  });
  it("añade BOM y CRLF", () => {
    expect(aCsv(["A", "B"], [[1, "x"]])).toBe("﻿A;B\r\n1;x\r\n");
  });
  it("valida fechas", () => {
    expect(fechaValida("2026-02-30")).toBeNull();
    expect(fechaValida("2026-02-28")).toBe("2026-02-28");
    expect(fechaValida("x")).toBeNull();
    expect(fechaValida("2026-13-45")).toBeNull();
  });
});
