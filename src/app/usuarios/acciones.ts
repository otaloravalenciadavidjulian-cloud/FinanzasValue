"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db/cliente";
import { requerirSesion, ROLES_ADMINISTRACION } from "@/lib/auth/sesion";
import { altaUsuario, cambiarAcceso, ErrorUsuario, quitarDobleFactor, restablecerContrasena } from "@/lib/usuarios/gestion";

type Estado = { error?: string; ok?: string; temporal?: string };

async function ejecutar(fn: () => Promise<Estado>): Promise<Estado> {
  try {
    const r = await fn();
    revalidatePath("/usuarios");
    return r;
  } catch (e) {
    if (e instanceof ErrorUsuario) return { error: e.message };
    throw e;
  }
}

export async function crearUsuario(_p: Estado, f: FormData): Promise<Estado> {
  const s = await requerirSesion(ROLES_ADMINISTRACION);
  return ejecutar(async () => {
    const r = await altaUsuario(db(), s, { nombre: String(f.get("nombre") ?? ""), email: String(f.get("email") ?? ""), rol: String(f.get("rol") ?? "") });
    return r.temporal
      ? { ok: "Usuario creado. Dale esta contraseña temporal por un canal seguro: tendrá que cambiarla al entrar. No se volverá a mostrar.", temporal: r.temporal }
      : { ok: "Esa persona ya tenía cuenta en Value: ya puede entrar en esta empresa con su contraseña." };
  });
}

export async function accionUsuario(usuarioId: string, _p: Estado, f: FormData): Promise<Estado> {
  const s = await requerirSesion(ROLES_ADMINISTRACION);
  const accion = String(f.get("accion") ?? "");
  return ejecutar(async () => {
    switch (accion) {
      case "rol": await cambiarAcceso(db(), s, usuarioId, { rol: String(f.get("rol") ?? "") }); return { ok: "Rol cambiado" };
      case "desactivar": await cambiarAcceso(db(), s, usuarioId, { activa: false }); return { ok: "Acceso desactivado" };
      case "activar": await cambiarAcceso(db(), s, usuarioId, { activa: true }); return { ok: "Acceso reactivado" };
      case "contrasena": return { ok: "Contraseña temporal (se muestra una sola vez):", temporal: await restablecerContrasena(db(), s, usuarioId) };
      case "mfa": await quitarDobleFactor(db(), s, usuarioId); return { ok: "Doble factor quitado: podrá activarlo de nuevo desde Mi cuenta" };
      default: return { error: "Acción no válida" };
    }
  });
}
