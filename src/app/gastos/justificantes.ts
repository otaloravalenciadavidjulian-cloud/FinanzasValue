"use server";
import { revalidatePath } from "next/cache";
import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_GASTOS, type Sesion } from "@/lib/auth/sesion";
import { adjuntarAGasto, documentoAPapelera, ErrorDocumento, guardarLectura, subirBorrador, type Archivo } from "@/lib/documentos/almacen";
import { leerJustificante, valoresFormulario } from "@/lib/documentos/lectura";

export interface ResultadoLectura {
  error?: string;
  documentoId?: string;
  nombre?: string;
  /** Valores para rellenar el formulario del gasto (mismos nombres de campo). */
  valores?: Record<string, string>;
  /** Proveedor leído que aún no está dado de alta. */
  proveedorNuevo?: { nif: string; nombre: string };
  avisos?: string[];
  origen?: string[];
}

async function archivoDe(f: FormData): Promise<Archivo> {
  const a = f.get("archivo");
  if (!(a instanceof File) || a.size === 0) throw new ErrorDocumento("Elige un archivo");
  return { nombre: a.name, bytes: new Uint8Array(await a.arrayBuffer()) };
}

/** Sube el justificante como borrador y propone los datos del gasto. No guarda el gasto. */
export async function leerArchivo(_p: ResultadoLectura, f: FormData): Promise<ResultadoLectura> {
  const s = await requerirSesion(ROLES_GASTOS);
  let archivo: Archivo;
  let doc: Awaited<ReturnType<typeof subirBorrador>>;
  try {
    archivo = await archivoDe(f);
    doc = await subirBorrador(db(), s, archivo);
  } catch (e) {
    if (e instanceof ErrorDocumento) return { error: e.message };
    throw e;
  }
  const lectura = await leerJustificante(archivo.bytes, doc.mime);
  await guardarLectura(db(), s, doc.id, lectura);
  const proveedores = await enEmpresa(db(), s.empresaId, (tx) => tx<{ id: string; nif: string }[]>`
    SELECT id, nif FROM terceros WHERE es_proveedor AND borrado_en IS NULL`);
  const valores = valoresFormulario(lectura, proveedores);
  const proveedorNuevo = lectura.proveedorNif && !valores.proveedor
    ? { nif: lectura.proveedorNif, nombre: lectura.proveedorNombre ?? "" } : undefined;
  return { documentoId: doc.id, nombre: archivo.nombre, valores, proveedorNuevo, avisos: lectura.avisos, origen: lectura.origen };
}

/** El empleado solo puede tocar los justificantes de sus propios gastos. */
async function comprobarGasto(s: Sesion, gastoId: string) {
  if (s.rol !== "empleado") return;
  const [g] = await enEmpresa(db(), s.empresaId, (tx) => tx`SELECT 1 FROM gastos WHERE id = ${gastoId} AND creado_por = ${s.usuarioId}`);
  if (!g) throw new Error("No tienes permiso para esta acción");
}

export async function adjuntar(gastoId: string, _p: { error?: string; ok?: string }, f: FormData): Promise<{ error?: string; ok?: string }> {
  const s = await requerirSesion(ROLES_GASTOS);
  await comprobarGasto(s, gastoId);
  try {
    await adjuntarAGasto(db(), s, gastoId, await archivoDe(f));
  } catch (e) {
    if (e instanceof ErrorDocumento) return { error: e.message };
    throw e;
  }
  revalidatePath(`/gastos/${gastoId}`);
  revalidatePath("/gastos");
  return { ok: "Justificante adjuntado." };
}

export async function justificanteAPapelera(gastoId: string, documentoId: string, _p: { error?: string }, f: FormData): Promise<{ error?: string }> {
  const s = await requerirSesion(ROLES_GASTOS);
  await comprobarGasto(s, gastoId);
  try {
    const [d] = await enEmpresa(db(), s.empresaId, (tx) => tx`SELECT 1 FROM documentos WHERE id = ${documentoId} AND entidad_id = ${gastoId}`);
    if (!d) throw new ErrorDocumento("Documento no encontrado");
    await documentoAPapelera(db(), s, documentoId, String(f.get("motivo") ?? ""));
  } catch (e) {
    if (e instanceof ErrorDocumento) return { error: e.message };
    throw e;
  }
  revalidatePath(`/gastos/${gastoId}`);
  revalidatePath("/gastos");
  return {};
}
