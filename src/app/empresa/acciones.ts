"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db/cliente";
import { requerirSesion, ROLES_EMPRESA_EDICION } from "@/lib/auth/sesion";
import { ErrorDocumento } from "@/lib/documentos/almacen";
import { cambiarLogotipo, editarEmpresa, ErrorEmpresa } from "@/lib/empresas/datos";

type Estado = { error?: string; ok?: string };

async function intentar(fn: () => Promise<string>): Promise<Estado> {
  try {
    const ok = await fn();
    revalidatePath("/empresa");
    return { ok };
  } catch (e) {
    if (e instanceof ErrorEmpresa || e instanceof ErrorDocumento) return { error: e.message };
    throw e;
  }
}

export async function guardarDatos(_p: Estado, f: FormData): Promise<Estado> {
  const s = await requerirSesion(ROLES_EMPRESA_EDICION);
  const g = (k: string) => String(f.get(k) ?? "");
  return intentar(async () => {
    const n = await editarEmpresa(db(), s, {
      nombreComercial: g("nombreComercial"), domicilio: g("domicilio"), codigoPostal: g("codigoPostal"), municipio: g("municipio"),
      provincia: g("provincia"), email: g("email"), telefono: g("telefono"), iban: g("iban"), datosRegistrales: g("datosRegistrales"),
    });
    return n ? "Datos guardados. Las facturas ya emitidas conservan los datos con los que se emitieron." : "No había cambios.";
  });
}

export async function subirLogotipo(_p: Estado, f: FormData): Promise<Estado> {
  const s = await requerirSesion(ROLES_EMPRESA_EDICION);
  const archivo = f.get("logo");
  const quitar = f.get("quitar") === "1";
  return intentar(async () => {
    if (quitar) { await cambiarLogotipo(db(), s, null); return "Logotipo quitado de las próximas facturas."; }
    if (!(archivo instanceof File) || archivo.size === 0) throw new ErrorEmpresa("Elige una imagen");
    await cambiarLogotipo(db(), s, { nombre: archivo.name, bytes: new Uint8Array(await archivo.arrayBuffer()) });
    return "Logotipo guardado. Aparecerá en las facturas que emitas a partir de ahora.";
  });
}
