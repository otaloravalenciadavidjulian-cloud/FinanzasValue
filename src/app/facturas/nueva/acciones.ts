"use server";
import { redirect } from "next/navigation";
import { db } from "@/db/cliente";
import { requerirSesion, ROLES_FACTURACION } from "@/lib/auth/sesion";
import { aCentimos } from "@/lib/fiscal/dinero";
import { emitirFactura, ErrorFacturacion } from "@/lib/facturacion/emitir";
import { ZodError } from "zod";

export type EstadoEmision = { error?: string; valores?: Record<string, string[]> };

export async function emitir(_prev: EstadoEmision, form: FormData): Promise<EstadoEmision> {
  const s = await requerirSesion(ROLES_FACTURACION);
  const valores: Record<string, string[]> = {};
  for (const [k, v] of form.entries()) if (!k.startsWith("$")) (valores[k] ??= []).push(String(v));
  let id: string;
  try {
    const conceptos = form.getAll("concepto").map(String);
    const lineas = conceptos.map((concepto, i) => ({
      concepto,
      cantidad: Number(String(form.getAll("cantidad")[i]).replace(",", ".")),
      precioUnitarioCent: aCentimos(String(form.getAll("precio")[i] || "0")),
      descuentoPct: Number(form.getAll("descuento")[i] || 0),
      tipoIva: Number(form.getAll("iva")[i]),
    })).filter((l) => l.concepto.trim());
    const r = await emitirFactura(db(), { empresaId: s.empresaId, usuarioId: s.usuarioId }, {
      serieCodigo: String(form.get("serie")),
      clienteId: String(form.get("cliente") || "") || undefined,
      proyectoId: String(form.get("proyecto") || "") || undefined,
      fechaExpedicion: String(form.get("fecha")),
      vencimiento: String(form.get("vencimiento") || "") || undefined,
      retencionPct: Number(form.get("retencion") || 0),
      lineas,
    });
    id = r.id;
  } catch (e) {
    if (e instanceof ErrorFacturacion) return { error: e.message, valores };
    if (e instanceof ZodError) return { error: e.issues.map((i) => i.message).join(". "), valores };
    if (e instanceof Error && /Importe no válido/.test(e.message)) return { error: e.message, valores };
    throw e;
  }
  redirect(`/facturas/${id}`);
}
