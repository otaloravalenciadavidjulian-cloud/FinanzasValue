import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_FACTURACION } from "@/lib/auth/sesion";
import { cargarRegistros } from "@/lib/verifactu/registros";
import { documentoXML, ErrorXML } from "@/lib/verifactu/xml";

export const dynamic = "force-dynamic";

/** XML de los registros de facturación de una factura (alta y, si la hay, anulación). No se envía a la AEAT. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("No encontrada", { status: 404 });
  const s = await requerirSesion(ROLES_FACTURACION);
  const registros = await enEmpresa(db(), s.empresaId, async (tx) => {
    const r = await cargarRegistros(tx, { facturaId: id });
    if (r.length) {
      await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id)
        VALUES (${s.empresaId}, ${s.usuarioId}, 'descargar_xml_verifactu', 'factura', ${id})`;
    }
    return r;
  });
  if (!registros.length) return new Response("No encontrada", { status: 404 });
  try {
    const emisor = registros[0].datos.emisor;
    const xml = documentoXML(emisor, registros.map((r) => r.datos));
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="verifactu-${registros[0].datos.numSerie}.xml"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof ErrorXML) return new Response(e.message, { status: 422, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    throw e;
  }
}
