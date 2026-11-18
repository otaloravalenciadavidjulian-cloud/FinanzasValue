"use server";
import { redirect } from "next/navigation";
import { cerrarSesion, iniciarSesion, verificarSegundoFactor } from "@/lib/auth/sesion";

export async function entrar(_p: { error?: string; email?: string }, form: FormData): Promise<{ error?: string; email?: string }> {
  const email = String(form.get("email") ?? "");
  const r = await iniciarSesion(email, String(form.get("contrasena") ?? ""));
  if ("error" in r) return { error: r.error, email };
  redirect("mfa" in r ? "/login/codigo" : "/");
}

export async function confirmarCodigo(_p: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const r = await verificarSegundoFactor(String(form.get("codigo") ?? ""));
  if ("error" in r) return { error: r.error };
  redirect("/");
}

export async function salir() {
  await cerrarSesion();
  redirect("/login");
}
