import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db/cliente";
import { verificarContrasena } from "./contrasena";
import { hashRecuperacion, verificarCodigo } from "./totp";

export const COOKIE = "value_sesion";
const DURACION_H = 12;
const MAX_FALLOS = 5;

export type Rol = "administrador" | "direccion" | "contable" | "gestoria" | "empleado";
export interface Sesion { usuarioId: string; empresaId: string; rol: Rol; nombre: string; email: string; mfaActivo: boolean; debeCambiarContrasena: boolean }
export type ResultadoAcceso = { error: string } | { mfa: true } | { ok: true };
const MINUTOS_MFA = 5;

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

async function origen() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  return { ip: ip && /^[0-9a-f.:]+$/i.test(ip) ? ip : null, agente: h.get("user-agent")?.slice(0, 300) ?? null };
}

async function demasiadosFallos(email: string, ip: string | null) {
  const [{ fallos }] = await db()<{ fallos: number }[]>`
    SELECT count(*)::int AS fallos FROM accesos
    WHERE NOT correcto AND creado_en > now() - interval '15 minutes' AND (email = ${email} OR (${ip}::inet IS NOT NULL AND ip = ${ip}::inet))`;
  return fallos >= MAX_FALLOS;
}

async function ponerCookie(token: string, horas: number) {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: Math.round(horas * 3600),
  });
}

/**
 * Comprueba credenciales, registra el acceso y abre una sesión. Si el usuario tiene doble factor, la
 * sesión queda pendiente del código durante unos minutos (ver verificarSegundoFactor).
 */
export async function iniciarSesion(emailEntrada: string, pw: string): Promise<ResultadoAcceso> {
  const email = emailEntrada.trim().toLowerCase();
  const sql = db();
  const { ip, agente } = await origen();
  if (await demasiadosFallos(email, ip)) return { error: "Demasiados intentos fallidos. Espera 15 minutos y vuelve a probar." };

  const [u] = await sql<{ id: string; hash_contrasena: string; mfa_activo: boolean }[]>`SELECT id, hash_contrasena, mfa_activo FROM usuarios WHERE email = ${email}`;
  const ok = u ? await verificarContrasena(pw, u.hash_contrasena) : false;
  await sql`INSERT INTO accesos (email, usuario_id, correcto, ip, agente) VALUES (${email}, ${u?.id ?? null}, ${ok}, ${ip}, ${agente})`;
  if (!u || !ok) return { error: "El email o la contraseña no son correctos." };

  const [m] = await sql<{ empresa_id: string }[]>`SELECT empresa_id FROM membresias WHERE usuario_id = ${u.id} AND activa ORDER BY rol LIMIT 1`;
  if (!m) return { error: "Tu usuario no tiene acceso a ninguna empresa." };

  const token = randomBytes(32).toString("base64url");
  const horas = u.mfa_activo ? MINUTOS_MFA / 60 : DURACION_H;
  await sql`INSERT INTO sesiones (token_sha256, usuario_id, empresa_id, expira_en, ip, agente, mfa_pendiente)
    VALUES (${sha(token)}, ${u.id}, ${m.empresa_id}, now() + make_interval(secs => ${horas * 3600}), ${ip}, ${agente}, ${u.mfa_activo})`;
  await ponerCookie(token, horas);
  return u.mfa_activo ? { mfa: true } : { ok: true };
}

