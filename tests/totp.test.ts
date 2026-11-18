import { describe, expect, it } from "vitest";
import { base32, codigo, codigosRecuperacion, desdeBase32, hashRecuperacion, uriOtpauth, verificarCodigo } from "@/lib/auth/totp";

// Vectores del RFC 6238 (SHA-1, secreto "12345678901234567890"), últimos 6 dígitos.
const SECRETO = base32(Buffer.from("12345678901234567890"));

describe("TOTP", () => {
  it("cumple los vectores del RFC 6238", () => {
    expect(SECRETO).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(desdeBase32(SECRETO).toString()).toBe("12345678901234567890");
    expect(codigo(SECRETO, Math.floor(59 / 30))).toBe("287082");
    expect(codigo(SECRETO, Math.floor(1111111109 / 30))).toBe("081804");
    expect(codigo(SECRETO, Math.floor(1234567890 / 30))).toBe("005924");
    expect(codigo(SECRETO, Math.floor(2000000000 / 30))).toBe("279037");
  });
  it("admite un paso de desfase y no reutiliza códigos", () => {
    const ahora = 1234567890_000, paso = Math.floor(1234567890 / 30);
    expect(verificarCodigo(SECRETO, "005924", null, ahora)).toBe(paso);
    expect(verificarCodigo(SECRETO, codigo(SECRETO, paso - 1), null, ahora)).toBe(paso - 1);
    expect(verificarCodigo(SECRETO, codigo(SECRETO, paso - 2), null, ahora)).toBeNull();
    expect(verificarCodigo(SECRETO, "005924", paso, ahora)).toBeNull();
    expect(verificarCodigo(SECRETO, "12345", null, ahora)).toBeNull();
  });
  it("genera la URI y códigos de recuperación", () => {
    expect(uriOtpauth(SECRETO, "ana@x.es")).toBe(`otpauth://totp/Value%20Finanzas%3Aana%40x.es?secret=${SECRETO}&issuer=Value%20Finanzas&algorithm=SHA1&digits=6&period=30`);
    const r = codigosRecuperacion();
    expect(new Set(r.codigos).size).toBe(10);
    expect(r.codigos[0]).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    expect(hashRecuperacion(r.codigos[3].toUpperCase().replace("-", " "))).toBe(r.hashes[3]);
  });
});
