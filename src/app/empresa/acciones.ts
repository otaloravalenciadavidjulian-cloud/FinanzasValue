"use server";
import { revalidatePath } from "next/cache";
import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_ADMINISTRACION, ROLES_EMPRESA_EDICION } from "@/lib/auth/sesion";
import { borrarFacturasDePrueba, ErrorBorradoPruebas } from "@/lib/facturacion/pruebas";
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
      provincia: g("provincia"), email: g("email"), telefono: g("telefono"), iban: g("iban"), banco: g("banco"), textoPie: g("textoPie"), web: g("web"), bic: g("bic"),
      titularCuenta: g("titularCuenta"), agradecimiento: g("agradecimiento"), datosRegistrales: g("datosRegistrales"),
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

export async function borrarPruebas(_p: Estado, f: FormData): Promise<Estado> {
  const s = await requerirSesion(ROLES_ADMINISTRACION);
  if (String(f.get("confirmacion") ?? "").trim().toUpperCase() !== "BORRAR") return { error: "Escribe BORRAR para confirmar." };
  try {
    const r = await borrarFacturasDePrueba(db(), s);
    revalidatePath("/", "layout");
    return { ok: r.facturas ? `Borradas ${r.facturas} factura${r.facturas === 1 ? "" : "s"} de prueba. La numeración vuelve a empezar en 1.` : "No había facturas que borrar." };
  } catch (e) {
    if (e instanceof ErrorBorradoPruebas) return { error: e.message };
    throw e;
  }
}

export async function cambiarVerifactu(_p: Estado, f: FormData): Promise<Estado> {
  const s = await requerirSesion(ROLES_ADMINISTRACION);
  const activo = f.get("activo") === "1";
  await enEmpresa(db(), s.empresaId, async (tx) => {
    await tx`UPDATE empresas SET verifactu_activo = ${activo} WHERE id = ${s.empresaId}`;
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
      VALUES (${s.empresaId}, ${s.usuarioId}, 'cambiar_verifactu', 'empresa', ${s.empresaId}, ${tx.json({ activo })})`;
  });
  revalidatePath("/", "layout");
  return { ok: activo ? "VERI*FACTU activado: las próximas facturas llevarán el QR tributario y la leyenda." : "VERI*FACTU desactivado: las próximas facturas saldrán sin QR ni leyenda." };
}
