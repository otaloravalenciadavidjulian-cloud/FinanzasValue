import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_FACTURACION } from "@/lib/auth/sesion";
import { cargarFacturaPDF } from "@/lib/facturacion/documento";
import { ErrorFacturae, facturaeXML } from "@/lib/facturacion/facturae";

export const dynamic = "force-dynamic";

/** Factura electrónica Facturae 3.2.2 sin firmar. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("No encontrada", { status: 404 });
  const s = await requerirSesion(ROLES_FACTURACION);
  const datos = await enEmpresa(db(), s.empresaId, async (tx) => {
    const d = await cargarFacturaPDF(tx, id);
    if (d) {
      await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id)
        VALUES (${s.empresaId}, ${s.usuarioId}, 'descargar_facturae', 'factura', ${id})`;
    }
    return d;
  });
  if (!datos) return new Response("No encontrada", { status: 404 });
  try {
    return new Response(facturaeXML(datos), {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="facturae-${datos.numSerie}.xml"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof ErrorFacturae) return new Response(`No se puede generar la Facturae: ${e.message}`, { status: 422, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    throw e;
  }
}