/** Segundo paso del acceso: un código de la aplicación de autenticación o uno de recuperación. */
export async function verificarSegundoFactor(entrada: string): Promise<ResultadoAcceso> {
  const sql = db();
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return { error: "La sesión ha caducado. Vuelve a entrar." };
  const { ip, agente } = await origen();
  const [p] = await sql<{ id: string; usuario_id: string; email: string; mfa_secreto: string; mfa_ultimo_paso: string | null; mfa_recuperacion: string[] }[]>`
    SELECT s.id, s.usuario_id, u.email, u.mfa_secreto, u.mfa_ultimo_paso, u.mfa_recuperacion FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token_sha256 = ${sha(token)} AND s.mfa_pendiente AND s.cerrada_en IS NULL AND s.expira_en > now() AND u.mfa_activo`;
  if (!p) return { error: "La sesión ha caducado. Vuelve a entrar." };
  if (await demasiadosFallos(p.email, ip)) return { error: "Demasiados intentos fallidos. Espera 15 minutos y vuelve a probar." };

  let ok = false;
  const limpio = entrada.trim();
  if (/^\d{3}\s?\d{3}$/.test(limpio)) {
    const paso = verificarCodigo(p.mfa_secreto, limpio, p.mfa_ultimo_paso === null ? null : Number(p.mfa_ultimo_paso));
    // Se guarda el paso de forma atómica para que el mismo código no valga en dos accesos simultáneos.
    if (paso !== null) ok = (await sql`UPDATE usuarios SET mfa_ultimo_paso = ${paso}
      WHERE id = ${p.usuario_id} AND (mfa_ultimo_paso IS NULL OR mfa_ultimo_paso < ${paso}) RETURNING id`).length === 1;
  } else if (limpio) {
    const h = hashRecuperacion(limpio);
    ok = (await sql`UPDATE usuarios SET mfa_recuperacion = array_remove(mfa_recuperacion, ${h})
      WHERE id = ${p.usuario_id} AND ${h} = ANY(mfa_recuperacion) RETURNING id`).length === 1;
  }
  await sql`INSERT INTO accesos (email, usuario_id, correcto, ip, agente) VALUES (${p.email}, ${p.usuario_id}, ${ok}, ${ip}, ${agente ? `mfa · ${agente}`.slice(0, 300) : "mfa"})`;
  if (!ok) return { error: "El código no es correcto o ya se ha usado." };

  // Se cambia el token al completar el acceso.
  const nuevo = randomBytes(32).toString("base64url");
  await sql`UPDATE sesiones SET token_sha256 = ${sha(nuevo)}, mfa_pendiente = false, expira_en = now() + make_interval(hours => ${DURACION_H}) WHERE id = ${p.id}`;
  await ponerCookie(nuevo, DURACION_H);
  return { ok: true };
}

export async function sesionActual(): Promise<Sesion | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [s] = await db()<{ usuario_id: string; empresa_id: string; rol: Rol; nombre: string; email: string; mfa_activo: boolean; debe_cambiar_contrasena: boolean }[]>`
    SELECT s.usuario_id, s.empresa_id, m.rol, u.nombre, u.email, u.mfa_activo, u.debe_cambiar_contrasena
    FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
    JOIN membresias m ON m.usuario_id = s.usuario_id AND m.empresa_id = s.empresa_id AND m.activa
    WHERE s.token_sha256 = ${sha(token)} AND s.cerrada_en IS NULL AND NOT s.mfa_pendiente AND s.expira_en > now()`;
  return s ? {
    usuarioId: s.usuario_id, empresaId: s.empresa_id, rol: s.rol, nombre: s.nombre, email: s.email,
    mfaActivo: s.mfa_activo, debeCambiarContrasena: s.debe_cambiar_contrasena,
  } : null;
}

/**
 * Devuelve la sesión o redirige al inicio de sesión. Con roles, exige uno de ellos. Si la contraseña es
 * temporal, lleva a cambiarla salvo en la propia página de la cuenta.
 */
export async function requerirSesion(roles?: Rol[], opciones: { permitirCambioPendiente?: boolean } = {}): Promise<Sesion> {
  const s = await sesionActual();
  if (!s) redirect("/login");
  if (s.debeCambiarContrasena && !opciones.permitirCambioPendiente) redirect("/cuenta");
  if (roles && !roles.includes(s.rol)) throw new Error("No tienes permiso para esta acción");
  return s;
}

export async function cerrarSesion(): Promise<void> {
  const c = await cookies();
  const token = c.get(COOKIE)?.value;
  if (token) await db()`UPDATE sesiones SET cerrada_en = now() WHERE token_sha256 = ${sha(token)}`;
  c.delete(COOKIE);
}

export const ROLES_FACTURACION: Rol[] = ["administrador", "direccion", "contable"];
/** Pueden registrar gastos; el empleado solo ve y gestiona los suyos. */
export const ROLES_GASTOS: Rol[] = ["administrador", "direccion", "contable", "empleado"];
/** Contabilidad e impuestos: también la gestoría externa, en solo lectura. */
export const ROLES_CONTABILIDAD: Rol[] = ["administrador", "direccion", "contable", "gestoria"];
/** Gestión de usuarios de la empresa. */
export const ROLES_ADMINISTRACION: Rol[] = ["administrador"];
