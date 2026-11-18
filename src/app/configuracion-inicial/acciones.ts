"use server";
import { timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { db } from "@/db/cliente";
import { iniciarSesion } from "@/lib/auth/sesion";
import { altaEmpresa } from "@/lib/empresas/alta";

const iguales = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

type Estado = { error?: string; valores?: Record<string, string> };

export async function configurar(_p: Estado, f: FormData): Promise<Estado> {
  const valores = Object.fromEntries(["razon", "nif", "domicilio", "cp", "municipio", "provincia", "nombre", "email"].map((k) => [k, String(f.get(k) ?? "")]));
  const r = await configurarInterno(f);
  return r ? { error: r, valores } : {};
}

async function configurarInterno(f: FormData): Promise<string | null> {
  const token = process.env.SETUP_TOKEN ?? "";
  if (token.length < 16) return "Falta la variable SETUP_TOKEN en el servidor (mínimo 16 caracteres).";
  if (!iguales(String(f.get("token") ?? ""), token)) return "El código de configuración no es correcto.";
  const sql = db();
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM usuarios`;
  if (n > 0) return "La configuración inicial ya se hizo. Inicia sesión.";
  const g = (k: string) => String(f.get(k) ?? "");
  try {
    await altaEmpresa(sql, {
      razonSocial: g("razon"), nif: g("nif"), domicilio: g("domicilio"), codigoPostal: g("cp"), municipio: g("municipio"), provincia: g("provincia"),
      adminNombre: g("nombre"), adminEmail: g("email"), adminContrasena: g("contrasena"),
    }, new Date().getFullYear());
  } catch (e) {
    return e instanceof Error ? e.message : "No se pudo completar la configuración";
  }
  const err = await iniciarSesion(g("email"), g("contrasena"));
  if (err) return err;
  redirect("/");
}
