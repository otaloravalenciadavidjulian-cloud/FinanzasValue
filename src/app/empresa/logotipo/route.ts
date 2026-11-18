import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion } from "@/lib/auth/sesion";
import { contenidoLogotipo, leerEmpresa } from "@/lib/empresas/datos";

export const dynamic = "force-dynamic";

/** Logotipo actual de la empresa, para verlo en la configuración. */
export async function GET() {
  const s = await requerirSesion();
  const logo = await enEmpresa(db(), s.empresaId, async (tx) => {
    const e = await leerEmpresa(tx, s.empresaId);
    return e.logotipoId ? contenidoLogotipo(tx, e.logotipoId) : null;
  });
  if (!logo) return new Response("Sin logotipo", { status: 404 });
  return new Response(Buffer.from(logo.bytes), { headers: { "Content-Type": logo.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
