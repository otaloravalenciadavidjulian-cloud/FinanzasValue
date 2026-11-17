import Link from "next/link";
import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion } from "@/lib/auth/sesion";
import { formatearEuros } from "@/lib/fiscal/dinero";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const { empresaId } = await requerirSesion();
  const { r, gm, pc, pp } = await enEmpresa(db(), empresaId, async (tx) => {
    const [r] = await tx<{ n: number; base: string; iva: string; total: string }[]>`
      SELECT count(*)::int AS n, coalesce(sum(base_cent),0) AS base, coalesce(sum(cuota_iva_cent),0) AS iva, coalesce(sum(total_cent),0) AS total
      FROM facturas WHERE NOT anulada AND date_trunc('month', fecha_expedicion) = date_trunc('month', current_date)`;
    const [gm] = await tx<{ base: string; deducible: string }[]>`
      SELECT coalesce(sum(base_cent),0) AS base, coalesce(sum(cuota_deducible_cent),0) AS deducible
      FROM gastos WHERE borrado_en IS NULL AND date_trunc('month', fecha_expedicion) = date_trunc('month', current_date)`;
    const [pc] = await tx<{ v: string }[]>`
      SELECT coalesce(sum(f.total_cent),0) - coalesce((SELECT sum(c.importe_cent) FROM cobros c JOIN facturas f2 ON f2.id = c.factura_id WHERE NOT f2.anulada),0) AS v
      FROM facturas f WHERE NOT f.anulada`;
    const [pp] = await tx<{ v: string }[]>`
      SELECT coalesce(sum(g.total_cent),0) - coalesce((SELECT sum(p.importe_cent) FROM pagos p JOIN gastos g2 ON g2.id = p.gasto_id WHERE g2.borrado_en IS NULL),0) AS v
      FROM gastos g WHERE g.borrado_en IS NULL`;
    return { r, gm, pc, pp };
  });
  return (
    <>
      <h1>Dashboard</h1>
      <div className="grid">
        <div className="panel"><div className="muted">Facturas del mes</div><b>{r.n}</b></div>
        <div className="panel"><div className="muted">Base imponible</div><b>{formatearEuros(Number(r.base))}</b></div>
        <div className="panel"><div className="muted">IVA repercutido</div><b>{formatearEuros(Number(r.iva))}</b></div>
        <div className="panel"><div className="muted">Total facturado</div><b>{formatearEuros(Number(r.total))}</b></div>
        <div className="panel"><div className="muted">Gastos del mes (base)</div><b>{formatearEuros(Number(gm.base))}</b></div>
        <div className="panel"><div className="muted">IVA soportado deducible</div><b>{formatearEuros(Number(gm.deducible))}</b></div>
        <div className="panel"><div className="muted">Pendiente de cobro</div><b>{formatearEuros(Number(pc.v))}</b></div>
        <div className="panel"><div className="muted">Pendiente de pago</div><b>{formatearEuros(Number(pp.v))}</b></div>
      </div>
      <p className="muted">El dashboard completo llega en la fase 3. <Link href="/facturas/nueva">Emitir una factura</Link>.</p>
    </>
  );
}
