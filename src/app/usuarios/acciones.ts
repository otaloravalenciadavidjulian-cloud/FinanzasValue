"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { db } from "@/db/cliente";
import { requerirSesion, ROLES_ADMINISTRACION } from "@/lib/auth/sesion";
import { altaUsuario, cambiarAcceso, ErrorUsuario, listarUsuarios, quitarDobleFactor, restablecerContrasena } from "@/lib/usuarios/gestion";

type Estado = { error?: string; ok?: string; temporal?: string; invitacion?: string };

async function direccionWeb() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function invitacion(nombre: string, web: string, email: string, temporal: string) {
  return [
    `Hola ${nombre}, ya tienes acceso a Value, nuestro programa de finanzas.`,
    ``,
    `1. Entra en ${web}/login`,
    `2. Email: ${email}`,
    `3. Contraseña temporal: ${temporal}`,
    ``,
    `Al entrar te pedirá que pongas una contraseña tuya (mínimo 12 caracteres). Después, en "Mi cuenta", activa la verificación en dos pasos con Google Authenticator o Microsoft Authenticator.`,
  ].join("\n");
}

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
    const nombre = String(f.get("nombre") ?? "").trim();
    const email = String(f.get("email") ?? "").trim().toLowerCase();
    const r = await altaUsuario(db(), s, { nombre, email, rol: String(f.get("rol") ?? "") });
    return r.temporal
      ? { ok: "Usuario creado. Copia el mensaje y envíaselo por WhatsApp o email: lleva el enlace, su email y una contraseña temporal que tendrá que cambiar al entrar. No se volverá a mostrar.", temporal: r.temporal, invitacion: invitacion(nombre.split(" ")[0] || nombre, await direccionWeb(), email, r.temporal) }
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
      case "contrasena": {
        const temporal = await restablecerContrasena(db(), s, usuarioId);
        const u = (await listarUsuarios(db(), s.empresaId)).find((x) => x.id === usuarioId);
        return {
          ok: "Contraseña temporal (se muestra una sola vez). Copia el mensaje y envíaselo:",
          temporal,
          invitacion: u ? invitacion(u.nombre.split(" ")[0] || u.nombre, await direccionWeb(), u.email, temporal) : undefined,
        };
      }
      case "mfa": await quitarDobleFactor(db(), s, usuarioId); return { ok: "Doble factor quitado: podrá activarlo de nuevo desde Mi cuenta" };
      default: return { error: "Acción no válida" };
    }
  });
}
