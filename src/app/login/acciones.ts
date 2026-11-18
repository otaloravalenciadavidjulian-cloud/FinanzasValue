"use server";
import { redirect } from "next/navigation";
import { cerrarSesion, iniciarSesion } from "@/lib/auth/sesion";

export async function entrar(_p: { error?: string; email?: string }, form: FormData): Promise<{ error?: string; email?: string }> {
  const email = String(form.get("email") ?? "");
  const error = await iniciarSesion(email, String(form.get("contrasena") ?? ""));
  if (error) return { error, email };
  redirect("/");
}

export async function salir() {
  await cerrarSesion();
  redirect("/login");
}
