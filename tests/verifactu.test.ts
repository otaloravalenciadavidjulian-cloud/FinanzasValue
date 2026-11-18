import { describe, expect, it } from "vitest";
import { cadenaAlta, cadenaAnulacion, fechaHoraHusoMadrid, huella, verificarCadena } from "@/lib/verifactu/huella";
import { urlQR } from "@/lib/verifactu/qr";

describe("huella VERI*FACTU", () => {
  it("reproduce el ejemplo de la AEAT para el primer registro de alta", () => {
    // Ejemplo del documento técnico de la AEAT sobre la generación de la huella.
    const cadena = cadenaAlta({
      nifEmisor: "89890001K", numSerie: "12345678/G33", fechaExpedicion: "2024-01-01", tipoFactura: "F1",
      cuotaTotalCent: 1235, importeTotalCent: 12345, huellaAnterior: "", fechaHoraHuso: "2024-01-01T19:20:30+01:00",
    });
    expect(cadena).toBe("IDEmisorFactura=89890001K&NumSerieFactura=12345678/G33&FechaExpedicionFactura=01-01-2024&TipoFactura=F1&CuotaTotal=12.35&ImporteTotal=123.45&Huella=&FechaHoraHusoGenRegistro=2024-01-01T19:20:30+01:00");
    expect(huella(cadena)).toBe("3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60");
  });

  it("encadena altas y anulaciones y detecta alteraciones", () => {
    const c1 = cadenaAlta({ nifEmisor: "B12345674", numSerie: "A-2026-00001", fechaExpedicion: "2026-11-17", tipoFactura: "F1", cuotaTotalCent: 2100, importeTotalCent: 12100, huellaAnterior: "", fechaHoraHuso: "2026-11-17T10:00:00+01:00" });
    const h1 = huella(c1);
    const c2 = cadenaAnulacion({ nifEmisor: "B12345674", numSerie: "A-2026-00001", fechaExpedicion: "2026-11-17", huellaAnterior: h1, fechaHoraHuso: "2026-11-17T10:05:00+01:00" });
    const regs = [
      { cadena: c1, huella: h1, huellaAnterior: null },
      { cadena: c2, huella: huella(c2), huellaAnterior: h1 },
    ];
    expect(verificarCadena(regs)).toEqual({ ok: true });
    const alterado = [{ ...regs[0], cadena: c1.replace("ImporteTotal=121.00", "ImporteTotal=12.10") }, regs[1]];
    expect(verificarCadena(alterado)).toMatchObject({ ok: false, indice: 0 });
  });

  it("formatea la hora de Madrid con su huso, en invierno y en verano", () => {
    expect(fechaHoraHusoMadrid(new Date("2026-01-15T12:00:00Z"))).toBe("2026-01-15T13:00:00+01:00");
    expect(fechaHoraHusoMadrid(new Date("2026-07-15T12:00:00Z"))).toBe("2026-07-15T14:00:00+02:00");
  });
});

describe("QR tributario", () => {
  it("construye la URL de cotejo con los cuatro parámetros", () => {
    const u = new URL(urlQR({ nifEmisor: "89890001K", numSerie: "12345678&G33", fechaExpedicion: "2024-01-01", importeTotalCent: 24199, entorno: "pruebas" }));
    expect(u.origin + u.pathname).toBe("https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR");
    expect(Object.fromEntries(u.searchParams)).toEqual({ nif: "89890001K", numserie: "12345678&G33", fecha: "01-01-2024", importe: "241.99" });
  });
});
