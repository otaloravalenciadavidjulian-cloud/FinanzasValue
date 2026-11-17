"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db/cliente";
import { requerirSesion, ROLES_FACTURACION } from "@/lib/auth/sesion";
import { ErrorCobro, registrarCobro } from "@/lib/cobros/registrar";
import { aCentimos } from "@/lib/fiscal/dinero";

export type EstadoMovimiento = { error?: string; ok?: string; valores?: Record<string, string> };

export async function cobrar(facturaId: string, _p: EstadoMovimiento, f: FormData): Promise<EstadoMovimiento> {
  const s = await requerirSesion(ROLES_FACTURACION);
  const g = (k: string) => String(f.get(k) ?? "").trim();
  const valores = { fecha: g("fecha"), importe: g("importe"), metodo: g("metodo"), notas: g("notas") };
  let importeCent: number;
  try { importeCent = aCentimos(g("importe")); } catch { return { error: "Importe no válido", valores }; }
  try {
    await registrarCobro(db(), s, facturaId, { fecha: g("fecha"), importeCent, metodo: g("metodo"), notas: g("notas") });
  } catch (e) {
    if (e instanceof ErrorCobro) return { error: e.message, valores };
    if (e instanceof Error && e.name === "ZodError") return { error: "Revisa la fecha y el método de cobro", valores };
    throw e;
  }
  revalidatePath(`/facturas/${facturaId}`);
  revalidatePath("/facturas");
  return { ok: "Cobro registrado." };
}
