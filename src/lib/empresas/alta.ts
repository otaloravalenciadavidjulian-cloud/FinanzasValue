import type { Sql } from "@/db/cliente";
import { hashContrasena } from "@/lib/auth/contrasena";
import { normalizarNif, validarNif } from "@/lib/fiscal/nif";

export interface AltaEmpresa {
  razonSocial: string; nif: string; domicilio: string; codigoPostal: string; municipio: string; provincia: string;
  adminNombre: string; adminEmail: string; adminContrasena: string;
}

/** Crea la empresa, su usuario administrador y las series del ejercicio en una transacción. */
export async function altaEmpresa(sql: Sql, d: AltaEmpresa, ejercicio: number) {
  const nif = normalizarNif(d.nif);
  if (!validarNif(nif)) throw new Error("El NIF de la empresa no es válido");
  if (!/^\d{5}$/.test(d.codigoPostal)) throw new Error("El código postal debe tener 5 dígitos");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.adminEmail)) throw new Error("El email no es válido");
  const hash = await hashContrasena(d.adminContrasena);
  return sql.begin(async (tx) => {
    const [e] = await tx`INSERT INTO empresas (razon_social, nif, domicilio, codigo_postal, municipio, provincia)
      VALUES (${d.razonSocial.trim()}, ${nif}, ${d.domicilio.trim()}, ${d.codigoPostal}, ${d.municipio.trim()}, ${d.provincia.trim()}) RETURNING id`;
    const [u] = await tx`INSERT INTO usuarios (email, nombre, hash_contrasena) VALUES (${d.adminEmail.trim().toLowerCase()}, ${d.adminNombre.trim()}, ${hash}) RETURNING id`;
    await tx`INSERT INTO membresias (usuario_id, empresa_id, rol) VALUES (${u.id}, ${e.id}, 'administrador')`;
    await tx`SELECT set_config('app.empresa_id', ${e.id}, true)`;
    await tx`INSERT INTO series (empresa_id, codigo, descripcion, tipo_factura, ejercicio) VALUES
      (${e.id}, 'A', 'Facturas ordinarias', 'F1', ${ejercicio}),
      (${e.id}, 'R', 'Rectificativas', 'R1', ${ejercicio}),
      (${e.id}, 'S', 'Simplificadas', 'F2', ${ejercicio})`;
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id) VALUES (${e.id}, ${u.id}, 'alta_empresa', 'empresa', ${e.id})`;
    return { empresaId: e.id as string, usuarioId: u.id as string };
  });
}
