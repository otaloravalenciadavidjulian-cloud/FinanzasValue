import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db/cliente";
import { verificarContrasena } from "./contrasena";

export const COOKIE = "value_sesion";
const DURACION_H = 12;
const MAX_FALLOS = 5;

export type Rol = "administrador" | "direccion" | "contable" | "gestoria" | "empleado";
export interface Sesion { usuarioId: string; empresaId: string; rol: Rol; nombre: string; email: string }

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

async function origen() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  return { ip: ip && /^[0-9a-f.:]+$/i.test(ip) ? ip : null, agente: h.get("user-agent")?.slice(0, 300) ?? null };
}

/** Comprueba credenciales, registra el acceso y abre una sesión. Devuelve un mensaje de error o null. */
export async function iniciarSesion(emailEntrada: string, pw: string): Promise<string | null> {
  const email = emailEntrada.trim().toLowerCase();
  const sql = db();
  const { ip, agente } = await origen();
  const [{ fallos }] = await sql<{ fallos: number }[]>`
    SELECT count(*)::int AS fallos FROM accesos
    WHERE NOT correcto AND creado_en > now() - interval '15 minutes' AND (email = ${email} OR (${ip}::inet IS NOT NULL AND ip = ${ip}::inet))`;
  if (fallos >= MAX_FALLOS) return "Demasiados intentos fallidos. Espera 15 minutos y vuelve a probar.";

  const [u] = await sql<{ id: string; hash_contrasena: string }[]>`SELECT id, hash_contrasena FROM usuarios WHERE email = ${email}`;
  const ok = u ? await verificarContrasena(pw, u.hash_contrasena) : false;
  await sql`INSERT INTO accesos (email, usuario_id, correcto, ip, agente) VALUES (${email}, ${u?.id ?? null}, ${ok}, ${ip}, ${agente})`;
  if (!u || !ok) return "El email o la contraseña no son correctos.";

  const [m] = await sql<{ empresa_id: string }[]>`SELECT empresa_id FROM membresias WHERE usuario_id = ${u.id} ORDER BY rol LIMIT 1`;
  if (!m) return "Tu usuario no tiene acceso a ninguna empresa.";

  const token = randomBytes(32).toString("base64url");
  await sql`INSERT INTO sesiones (token_sha256, usuario_id, empresa_id, expira_en, ip, agente)
    VALUES (${sha(token)}, ${u.id}, ${m.empresa_id}, now() + make_interval(hours => ${DURACION_H}), ${ip}, ${agente})`;
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: DURACION_H * 3600,
  });
  return null;
}

export async function sesionActual(): Promise<Sesion | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [s] = await db()<{ usuario_id: string; empresa_id: string; rol: Rol; nombre: string; email: string }[]>`
    SELECT s.usuario_id, s.empresa_id, m.rol, u.nombre, u.email
    FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
    JOIN membresias m ON m.usuario_id = s.usuario_id AND m.empresa_id = s.empresa_id
    WHERE s.token_sha256 = ${sha(token)} AND s.cerrada_en IS NULL AND s.expira_en > now()`;
  return s ? { usuarioId: s.usuario_id, empresaId: s.empresa_id, rol: s.rol, nombre: s.nombre, email: s.email } : null;
}

/** Devuelve la sesión o redirige al inicio de sesión. Con roles, exige uno de ellos. */
export async function requerirSesion(roles?: Rol[]): Promise<Sesion> {
  const s = await sesionActual();
  if (!s) redirect("/login");
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
