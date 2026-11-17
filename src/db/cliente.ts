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
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${empresaId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
