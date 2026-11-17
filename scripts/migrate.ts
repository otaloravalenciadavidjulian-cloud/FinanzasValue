import postgres from "postgres";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Aplica en orden las migraciones SQL de db/migrations que no se hayan aplicado todavía. */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql`CREATE TABLE IF NOT EXISTS migraciones (nombre text PRIMARY KEY, aplicada_en timestamptz NOT NULL DEFAULT now())`;
  const dir = path.join(process.cwd(), "db", "migrations");
  const hechas = new Set((await sql<{ nombre: string }[]>`SELECT nombre FROM migraciones`).map((r) => r.nombre));
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    if (hechas.has(f)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(path.join(dir, f), "utf8"));
      await tx`INSERT INTO migraciones (nombre) VALUES (${f})`;
    });
    console.log(`Aplicada ${f}`);
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
