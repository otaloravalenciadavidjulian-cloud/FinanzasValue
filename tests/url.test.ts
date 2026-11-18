import { describe, expect, it } from "vitest";
import { limpiarUrl } from "../src/db/cliente";

describe("limpiarUrl", () => {
  const base = "postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/neondb";
  it("quita channel_binding y conserva sslmode", () => {
    const u = new URL(limpiarUrl(`${base}?sslmode=require&channel_binding=require`));
    expect(u.searchParams.get("channel_binding")).toBeNull();
    expect(u.searchParams.get("sslmode")).toBe("require");
  });
  it("encuentra la URL aunque venga con psql, comillas, una clave o texto alrededor", () => {
    expect(limpiarUrl(`  psql '${base}?sslmode=require'  `)).toBe(`${base}?sslmode=require`);
    expect(limpiarUrl(`DATABASE_URL="${base}"`)).toBe(base);
    expect(limpiarUrl(`DATABASE_URL='${base}'\n`)).toBe(base);
    expect(limpiarUrl(`export DATABASE_OWNER_URL=${base}`)).toBe(base);
    expect(limpiarUrl(base.replace("postgresql", "postgres"))).toBe(base.replace("postgresql", "postgres"));
  });
  it("acepta el formato de parámetros de Neon", () => {
    const u = new URL(limpiarUrl("PGHOST='ep-x-pooler.eu-central-1.aws.neon.tech'\nPGDATABASE='neondb'\nPGUSER='neondb_owner'\nPGPASSWORD='s3cr3t'\nPGSSLMODE='require'\nPGCHANNELBINDING='require'"));
    expect(u.hostname).toBe("ep-x-pooler.eu-central-1.aws.neon.tech");
    expect(u.pathname).toBe("/neondb");
    expect(u.username).toBe("neondb_owner");
    expect(u.password).toBe("s3cr3t");
    expect(u.searchParams.get("sslmode")).toBe("require");
  });
  it("explica el error sin mostrar el valor", () => {
    expect(() => limpiarUrl("hola-secreto")).toThrow(/postgresql:\/\//);
    expect(() => limpiarUrl("hola-secreto")).not.toThrow(/hola-secreto/);
    expect(() => limpiarUrl("https://console.neon.tech/app")).toThrow(/dirección web/);
  });
});
