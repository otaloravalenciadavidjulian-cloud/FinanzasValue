import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Hash de contraseña con scrypt: "scrypt$N$r$p$sal$hash" en base64url. */
export async function hashContrasena(pw: string): Promise<string> {
  validarContrasena(pw);
  const sal = randomBytes(16);
  const h = await scrypt(pw, sal, 32, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, sal.toString("base64url"), h.toString("base64url")].join("$");
}

export async function verificarContrasena(pw: string, guardado: string): Promise<boolean> {
  const [alg, N, r, p, sal, hash] = guardado.split("$");
  if (alg !== "scrypt") return false;
  const esperado = Buffer.from(hash, "base64url");
  const h = await scrypt(pw, Buffer.from(sal, "base64url"), esperado.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem });
  return timingSafeEqual(h, esperado);
}

export function validarContrasena(pw: string): void {
  if (pw.length < 12) throw new Error("La contraseña debe tener al menos 12 caracteres");
  if (pw.length > 200) throw new Error("La contraseña es demasiado larga");
}
