import Link from "next/link";
import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion } from "@/lib/auth/sesion";
import { formatearEuros } from "@/lib/fiscal/dinero";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const { empresaId } = await requerirSesion();
  const [r] = await enEmpresa(db(), empresaId, (tx) => tx<{ n: number; base: string; iva: string; total: string }[]>`
    SELECT count(*)::int AS n, coalesce(sum(base_cent),0) AS base, coalesce(sum(cuota_iva_cent),0) AS iva, coalesce(sum(total_cent),0) AS total
    FROM facturas WHERE NOT anulada AND date_trunc('month', fecha_expedicion) = date_trunc('month', current_date)`);
  return (
    <>
      <h1>Dashboard</h1>
      <div className="grid">
        <div className="panel"><div className="muted">Facturas del mes</div><b>{r.n}</b></div>
        <div className="panel"><div className="muted">Base imponible</div><b>{formatearEuros(Number(r.base))}</b></div>
        <div className="panel"><div className="muted">IVA repercutido</div><b>{formatearEuros(Number(r.iva))}</b></div>
        <div className="panel"><div className="muted">Total facturado</div><b>{formatearEuros(Number(r.total))}</b></div>
      </div>
      <p className="muted">El dashboard completo llega en la fase 3. <Link href="/facturas/nueva">Emitir una factura</Link>.</p>
    </>
  );
}
