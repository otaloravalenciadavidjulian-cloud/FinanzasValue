"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db/cliente";
import { requerirSesion, ROLES_FACTURACION } from "@/lib/auth/sesion";
import { altaCuenta, ErrorTesoreria, importarExtracto } from "@/lib/tesoreria/cuentas";

export type EstadoTesoreria = { error?: string; ok?: string; valores?: Record<string, string> };

export async function crearCuenta(_p: EstadoTesoreria, f: FormData): Promise<EstadoTesoreria> {
  const s = await requerirSesion(ROLES_FACTURACION);
  const valores = { nombre: String(f.get("nombre") ?? ""), iban: String(f.get("iban") ?? "") };
  try {
    await altaCuenta(db(), s, valores);
  } catch (e) {
    if (e instanceof ErrorTesoreria) return { error: e.message, valores };
    throw e;
  }
  revalidatePath("/tesoreria");
  return { ok: "Cuenta creada. Ya puedes importar su extracto." };
}

export async function importar(_p: EstadoTesoreria, f: FormData): Promise<EstadoTesoreria> {
  const s = await requerirSesion(ROLES_FACTURACION);
  const cuentaId = String(f.get("cuenta") ?? "");
  const archivo = f.get("archivo");
  if (!/^[0-9a-f-]{36}$/.test(cuentaId)) return { error: "Elige la cuenta" };
  if (!(archivo instanceof File) || archivo.size === 0) return { error: "Elige el fichero del extracto", valores: { cuenta: cuentaId } };
  try {
    const r = await importarExtracto(db(), s, cuentaId, { nombre: archivo.name, bytes: new Uint8Array(await archivo.arrayBuffer()) });
    revalidatePath("/tesoreria");
    const fecha = (iso: string) => iso.split("-").reverse().join("/");
    return {
      ok: `Importados ${r.nuevos} movimientos del ${fecha(r.desde)} al ${fecha(r.hasta)}` +
        (r.repetidos ? ` (${r.repetidos} ya estaban y se han ignorado)` : "") + ".",
      valores: { cuenta: cuentaId },
    };
  } catch (e) {
    if (e instanceof ErrorTesoreria) return { error: e.message, valores: { cuenta: cuentaId } };
    throw e;
  }
}
