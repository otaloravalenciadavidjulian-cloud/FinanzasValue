import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Códigos de un solo uso basados en tiempo (RFC 6238): HMAC-SHA1, 30 segundos, 6 dígitos. */

const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const PASO_S = 30;

export function base32(buf: Buffer): string {
  let bits = 0, valor = 0, salida = "";
  for (const b of buf) {
    valor = (valor << 8) | b; bits += 8;
    while (bits >= 5) { salida += ALFABETO[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) salida += ALFABETO[(valor << (5 - bits)) & 31];
  return salida;
}

export function desdeBase32(texto: string): Buffer {
  const limpio = texto.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0, valor = 0;
  const salida: number[] = [];
  for (const c of limpio) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) throw new Error("Secreto base32 no válido");
    valor = (valor << 5) | i; bits += 5;
    if (bits >= 8) { salida.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(salida);
}

export const nuevoSecreto = () => base32(randomBytes(20));

export function codigo(secreto: string, paso: number): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(paso));
  const h = createHmac("sha1", desdeBase32(secreto)).update(contador).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

export const pasoActual = (ahora = Date.now()) => Math.floor(ahora / 1000 / PASO_S);

/**
 * Comprueba un código admitiendo un paso de desfase en cada sentido. Devuelve el paso aceptado,
 * que debe ser mayor que el último usado para que un mismo código no sirva dos veces.
 */
export function verificarCodigo(secreto: string, entrada: string, ultimoPaso: number | null, ahora = Date.now()): number | null {
  const c = entrada.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const actual = pasoActual(ahora);
  for (const paso of [actual - 1, actual, actual + 1]) {
    if (ultimoPaso !== null && paso <= ultimoPaso) continue;
    if (timingSafeEqual(Buffer.from(codigo(secreto, paso)), Buffer.from(c))) return paso;
  }
  return null;
}

export function uriOtpauth(secreto: string, email: string, emisor = "Value Finanzas") {
  const etiqueta = encodeURIComponent(`${emisor}:${email}`);
  return `otpauth://totp/${etiqueta}?secret=${secreto}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=6&period=${PASO_S}`;
}

const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const normalizar = (t: string) => t.replace(/[\s-]/g, "").toLowerCase();

/** Diez códigos de recuperación de 10 caracteres (xxxxx-xxxxx). Se muestran una vez; se guarda su hash. */
export function codigosRecuperacion(): { codigos: string[]; hashes: string[] } {
  const codigos = Array.from({ length: 10 }, () => {
    const t = base32(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${t.slice(0, 5)}-${t.slice(5)}`;
  });
  return { codigos, hashes: codigos.map((c) => sha(normalizar(c))) };
}
export const hashRecuperacion = (c: string) => sha(normalizar(c));
