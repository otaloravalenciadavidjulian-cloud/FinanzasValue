import { randomBytes } from "node:crypto";
import { enEmpresa, type Sql } from "@/db/cliente";
import { hashContrasena, validarContrasena, verificarContrasena } from "@/lib/auth/contrasena";
import type { Rol } from "@/lib/auth/sesion";
import { codigosRecuperacion, nuevoSecreto, verificarCodigo } from "@/lib/auth/totp";

export const ROLES: { codigo: Rol; nombre: string; descripcion: string }[] = [
  { codigo: "administrador", nombre: "Administrador", descripcion: "Todo, incluida la gestión de usuarios" },
  { codigo: "direccion", nombre: "Dirección", descripcion: "Todo salvo usuarios" },
  { codigo: "contable", nombre: "Contable", descripcion: "Facturación, gastos, tesorería, contabilidad e impuestos" },
  { codigo: "gestoria", nombre: "Gestoría", descripcion: "Consulta de contabilidad, impuestos e informes" },
  { codigo: "empleado", nombre: "Empleado", descripcion: "Solo sus propios gastos" },
];
const CODIGOS_ROL = new Set(ROLES.map((r) => r.codigo));

export class ErrorUsuario extends Error {}
type Ctx = { empresaId: string; usuarioId: string };

/** Contraseña temporal legible: 4 grupos de 4 caracteres sin letras ambiguas. */
export function contrasenaTemporal(): string {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  const b = randomBytes(16);
  return Array.from(b, (x) => a[x % a.length]).join("").replace(/(.{4})(?!$)/g, "$1-");
}

async function auditar(sql: Sql, ctx: Ctx, accion: string, usuarioId: string, despues: unknown) {
  await enEmpresa(sql, ctx.empresaId, (tx) => tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
    VALUES (${ctx.empresaId}, ${ctx.usuarioId}, ${accion}, 'usuario', ${usuarioId}, ${tx.json(despues as never)})`);
}

export async function listarUsuarios(sql: Sql, empresaId: string) {
  return sql<{ id: string; nombre: string; email: string; rol: Rol; activa: boolean; mfa_activo: boolean; debe_cambiar_contrasena: boolean; ultimo_acceso: string | null }[]>`
    SELECT u.id, u.nombre, u.email, m.rol, m.activa, u.mfa_activo, u.debe_cambiar_contrasena,
      (SELECT to_char(max(a.creado_en) AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') FROM accesos a WHERE a.usuario_id = u.id AND a.correcto) AS ultimo_acceso
    FROM membresias m JOIN usuarios u ON u.id = m.usuario_id WHERE m.empresa_id = ${empresaId}
    ORDER BY m.activa DESC, u.nombre`;
}

/**
 * Da acceso a una persona. Si el email no existe, crea el usuario con una contraseña temporal que se
 * devuelve una sola vez; si ya existe (por ejemplo, en otra empresa), solo le da acceso.
 */
export async function altaUsuario(sql: Sql, ctx: Ctx, d: { nombre: string; email: string; rol: string }): Promise<{ id: string; temporal: string | null }> {
  const email = d.email.trim().toLowerCase(), nombre = d.nombre.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErrorUsuario("El email no es válido");
  if (!nombre) throw new ErrorUsuario("Falta el nombre");
  if (!CODIGOS_ROL.has(d.rol as Rol)) throw new ErrorUsuario("Rol no válido");
  const temporal = contrasenaTemporal();
  const hash = await hashContrasena(temporal);
  const r = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${"usuario:" + email}))`;
    const [u] = await tx<{ id: string }[]>`SELECT id FROM usuarios WHERE email = ${email}`;
    if (u) {
      const [m] = await tx`SELECT activa FROM membresias WHERE usuario_id = ${u.id} AND empresa_id = ${ctx.empresaId}`;
      if (m) throw new ErrorUsuario(m.activa ? "Esa persona ya tiene acceso" : "Esa persona ya estuvo en la empresa: reactívala en la lista");
      await tx`INSERT INTO membresias (usuario_id, empresa_id, rol) VALUES (${u.id}, ${ctx.empresaId}, ${d.rol})`;
      return { id: u.id, temporal: null };
    }
    const [n] = await tx<{ id: string }[]>`INSERT INTO usuarios (email, nombre, hash_contrasena, debe_cambiar_contrasena) VALUES (${email}, ${nombre}, ${hash}, true) RETURNING id`;
    await tx`INSERT INTO membresias (usuario_id, empresa_id, rol) VALUES (${n.id}, ${ctx.empresaId}, ${d.rol})`;
    return { id: n.id, temporal };
  });
  await auditar(sql, ctx, "alta_usuario", r.id, { email, rol: d.rol, nuevo: r.temporal !== null });
  return r;
}

/** Cambia el rol o desactiva/reactiva el acceso. Nunca deja la empresa sin un administrador activo. */
export async function cambiarAcceso(sql: Sql, ctx: Ctx, usuarioId: string, cambio: { rol?: string; activa?: boolean }) {
  if (cambio.rol !== undefined && !CODIGOS_ROL.has(cambio.rol as Rol)) throw new ErrorUsuario("Rol no válido");
  if (usuarioId === ctx.usuarioId) throw new ErrorUsuario("No puedes cambiar tu propio rol ni desactivarte");
  const antes = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${"membresias:" + ctx.empresaId}))`;
    const [m] = await tx<{ rol: Rol; activa: boolean }[]>`SELECT rol, activa FROM membresias WHERE usuario_id = ${usuarioId} AND empresa_id = ${ctx.empresaId}`;
    if (!m) throw new ErrorUsuario("Usuario no encontrado");
    const rol = cambio.rol ?? m.rol, activa = cambio.activa ?? m.activa;
    await tx`UPDATE membresias SET rol = ${rol}, activa = ${activa} WHERE usuario_id = ${usuarioId} AND empresa_id = ${ctx.empresaId}`;
    const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM membresias WHERE empresa_id = ${ctx.empresaId} AND rol = 'administrador' AND activa`;
    if (n === 0) throw new ErrorUsuario("Debe quedar al menos un administrador activo");
    // Quien pierde el acceso o cambia de permisos vuelve a entrar.
    await tx`UPDATE sesiones SET cerrada_en = now() WHERE usuario_id = ${usuarioId} AND empresa_id = ${ctx.empresaId} AND cerrada_en IS NULL`;
    return m;
  });
  await auditar(sql, ctx, "cambiar_acceso_usuario", usuarioId, { antes, despues: cambio });
}

