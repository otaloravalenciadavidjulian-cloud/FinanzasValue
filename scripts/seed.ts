import postgres from "postgres";

/** Crea una empresa de demostración con series y clientes de ejemplo, y muestra su identificador. */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const ejercicio = new Date().getFullYear();
  const id = await sql.begin(async (tx) => {
    const [e] = await tx`INSERT INTO empresas (razon_social, nombre_comercial, nif, domicilio, codigo_postal, municipio, provincia, actividad)
      VALUES ('Value Consultores Ejemplo, S.L.', 'Value Consultores', 'B00000000', 'Calle Mayor 10', '28013', 'Madrid', 'Madrid', 'Consultoría (CNAE 6202)')
      ON CONFLICT (nif) DO UPDATE SET razon_social = excluded.razon_social RETURNING id`;
    await tx`SELECT set_config('app.empresa_id', ${e.id}, true)`;
    await tx`INSERT INTO series (empresa_id, codigo, descripcion, tipo_factura, ejercicio) VALUES
      (${e.id}, 'A', 'Facturas ordinarias', 'F1', ${ejercicio}), (${e.id}, 'R', 'Rectificativas', 'R1', ${ejercicio}), (${e.id}, 'S', 'Simplificadas', 'F2', ${ejercicio})
      ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO terceros (empresa_id, es_cliente, razon_social, nif, direccion, dias_pago) VALUES
      (${e.id}, true, 'Grupo Alameda Retail, S.L.', 'B00000001', 'Av. de la Constitución 5, Sevilla', 30),
      (${e.id}, true, 'Fundación Horizonte Verde', 'G00000001', 'C/ Alcalá 120, Madrid', 45)
      ON CONFLICT DO NOTHING`;
    return e.id as string;
  });
  console.log(`Empresa de demostración: EMPRESA_DEMO_ID=${id}`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
