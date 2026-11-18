import { describe, expect, it } from "vitest";
import { hashContrasena, verificarContrasena } from "@/lib/auth/contrasena";
import { urlAplicacion } from "@/db/cliente";

describe("contraseñas", () => {
  it("verifica la correcta y rechaza las demás", async () => {
    const h = await hashContrasena("una-contraseña-larga");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verificarContrasena("una-contraseña-larga", h)).toBe(true);
    expect(await verificarContrasena("otra-contraseña-larga", h)).toBe(false);
  });
  it("exige al menos 12 caracteres", async () => {
    await expect(hashContrasena("corta")).rejects.toThrow(/12 caracteres/);
  });
});

describe("conexión de la aplicación", () => {
  it("usa el rol value_app sobre la URL del propietario", () => {
    const antes = { ...process.env };
    delete process.env.DATABASE_URL;
    process.env.DATABASE_OWNER_URL = "postgresql://neondb_owner:secreto@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require";
    process.env.APP_DB_PASSWORD = "p@ss/word";
    const u = new URL(urlAplicacion());
    expect(u.username).toBe("value_app");
    expect(decodeURIComponent(u.password)).toBe("p@ss/word");
    expect(u.searchParams.get("sslmode")).toBe("require");
    process.env = antes;
  });
});
