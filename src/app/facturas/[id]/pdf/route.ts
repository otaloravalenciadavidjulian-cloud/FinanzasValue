import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion } from "@/lib/auth/sesion";
import { cargarFacturaPDF } from "@/lib/facturacion/documento";
import { generarFacturaPDF } from "@/lib/facturacion/pdf";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("No encontrada", { status: 404 });
  const s = await requerirSesion();
  const datos = await enEmpresa(db(), s.empresaId, async (tx) => {
    const d = await cargarFacturaPDF(tx, id);
    if (d) {
      await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id)
        VALUES (${s.empresaId}, ${s.usuarioId}, 'descargar_pdf', 'factura', ${id})`;
    }
    return d;
  });
  if (!datos) return new Response("No encontrada", { status: 404 });
  const pdf = await generarFacturaPDF(datos);
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="factura-${datos.numSerie}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