/** Solo se puede restablecer a quien no tiene acceso activo a otra empresa: su cuenta no es solo de esta. */
async function soloDeEstaEmpresa(sql: Sql, ctx: Ctx, usuarioId: string) {
  const [m] = await sql`SELECT 1 FROM membresias WHERE usuario_id = ${usuarioId} AND empresa_id = ${ctx.empresaId}`;
  if (!m) throw new ErrorUsuario("Usuario no encontrado");
  const [otra] = await sql`SELECT 1 FROM membresias WHERE usuario_id = ${usuarioId} AND empresa_id <> ${ctx.empresaId} AND activa`;
  if (otra) throw new ErrorUsuario("Esta persona también usa Value en otra empresa: tiene que restablecerlo ella misma");
}

export async function restablecerContrasena(sql: Sql, ctx: Ctx, usuarioId: string): Promise<string> {
  if (usuarioId === ctx.usuarioId) throw new ErrorUsuario("Cambia tu contraseña desde Mi cuenta");
  await soloDeEstaEmpresa(sql, ctx, usuarioId);
  const temporal = contrasenaTemporal();
  await sql`UPDATE usuarios SET hash_contrasena = ${await hashContrasena(temporal)}, debe_cambiar_contrasena = true WHERE id = ${usuarioId}`;
  await sql`UPDATE sesiones SET cerrada_en = now() WHERE usuario_id = ${usuarioId} AND cerrada_en IS NULL`;
  await auditar(sql, ctx, "restablecer_contrasena", usuarioId, null);
  return temporal;
}

export async function quitarDobleFactor(sql: Sql, ctx: Ctx, usuarioId: string) {
  if (usuarioId === ctx.usuarioId) throw new ErrorUsuario("Desactívalo desde Mi cuenta");
  await soloDeEstaEmpresa(sql, ctx, usuarioId);
  await sql`UPDATE usuarios SET mfa_activo = false, mfa_secreto = NULL, mfa_ultimo_paso = NULL, mfa_recuperacion = '{}' WHERE id = ${usuarioId}`;
  await auditar(sql, ctx, "quitar_doble_factor", usuarioId, null);
}

