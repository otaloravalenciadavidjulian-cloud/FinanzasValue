import postgres from "postgres";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Aplica en orden las migraciones SQL pendientes con el rol propietario de la base.
 * Si hay APP_DB_PASSWORD, crea o actualiza el rol value_app (sin BYPASSRLS) y le da permisos
 * de lectura y escritura: es el rol con el que se conecta la aplicación.
 */
async function main() {
  const url = process.env.DATABASE_OWNER_URL ?? process.env.DATABASE_URL;
  if (!url) {
    if (process.env.NETLIFY) throw new Error("Falta DATABASE_OWNER_URL en las variables de entorno de Netlify");
    throw new Error("Falta DATABASE_OWNER_URL o DATABASE_URL");
  }
  const sql = postgres(url, { max: 1, onnotice: () => {}, prepare: !new URL(url).hostname.includes("-pooler") });
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

  const pass = process.env.APP_DB_PASSWORD;
  if (pass) {
    if (pass.length < 24) throw new Error("APP_DB_PASSWORD debe tener al menos 24 caracteres");
    const [existe] = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'value_app'`;
    const lit = (await sql`SELECT quote_literal(${pass}) AS q`)[0].q as string;
    // Un rol que no es superusuario no puede cambiar atributos como SUPERUSER: al actualizar, solo la contraseña.
    await sql.unsafe(existe ? `ALTER ROLE value_app WITH LOGIN PASSWORD ${lit}`
      : `CREATE ROLE value_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ${lit}`);
    const [r] = await sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'value_app'`;
    if (r.rolsuper || r.rolbypassrls) throw new Error("El rol value_app no puede ser superusuario ni tener BYPASSRLS");
    await sql.unsafe(`
      GRANT USAGE ON SCHEMA public TO value_app;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO value_app;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO value_app;
      REVOKE ALL ON migraciones FROM value_app;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO value_app;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO value_app;`);
    console.log("Rol value_app listo");
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
