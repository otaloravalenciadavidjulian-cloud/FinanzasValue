import { describe, expect, it, vi } from "vitest";
import QRCode from "qrcode";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { detectarMime, sha256 } from "@/lib/documentos/almacen";
import {
  combinar, comprobarCuadre, leerJustificante, leerQR, normalizarRespuestaIA, parsearUrlQR, valoresFormulario, type RespuestaIA,
} from "@/lib/documentos/lectura";
import { urlQR } from "@/lib/verifactu/qr";

const URL_QR = urlQR({ nifEmisor: "A58818501", numSerie: "FV-2026/0042", fechaExpedicion: "2026-11-10", importeTotalCent: 12100, entorno: "produccion" });

const respuesta = (extra: Partial<RespuestaIA> = {}): RespuestaIA => ({
  legible: true, tipo_documento: "factura", proveedor_nif: "A-58818501", proveedor_nombre: "Eléctrica S.A.", numero: "FV-2026/0042",
  fecha: "2026-11-10", desglose: [{ base: "100.00", tipo_iva: 21, cuota: "21.00" }], retencion_pct: null, total: "121.00",
  descripcion: "Electricidad de octubre", categoria: "suministros", observaciones: null, ...extra,
});

const clienteFalso = (r: unknown, stop = "end_turn") => ({
  beta: { messages: { parse: vi.fn(async () => ({ stop_reason: stop, parsed_output: r })) } },
}) as never;

async function imagenQR(texto: string) {
  const png = await QRCode.toBuffer(texto, { type: "png", errorCorrectionLevel: "M", margin: 4, scale: 6 });
  return new Uint8Array(png);
}

describe("tipo de archivo y huella", () => {
  it("reconoce el tipo por sus primeros bytes, no por el nombre", () => {
    expect(detectarMime(new TextEncoder().encode("%PDF-1.7 ..."))).toBe("application/pdf");
    expect(detectarMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectarMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectarMime(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(detectarMime(new TextEncoder().encode("<html><script>"))).toBeNull();
  });
  it("calcula la huella SHA-256", () => {
    expect(sha256(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("QR tributario", () => {
  it("interpreta la URL de cotejo de la AEAT", () => {
    expect(parsearUrlQR(URL_QR)).toEqual({ nif: "A58818501", numero: "FV-2026/0042", fecha: "2026-11-10", totalCent: 12100 });
  });
  it("ignora QR que no son de la AEAT o están incompletos", () => {
    expect(parsearUrlQR("https://ejemplo.com/ValidarQR?nif=A58818501&numserie=1&fecha=10-11-2026&importe=1")).toBeNull();
    expect(parsearUrlQR(URL_QR.replace(/&importe=[^&]+/, ""))).toBeNull();
    expect(parsearUrlQR("texto cualquiera")).toBeNull();
  });
  it("lee el QR de una imagen PNG y de una foto JPG", async () => {
    const png = await imagenQR(URL_QR);
    expect(leerQR(png, "image/png")).toMatchObject({ numero: "FV-2026/0042", totalCent: 12100 });
    const img = PNG.sync.read(Buffer.from(png));
    const jpg = jpeg.encode({ data: img.data, width: img.width, height: img.height }, 85).data;
    expect(leerQR(new Uint8Array(jpg), "image/jpeg")).toMatchObject({ nif: "A58818501" });
  });
  it("una imagen dañada no rompe la lectura", () => {
    expect(leerQR(new Uint8Array([0xff, 0xd8, 0xff, 0, 1, 2]), "image/jpeg")).toBeNull();
  });
});

describe("lectura con IA", () => {
  it("normaliza y valida lo que devuelve el modelo", () => {
    const l = normalizarRespuestaIA(respuesta());
    expect(l).toMatchObject({ proveedorNif: "A58818501", numero: "FV-2026/0042", fecha: "2026-11-10", totalCent: 12100, categoria: "suministros" });
    expect(l.desglose).toEqual([{ baseCent: 10000, tipoIva: 21, cuotaCent: 2100 }]);
    expect(l.avisos).toEqual([]);
  });
  it("no acepta NIF, fechas ni tipos de IVA inválidos", () => {
    const l = normalizarRespuestaIA(respuesta({ proveedor_nif: "B12345675", fecha: "10/11/2026", desglose: [{ base: "10", tipo_iva: 17, cuota: "1.7" }] }));
    expect(l.proveedorNif).toBeNull();
    expect(l.fecha).toBeNull();
    expect(l.desglose).toEqual([]);
    expect(l.avisos).toHaveLength(3);
  });
  it("un documento ilegible no propone datos", () => {
    const l = normalizarRespuestaIA(respuesta({ legible: false }));
    expect(l.numero).toBeNull();
    expect(l.avisos[0]).toMatch(/no parece un justificante/i);
  });
});

describe("combinación y cuadre", () => {
  it("el QR manda sobre lo leído y se avisa si no coincide", () => {
    const ia = normalizarRespuestaIA(respuesta({ numero: "FV-2026/0043", total: "120.00" }));
    const l = combinar(parsearUrlQR(URL_QR), ia);
    expect(l).toMatchObject({ numero: "FV-2026/0042", totalCent: 12100, origen: ["qr", "ia"] });
    expect(l.avisos.filter((a) => /QR no coincide/.test(a))).toHaveLength(2);
  });
  it("avisa si bases y cuotas no suman el total", () => {
    const l = comprobarCuadre(normalizarRespuestaIA(respuesta({ total: "130.00" })));
    expect(l.avisos.some((a) => /no suman el total/.test(a))).toBe(true);
    expect(comprobarCuadre(normalizarRespuestaIA(respuesta())).avisos).toEqual([]);
  });
  it("prepara los valores del formulario y elige el proveedor por NIF", () => {
    const v = valoresFormulario(normalizarRespuestaIA(respuesta()), [{ id: "p1", nif: "A58818501" }]);
    expect(v).toMatchObject({ proveedor: "p1", numero: "FV-2026/0042", fecha: "2026-11-10", base0: "100,00", iva0: "21", cuota0: "21,00", categoria: "suministros" });
  });
});

describe("lectura completa", () => {
  it("combina QR e IA en una sola llamada al modelo", async () => {
    const cliente = clienteFalso(respuesta());
    const l = await leerJustificante(await imagenQR(URL_QR), "image/png", cliente);
    expect(l.origen).toEqual(["qr", "ia"]);
    expect(l.avisos).toEqual([]);
    const llamada = (cliente as { beta: { messages: { parse: ReturnType<typeof vi.fn> } } }).beta.messages.parse.mock.calls[0][0];
    expect(llamada).toMatchObject({ fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
  });
  it("si el modelo declina, deja los datos vacíos y lo dice", async () => {
    const l = await leerJustificante(new TextEncoder().encode("%PDF-1.7"), "application/pdf", clienteFalso(null, "refusal"));
    expect(l.numero).toBeNull();
    expect(l.avisos[0]).toMatch(/a mano/);
  });
  it("sin clave de API solo usa el QR", async () => {
    const antes = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const l = await leerJustificante(await imagenQR(URL_QR), "image/png");
      expect(l).toMatchObject({ origen: ["qr"], numero: "FV-2026/0042", totalCent: 12100 });
      expect(l.avisos[0]).toMatch(/121,00 €/);
      const sinNada = await leerJustificante(new TextEncoder().encode("%PDF-1.7"), "application/pdf");
      expect(sinNada.avisos[0]).toMatch(/no está activada/);
    } finally {
      if (antes !== undefined) process.env.ANTHROPIC_API_KEY = antes;
    }
  });
});
