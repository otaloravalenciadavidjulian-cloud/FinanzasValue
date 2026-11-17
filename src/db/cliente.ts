import postgres from "postgres";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

let cliente: Sql | undefined;

export function db(): Sql {
  if (!cliente) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Falta DATABASE_URL");
    cliente = postgres(url, { max: 10, onnotice: () => {} });
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
