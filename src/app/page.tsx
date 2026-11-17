import Link from "next/link";
import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_FACTURACION } from "@/lib/auth/sesion";
import { hoyMadrid } from "@/lib/cobros/estado";
import { cargarPrevision } from "@/lib/tesoreria/prevision";
import { GraficoPrevision } from "./tesoreria/grafico-prevision";
import { formatearEuros } from "@/lib/fiscal/dinero";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const { empresaId, rol } = await requerirSesion();
  const verTesoreria = ROLES_FACTURACION.includes(rol);
  const { r, gm, pc, pp, prev, avisos } = await enEmpresa(db(), empresaId, async (tx) => {
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
    const prev = verTesoreria ? await cargarPrevision(tx, hoyMadrid()) : null;
    const [avisos] = await tx<{ por_conciliar: number; sin_justificante: number }[]>`
      SELECT (SELECT count(*)::int FROM movimientos_bancarios m
              WHERE NOT EXISTS (SELECT 1 FROM conciliaciones k WHERE k.movimiento_id = m.id AND k.deshecha_en IS NULL)) AS por_conciliar,
             (SELECT count(*)::int FROM gastos WHERE borrado_en IS NULL AND pendiente_documentacion) AS sin_justificante`;
    return { r, gm, pc, pp, prev, avisos };
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
      {prev && (
        <>
          <h2 style={{ fontSize: 18, margin: "24px 0 8px" }}>Tesorería</h2>
          {prev.primeraSemanaNegativa && (
            <div className="error">⚠ Saldo previsto negativo en la semana del {prev.primeraSemanaNegativa.desde.split("-").reverse().join("/")}. <Link href="/tesoreria/prevision">Ver previsión</Link></div>
          )}
          <div className="grid" style={{ marginTop: 8 }}>
            <div className="panel"><div className="muted">Saldo en bancos</div><b>{formatearEuros(prev.saldoInicialCent)}</b></div>
            <div className="panel"><div className="muted">Previsto en 4 semanas</div><b>{formatearEuros(prev.semanas[3]?.saldoFinalCent ?? prev.saldoInicialCent)}</b></div>
            <div className="panel"><div className="muted">Cobros vencidos</div><b>{formatearEuros(prev.cobrosVencidosCent)}</b></div>
            <div className="panel"><div className="muted">Pagos vencidos</div><b>{formatearEuros(prev.pagosVencidosCent)}</b></div>
          </div>
          <div className="panel">
            <b>Saldo previsto (13 semanas)</b> · <Link href="/tesoreria/prevision">detalle por semanas</Link>
            <GraficoPrevision p={prev} />
          </div>
        </>
      )}
      {((avisos.por_conciliar > 0 && verTesoreria) || (avisos.sin_justificante > 0 && rol !== "empleado")) && (
        <div className="aviso" style={{ marginTop: 12 }}>
          {avisos.por_conciliar > 0 && verTesoreria && <div><Link href="/tesoreria/conciliar">{avisos.por_conciliar} {avisos.por_conciliar === 1 ? "movimiento" : "movimientos"} del banco por conciliar</Link></div>}
          {avisos.sin_justificante > 0 && rol !== "empleado" && <div><Link href="/gastos">{avisos.sin_justificante} {avisos.sin_justificante === 1 ? "gasto" : "gastos"} sin justificante</Link></div>}
        </div>
      )}
    </>
  );
}
