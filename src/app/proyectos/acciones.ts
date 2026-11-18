"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db/cliente";
import { requerirSesion, ROLES_FACTURACION } from "@/lib/auth/sesion";
import { altaProyecto, cambiarEstadoProyecto, ErrorProyecto } from "@/lib/rentabilidad/proyectos";

export async function crearProyecto(_p: { error?: string; ok?: string }, f: FormData): Promise<{ error?: string; ok?: string }> {
  const s = await requerirSesion(ROLES_FACTURACION);
  try {
    await altaProyecto(db(), s, { nombre: String(f.get("nombre") ?? ""), clienteId: String(f.get("cliente") || "") || undefined });
  } catch (e) {
    if (e instanceof ErrorProyecto) return { error: e.message };
    throw e;
  }
  revalidatePath("/proyectos");
  return { ok: "Proyecto creado. Ya puedes asignarlo en facturas y gastos." };
}

export async function alternarProyecto(id: string, activo: boolean) {
  const s = await requerirSesion(ROLES_FACTURACION);
  await cambiarEstadoProyecto(db(), s, id, activo);
  revalidatePath("/proyectos");
}
