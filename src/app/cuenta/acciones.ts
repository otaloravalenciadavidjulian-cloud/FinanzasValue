"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db/cliente";
import { COOKIE, requerirSesion } from "@/lib/auth/sesion";
import { activarDobleFactor, cambiarContrasena, desactivarDobleFactor, ErrorUsuario, prepararDobleFactor } from "@/lib/usuarios/gestion";

type Estado = { error?: string; ok?: string; codigos?: string[] };
const sesion = () => requerirSesion(undefined, { permitirCambioPendiente: true });
async function intentar(fn: () => Promise<Estado>): Promise<Estado> {
  try { return await fn(); } catch (e) { if (e instanceof ErrorUsuario) return { error: e.message }; throw e; }
}

export async function nuevaContrasena(_p: Estado, f: FormData): Promise<Estado> {
  const s = await sesion();
  const nueva = String(f.get("nueva") ?? "");
  if (nueva !== String(f.get("repetir") ?? "")) return { error: "Las dos contraseñas nuevas no coinciden" };
  const r = await intentar(async () => {
    await cambiarContrasena(db(), s, String(f.get("actual") ?? ""), nueva, (await cookies()).get(COOKIE)?.value ?? null);
    return { ok: "Contraseña cambiada. Se han cerrado tus otras sesiones." };
  });
  if (r.ok && s.debeCambiarContrasena) redirect("/");
  return r;
}

export async function empezarDobleFactor() {
  const s = await sesion();
  await prepararDobleFactor(db(), s);
  redirect("/cuenta?activar=1");
}

export async function confirmarDobleFactor(_p: Estado, f: FormData): Promise<Estado> {
  const s = await sesion();
  // Sin revalidar la página: si se volviera a pintar ya activada, se perderían los códigos antes de verlos.
  return intentar(async () => ({ codigos: await activarDobleFactor(db(), s, String(f.get("codigo") ?? "")) }));
}

export async function apagarDobleFactor(_p: Estado, f: FormData): Promise<Estado> {
  const s = await sesion();
  const r = await intentar(async () => { await desactivarDobleFactor(db(), s, String(f.get("contrasena") ?? "")); return { ok: "Doble factor desactivado" }; });
  revalidatePath("/cuenta");
  return r;
}
