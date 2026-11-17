"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_FACTURACION, ROLES_GASTOS, type Sesion } from "@/lib/auth/sesion";
import { ErrorCobro, registrarPago } from "@/lib/cobros/registrar";
import { aCentimos } from "@/lib/fiscal/dinero";
import { editarGasto, ErrorGasto, moverGastoAPapelera, registrarGasto, restaurarGasto, type PosibleDuplicado } from "@/lib/gastos/registrar";
import { ErrorDocumento } from "@/lib/documentos/almacen";
import { altaTercero, ErrorTercero } from "@/lib/terceros/alta";
import type { EstadoMovimiento } from "../facturas/[id]/acciones";

export type EstadoGasto = { error?: string; valores?: Record<string, string>; posiblesDuplicados?: PosibleDuplicado[] };

const num = (t: string) => Number(t.replace(",", "."));

/** Convierte el formulario en un borrador de gasto (común al alta y a la edición). */
function borradorDeFormulario(g: (k: string) => string, proveedorId: string | undefined) {
  const desglose = [0, 1, 2].filter((i) => g(`base${i}`)).map((i) => ({
    baseCent: aCentimos(g(`base${i}`)),
    tipoIva: num(g(`iva${i}`) || "21"),
    cuotaCent: g(`cuota${i}`) ? aCentimos(g(`cuota${i}`)) : undefined,
    deduciblePct: num(g(`deducible${i}`) || "100"),
  }));
  return {
    proveedorId,
    numero: g("numero") || undefined,
    tipoDocumento: (g("tipo") || "factura") as "factura",
    fechaExpedicion: g("fecha"),
    categoria: g("categoria") as "compras",
    subcategoria: g("subcategoria") || undefined,
    descripcion: g("descripcion"),
    desglose,
    retencionPct: num(g("retencion") || "0"),
    vencimiento: g("vencimiento") || undefined,
    metodoPago: g("metodo") || undefined,
    notas: g("notas") || undefined,
    confirmarPosibleDuplicado: g("confirmar") === "1",
  };
}

function errorDeFormulario(e: unknown, valores: Record<string, string>): EstadoGasto {
  if (e instanceof ErrorGasto || e instanceof ErrorDocumento || e instanceof ErrorTercero) return { error: e.message, valores };
  if (e instanceof Error && e.name === "ZodError") {
    const issues = (e as unknown as { issues: { message: string }[] }).issues;
    return { error: issues.map((i) => i.message).join(". "), valores };
  }
  if (e instanceof Error && /Importe no válido/.test(e.message)) return { error: e.message, valores };
  throw e;
}

function valoresDe(f: FormData) {
  const valores: Record<string, string> = {};
  for (const [k, v] of f.entries()) if (typeof v === "string") valores[k] = v.trim();
  return { valores, g: (k: string) => valores[k] ?? "" };
}

export async function guardarGasto(_p: EstadoGasto, f: FormData): Promise<EstadoGasto> {
  const s = await requerirSesion(ROLES_GASTOS);
  const { valores, g } = valoresDe(f);
  let resultado;
  try {
    let proveedorId = g("proveedor") || undefined;
    if (!proveedorId && g("altaProveedor") === "1" && g("nuevoNif") && s.rol !== "empleado") {
      proveedorId = (await altaTercero(db(), s, "proveedor", { nif: g("nuevoNif"), razonSocial: g("nuevoNombre") || g("nuevoNif") })).id;
      valores.proveedor = proveedorId;
    }
    resultado = await registrarGasto(db(), s, { ...borradorDeFormulario(g, proveedorId), documentoId: g("documentoId") || undefined });
  } catch (e) {
    return errorDeFormulario(e, valores);
  }
  if (!resultado.guardado) return { valores, posiblesDuplicados: resultado.posiblesDuplicados };
  revalidatePath("/gastos");
  redirect(`/gastos/${resultado.id}`);
}

export async function actualizarGasto(gastoId: string, _p: EstadoGasto, f: FormData): Promise<EstadoGasto> {
  const s = await requerirSesion(ROLES_GASTOS);
  await comprobarAcceso(s, gastoId);
  const { valores, g } = valoresDe(f);
  let resultado;
  try {
    resultado = await editarGasto(db(), s, gastoId, borradorDeFormulario(g, g("proveedor") || undefined));
  } catch (e) {
    return errorDeFormulario(e, valores);
  }
  if (!resultado.guardado) return { valores, posiblesDuplicados: resultado.posiblesDuplicados };
  revalidatePath("/gastos");
  revalidatePath(`/gastos/${gastoId}`);
  redirect(`/gastos/${gastoId}`);
}

/** El empleado solo puede actuar sobre sus propios gastos. */
async function comprobarAcceso(s: Sesion, gastoId: string) {
  if (s.rol !== "empleado") return;
  const [g] = await enEmpresa(db(), s.empresaId, (tx) => tx`SELECT 1 FROM gastos WHERE id = ${gastoId} AND creado_por = ${s.usuarioId}`);
  if (!g) throw new Error("No tienes permiso para esta acción");
}

export async function pagar(gastoId: string, _p: EstadoMovimiento, f: FormData): Promise<EstadoMovimiento> {
  const s = await requerirSesion(ROLES_FACTURACION);
  const g = (k: string) => String(f.get(k) ?? "").trim();
  const valores = { fecha: g("fecha"), importe: g("importe"), metodo: g("metodo"), notas: g("notas") };
  let importeCent: number;
  try { importeCent = aCentimos(g("importe")); } catch { return { error: "Importe no válido", valores }; }
  try {
    await registrarPago(db(), s, gastoId, { fecha: g("fecha"), importeCent, metodo: g("metodo"), notas: g("notas") });
  } catch (e) {
    if (e instanceof ErrorCobro) return { error: e.message, valores };
    throw e;
  }
  revalidatePath(`/gastos/${gastoId}`);
  revalidatePath("/gastos");
  return { ok: "Pago registrado." };
}

export async function aPapelera(gastoId: string, _p: { error?: string }, f: FormData): Promise<{ error?: string }> {
  const s = await requerirSesion(ROLES_GASTOS);
  await comprobarAcceso(s, gastoId);
  try {
    await moverGastoAPapelera(db(), s, gastoId, String(f.get("motivo") ?? ""));
  } catch (e) {
    if (e instanceof ErrorGasto) return { error: e.message };
    throw e;
  }
  revalidatePath("/gastos");
  revalidatePath(`/gastos/${gastoId}`);
  return {};
}

export async function restaurar(gastoId: string, _p: { error?: string }): Promise<{ error?: string }> {
  const s = await requerirSesion(ROLES_GASTOS);
  await comprobarAcceso(s, gastoId);
  try {
    await restaurarGasto(db(), s, gastoId);
  } catch (e) {
    if (e instanceof ErrorGasto) return { error: e.message };
    throw e;
  }
  revalidatePath("/gastos");
  revalidatePath(`/gastos/${gastoId}`);
  return {};
}
