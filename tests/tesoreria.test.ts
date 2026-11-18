import { describe, expect, it } from "vitest";
import { cuentaDeIban, formatearIban, validarIban } from "@/lib/tesoreria/iban";
import { decodificar, leerNorma43 } from "@/lib/tesoreria/norma43";
import { extractoN43 } from "./n43";

const base = {
  desde: "2026-11-01", hasta: "2026-11-15", saldoInicialCent: 150000,
  movimientos: [
    { fecha: "2026-11-03", importeCent: 121000, texto: "TRANSFERENCIA DE CLIENTE SL", concepto: "FACTURA A-2026-0001" },
    { fecha: "2026-11-05", importeCent: -1250, comun: "17", texto: "COMISION MANTENIMIENTO" },
    { fecha: "2026-11-05", importeCent: -1250, comun: "17", texto: "COMISION MANTENIMIENTO" },
  ],
};

describe("IBAN", () => {
  it("valida con mod 97 y extrae entidad, oficina y cuenta", () => {
    expect(validarIban("ES91 2100 0418 4502 0005 1332")).toBe(true);
    expect(validarIban("ES91 2100 0418 4502 0005 1333")).toBe(false);
    expect(validarIban("ES91210004184502")).toBe(false);
    expect(validarIban("DE89370400440532013000")).toBe(true);
    expect(cuentaDeIban("ES9121000418450200051332")).toEqual({ entidad: "2100", oficina: "0418", cuenta: "0200051332" });
    expect(formatearIban("es9121000418450200051332")).toBe("ES91 2100 0418 4502 0005 1332");
  });
});

describe("Norma 43", () => {
  it("lee cuenta, saldos y movimientos con su signo y descripción", () => {
    const [c] = leerNorma43(extractoN43(base));
    expect(c).toMatchObject({ entidad: "2100", oficina: "0418", cuenta: "0200051332", fechaDesde: "2026-11-01", fechaHasta: "2026-11-15",
      saldoInicialCent: 150000, saldoFinalCent: 150000 + 121000 - 2500, titular: "EMPRESA DE PRUEBA SL" });
    expect(c.movimientos).toHaveLength(3);
    expect(c.movimientos[0]).toMatchObject({ importeCent: 121000, fechaOperacion: "2026-11-03", descripcion: "TRANSFERENCIA DE CLIENTE SL FACTURA A-2026-0001" });
    expect(c.movimientos[1]).toMatchObject({ importeCent: -1250, conceptoComun: "17" });
  });
  it("dos movimientos idénticos el mismo día tienen huellas distintas y estables", () => {
    const a = leerNorma43(extractoN43(base))[0].movimientos, b = leerNorma43(extractoN43(base))[0].movimientos;
    expect(a[1].huella).not.toBe(a[2].huella);
    expect(a.map((m) => m.huella)).toEqual(b.map((m) => m.huella));
  });
  it("sin texto complementario usa el concepto común", () => {
    const [c] = leerNorma43(extractoN43({ ...base, movimientos: [{ fecha: "2026-11-02", importeCent: -5000, comun: "15" }] }));
    expect(c.movimientos[0].descripcion).toBe("Nóminas / seguros sociales");
  });
  it("rechaza ficheros que no cuadran o no son Norma 43", () => {
    expect(() => leerNorma43(extractoN43({ ...base, saldoFinalCent: 1 }))).toThrow(/saldo final no cuadra/);
    expect(() => leerNorma43(extractoN43({ ...base, totalHaberCent: 1 }))).toThrow(/no suman los totales/);
    expect(() => leerNorma43("Fecha;Concepto;Importe\n01/11/2026;x;1")).toThrow(/Norma 43/);
    const sinFinal = extractoN43(base).split("\r\n").filter((l) => !l.startsWith("33") && !l.startsWith("88")).join("\n");
    expect(() => leerNorma43(sinFinal)).toThrow(/final de cuenta/);
    expect(() => leerNorma43(extractoN43(base).replace("261115", "261135"))).toThrow(/Fecha no válida/);
  });
  it("acepta saldos deudores y ficheros en Latin-1", () => {
    const [c] = leerNorma43(extractoN43({ ...base, saldoInicialCent: -20000 }));
    expect(c.saldoInicialCent).toBe(-20000);
    const latin1 = new Uint8Array([...new TextEncoder().encode("COMISI")].concat([0xd3, 0x4e]));
    expect(decodificar(latin1)).toBe("COMISIÓN");
  });
});
