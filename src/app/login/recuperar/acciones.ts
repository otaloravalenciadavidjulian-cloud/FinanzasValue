"use server";
import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { db, enEmpresa } from "@/db/cliente";
import { hashContrasena } from "@/lib/auth/contrasena";

type Estado = { error?: string; ok?: string; email?: string };

const iguales = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Recuperación de la contraseña de un administrador con el código SETUP_TOKEN, que solo puede ver quien
 * tiene acceso a las variables de entorno del servidor (Netlify). El resto de usuarios la piden a su administrador.
 */
export async function recuperar(_p: Estado, f: FormData): Promise<Estado> {
  const email = String(f.get("email") ?? "").trim().toLowerCase();
  const codigo = String(f.get("codigo") ?? "");
  const nueva = String(f.get("nueva") ?? ""), repetir = String(f.get("repetir") ?? "");
  const token = process.env.SETUP_TOKEN ?? "";
  const sql = db();
  const h = await headers();
  const ipBruta = (h.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const ip = ipBruta && /^[0-9a-f.:]+$/i.test(ipBruta) ? ipBruta : null;

  const [{ fallos }] = await sql<{ fallos: number }[]>`
    SELECT count(*)::int AS fallos FROM accesos
    WHERE NOT correcto AND creado_en > now() - interval '15 minutes' AND (email = ${email} OR (${ip}::inet IS NOT NULL AND ip = ${ip}::inet))`;
  if (fallos >= 5) return { error: "Demasiados intentos fallidos. Espera 15 minutos y vuelve a probar.", email };
  if (token.length < 16) return { error: "La recuperación no está disponible: falta la variable SETUP_TOKEN en Netlify.", email };
  if (nueva !== repetir) return { error: "Las dos contraseñas nuevas no coinciden.", email };
  if (nueva.length < 12) return { error: "La contraseña nueva debe tener al menos 12 caracteres.", email };

  const [u] = await sql<{ id: string; empresa_id: string }[]>`
    SELECT u.id, m.empresa_id FROM usuarios u JOIN membresias m ON m.usuario_id = u.id
    WHERE u.email = ${email} AND m.activa AND m.rol = 'administrador' LIMIT 1`;
  const ok = !!u && iguales(codigo.trim(), token);
  await sql`INSERT INTO accesos (email, usuario_id, correcto, ip, agente) VALUES (${email}, ${u?.id ?? null}, ${ok}, ${ip}, ${h.get("user-agent")?.slice(0, 300) ?? null})`;
  if (!ok) return { error: "El email no es de un administrador o el código de recuperación no es correcto.", email };

  const hash = await hashContrasena(nueva);
  await sql.begin(async (tx) => {
    await tx`UPDATE usuarios SET hash_contrasena = ${hash}, debe_cambiar_contrasena = false WHERE id = ${u.id}`;
    await tx`DELETE FROM sesiones WHERE usuario_id = ${u.id}`;
  });
  await enEmpresa(sql, u.empresa_id, (tx) => tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
    VALUES (${u.empresa_id}, ${u.id}, 'recuperar_contrasena', 'usuario', ${u.id}, ${tx.json({ metodo: "codigo de configuracion" })})`);
  return { ok: "Contraseña cambiada. Ya puedes entrar con la nueva.", email };
}
