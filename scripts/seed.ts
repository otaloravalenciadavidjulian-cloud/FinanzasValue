import postgres from "postgres";
import { altaEmpresa } from "../src/lib/empresas/alta";

/** Solo para desarrollo local: crea una empresa de demostración con un administrador y dos clientes. */
async function main() {
  const url = process.env.DATABASE_OWNER_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL");
  if (process.env.NETLIFY) throw new Error("El seed de demostración no se ejecuta en Netlify");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const email = "demo@value.local", contrasena = "demo-value-2026";
  const { empresaId } = await altaEmpresa(sql, {
    razonSocial: "Value Consultores Ejemplo, S.L.", nif: "B00000000", domicilio: "Calle Mayor 10", codigoPostal: "28013",
    municipio: "Madrid", provincia: "Madrid", adminNombre: "Usuario de demostración", adminEmail: email, adminContrasena: contrasena,
  }, new Date().getFullYear());
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.empresa_id', ${empresaId}, true)`;
    await tx`INSERT INTO terceros (empresa_id, es_cliente, razon_social, nif, direccion, dias_pago) VALUES
      (${empresaId}, true, 'Grupo Alameda Retail, S.L.', 'B00000001', 'Av. de la Constitución 5, Sevilla', 30),
      (${empresaId}, true, 'Fundación Horizonte Verde', 'G00000001', 'C/ Alcalá 120, Madrid', 45)`;
  });
  console.log(`Empresa de demostración creada. Entra con ${email} / ${contrasena}`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
