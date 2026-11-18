import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion } from "@/lib/auth/sesion";
import { leerDocumento } from "@/lib/documentos/almacen";

export const dynamic = "force-dynamic";

/** Descarga un justificante tras comprobar que su contenido coincide con la huella guardada. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("No encontrado", { status: 404 });
  const s = await requerirSesion();
  const d = await enEmpresa(db(), s.empresaId, async (tx) => {
    const doc = await leerDocumento(tx, id);
    if (!doc) return null;
    if (s.rol === "empleado") {
      const [propio] = doc.entidad_id
        ? await tx`SELECT 1 FROM gastos WHERE id = ${doc.entidad_id} AND creado_por = ${s.usuarioId}`
        : doc.subido_por === s.usuarioId ? [1] : [];
      if (!propio) return null;
    }
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
      VALUES (${s.empresaId}, ${s.usuarioId}, 'descargar_justificante', 'documento', ${id}, ${tx.json({ integro: doc.integro })})`;
    return doc;
  });
  if (!d) return new Response("No encontrado", { status: 404 });
  if (!d.integro) return new Response("El archivo guardado no coincide con su huella SHA-256: no se entrega. Avisa al administrador.", { status: 409 });
  const nombre = encodeURIComponent(d.nombre);
  return new Response(new Uint8Array(d.contenido), {
    headers: {
      "Content-Type": d.mime,
      "Content-Disposition": `inline; filename="justificante"; filename*=UTF-8''${nombre}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
