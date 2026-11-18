import { describe, expect, it } from "vitest";
import { limpiarUrl } from "../src/db/cliente";

describe("limpiarUrl", () => {
  const base = "postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/neondb";
  it("quita channel_binding y conserva sslmode", () => {
    const u = new URL(limpiarUrl(`${base}?sslmode=require&channel_binding=require`));
    expect(u.searchParams.get("channel_binding")).toBeNull();
    expect(u.searchParams.get("sslmode")).toBe("require");
  });
  it("acepta la cadena copiada con psql y comillas", () => {
    expect(limpiarUrl(`  psql '${base}?sslmode=require'  `)).toBe(`${base}?sslmode=require`);
    expect(limpiarUrl(`DATABASE_URL="${base}"`)).toBe(base);
  });
  it("explica el error si no es una URL de PostgreSQL", () => {
    expect(() => limpiarUrl("hola")).toThrow(/postgresql:\/\//);
    expect(() => limpiarUrl("https://neon.tech")).toThrow(/postgresql:\/\//);
  });
});
