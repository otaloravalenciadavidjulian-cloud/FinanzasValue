import postgres from "postgres";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

let cliente: Sql | undefined;

/** Rol de base de datos con el que trabaja la aplicación (sin superusuario ni BYPASSRLS). */
export const ROL_APP = "value_app";

/**
 * Limpia la cadena de conexión tal como se copia de Neon: quita un `psql` delante, comillas y
 * espacios, y elimina `channel_binding`, que postgres.js no reconoce y enviaría al servidor como
 * parámetro desconocido (el servidor rechaza la conexión).
 */
export function limpiarUrl(bruta: string, nombre = "DATABASE_OWNER_URL"): string {
  const t = bruta.trim();
  // Busca la URL en cualquier parte del valor: admite `psql '...'`, `DATABASE_URL="..."`, comillas o texto alrededor.
  const m = t.match(/postgres(?:ql)?:\/\/[^\s'"`]+/i);
  let u: URL | undefined;
  if (m) {
    try {
      u = new URL(m[0]);
    } catch {
      u = undefined;
    }
  } else {
    // Formato «Parameters only» de Neon: PGHOST=..., PGDATABASE=..., PGUSER=..., PGPASSWORD=...
    const p = (k: string) => t.match(new RegExp(`${k}\\s*=\\s*['"]?([^'"\\s]+)`))?.[1];
    const host = p("PGHOST"), user = p("PGUSER"), pass = p("PGPASSWORD"), base = p("PGDATABASE");
    if (host && user && pass && base) {
      u = new URL(`postgresql://${host}/${encodeURIComponent(base)}`);
      u.username = encodeURIComponent(user);
      u.password = encodeURIComponent(pass);
      u.searchParams.set("sslmode", p("PGSSLMODE") ?? "require");
    }
  }
  if (!u || !u.hostname) {
    const pista = /^https?:/i.test(t) ? " (has pegado una dirección web, no la cadena de conexión)"
      : t.length === 0 ? " (está vacía)" : "";
    throw new Error(`${nombre} no contiene una cadena de conexión de PostgreSQL${pista}. ` +
      "En Neon pulsa Connect y copia la que empieza por postgresql://");
  }
  u.searchParams.delete("channel_binding");
  return u.toString();
}

/**
 * URL de conexión de la aplicación. Si no hay DATABASE_URL, se construye a partir de la URL del
 * propietario (DATABASE_OWNER_URL) cambiando el usuario por value_app y su contraseña (APP_DB_PASSWORD).
 */
export function urlAplicacion(): string {
  if (process.env.DATABASE_URL) return limpiarUrl(process.env.DATABASE_URL, "DATABASE_URL");
  const owner = process.env.DATABASE_OWNER_URL;
  const pass = process.env.APP_DB_PASSWORD;
  if (!owner || !pass) throw new Error("Configura DATABASE_URL, o bien DATABASE_OWNER_URL y APP_DB_PASSWORD");
  const u = new URL(limpiarUrl(owner));
  u.username = ROL_APP;
  u.password = pass;
  return u.toString();
}

export function opciones(url: string): postgres.Options<Record<string, never>> {
  // Los poolers en modo transacción (como el de Neon) no admiten sentencias preparadas con nombre.
  const pooler = new URL(url).hostname.includes("-pooler");
  return { max: 5, onnotice: () => {}, prepare: !pooler };
}

export function db(): Sql {
  if (!cliente) {
    const url = urlAplicacion();
    cliente = postgres(url, opciones(url));
  }
  return cliente;
}

/**
 * Ejecuta una transacción con el contexto de empresa activado, de modo que las políticas
 * de Row Level Security solo dejan ver y escribir filas de esa empresa.
 */
export async function enEmpresa<T>(sql: Sql, empresaId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  await comprobarRolSeguro(sql);
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${empresaId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

const verificados = new WeakSet<Sql>();

/**
 * Los superusuarios y los roles con BYPASSRLS se saltan Row Level Security, incluso con FORCE.
 * La aplicación se niega a trabajar con ellos para no mezclar datos de empresas.
 */
export async function comprobarRolSeguro(sql: Sql): Promise<void> {
  if (verificados.has(sql)) return;
  const [r] = await sql<{ rolsuper: boolean; rolbypassrls: boolean; rolname: string }[]>`
    SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  if (r.rolsuper || r.rolbypassrls) {
    throw new Error(`El rol ${r.rolname} es superusuario o tiene BYPASSRLS: conecta la aplicación con un rol sin esos privilegios`);
  }
  verificados.add(sql);
}
