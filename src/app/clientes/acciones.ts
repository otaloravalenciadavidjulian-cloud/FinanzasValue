"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db/cliente";
import { requerirSesion, ROLES_FACTURACION } from "@/lib/auth/sesion";
import { altaTercero, ErrorTercero } from "@/lib/terceros/alta";

export type EstadoTercero = { error?: string; ok?: string; valores?: Record<string, string> };

const CAMPOS = ["razon", "nif", "direccion", "cp", "municipio", "provincia", "email", "telefono", "dias", "categoria"];

export async function guardarTercero(papel: "cliente" | "proveedor", f: FormData): Promise<EstadoTercero> {
  const s = await requerirSesion(ROLES_FACTURACION);
  const g = (k: string) => String(f.get(k) ?? "").trim();
  const valores = Object.fromEntries(CAMPOS.map((k) => [k, g(k)]));
  try {
    const r = await altaTercero(db(), s, papel, {
      razonSocial: g("razon"), nif: g("nif"), direccion: g("direccion"), codigoPostal: g("cp"), municipio: g("municipio"),
      provincia: g("provincia"), email: g("email"), telefono: g("telefono"), diasPago: Number(g("dias") || 30), categoria: g("categoria"),
    });
    revalidatePath(papel === "cliente" ? "/clientes" : "/proveedores");
    return { ok: r.nuevo ? `${g("razon")} guardado.` : `Ya existía con ese NIF; ahora también figura como ${papel}.` };
  } catch (e) {
    if (e instanceof ErrorTercero) return { error: e.message, valores };
    throw e;
  }
}

export async function crearCliente(_p: EstadoTercero, f: FormData): Promise<EstadoTercero> {
  return guardarTercero("cliente", f);
}