// --- La propia cuenta -------------------------------------------------------------------------

export async function cambiarContrasena(sql: Sql, ctx: Ctx, actual: string, nueva: string, tokenSesion: string | null) {
  const [u] = await sql<{ hash_contrasena: string }[]>`SELECT hash_contrasena FROM usuarios WHERE id = ${ctx.usuarioId}`;
  if (!u || !(await verificarContrasena(actual, u.hash_contrasena))) throw new ErrorUsuario("La contraseña actual no es correcta");
  try { validarContrasena(nueva); } catch (e) { throw new ErrorUsuario((e as Error).message); }
  if (nueva === actual) throw new ErrorUsuario("La nueva contraseña debe ser distinta");
  await sql`UPDATE usuarios SET hash_contrasena = ${await hashContrasena(nueva)}, debe_cambiar_contrasena = false WHERE id = ${ctx.usuarioId}`;
  // Se cierran las demás sesiones abiertas.
  await sql`UPDATE sesiones SET cerrada_en = now() WHERE usuario_id = ${ctx.usuarioId} AND cerrada_en IS NULL
    AND token_sha256 IS DISTINCT FROM encode(sha256(convert_to(${tokenSesion ?? ""}, 'UTF8')), 'hex')`;
  await auditar(sql, ctx, "cambiar_contrasena", ctx.usuarioId, null);
}

/** Primer paso para activar el doble factor: un secreto nuevo que aún no está en uso. */
export async function prepararDobleFactor(sql: Sql, ctx: Ctx): Promise<string> {
  const [u] = await sql<{ mfa_activo: boolean; mfa_secreto: string | null }[]>`SELECT mfa_activo, mfa_secreto FROM usuarios WHERE id = ${ctx.usuarioId}`;
  if (u.mfa_activo) throw new ErrorUsuario("El doble factor ya está activo");
  if (u.mfa_secreto) return u.mfa_secreto;
  const secreto = nuevoSecreto();
  await sql`UPDATE usuarios SET mfa_secreto = ${secreto} WHERE id = ${ctx.usuarioId} AND NOT mfa_activo`;
  return secreto;
}

/** Activa el doble factor tras comprobar un código. Devuelve los códigos de recuperación (se muestran una vez). */
export async function activarDobleFactor(sql: Sql, ctx: Ctx, entrada: string): Promise<string[]> {
  const [u] = await sql<{ mfa_activo: boolean; mfa_secreto: string | null }[]>`SELECT mfa_activo, mfa_secreto FROM usuarios WHERE id = ${ctx.usuarioId}`;
  if (u.mfa_activo) throw new ErrorUsuario("El doble factor ya está activo");
  if (!u.mfa_secreto) throw new ErrorUsuario("Empieza de nuevo la activación");
  const paso = verificarCodigo(u.mfa_secreto, entrada, null);
  if (paso === null) throw new ErrorUsuario("El código no es correcto. Comprueba la hora del móvil y prueba con el siguiente.");
  const r = codigosRecuperacion();
  await sql`UPDATE usuarios SET mfa_activo = true, mfa_ultimo_paso = ${paso}, mfa_recuperacion = ${r.hashes} WHERE id = ${ctx.usuarioId}`;
  await auditar(sql, ctx, "activar_doble_factor", ctx.usuarioId, null);
  return r.codigos;
}

export async function desactivarDobleFactor(sql: Sql, ctx: Ctx, contrasena: string) {
  const [u] = await sql<{ hash_contrasena: string }[]>`SELECT hash_contrasena FROM usuarios WHERE id = ${ctx.usuarioId}`;
  if (!(await verificarContrasena(contrasena, u.hash_contrasena))) throw new ErrorUsuario("La contraseña no es correcta");
  await sql`UPDATE usuarios SET mfa_activo = false, mfa_secreto = NULL, mfa_ultimo_paso = NULL, mfa_recuperacion = '{}' WHERE id = ${ctx.usuarioId}`;
  await auditar(sql, ctx, "desactivar_doble_factor", ctx.usuarioId, null);
}
