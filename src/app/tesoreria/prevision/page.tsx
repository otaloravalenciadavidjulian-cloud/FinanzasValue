import Link from "next/link";
import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_FACTURACION } from "@/lib/auth/sesion";
import { hoyMadrid } from "@/lib/cobros/estado";
import { formatearEuros } from "@/lib/fiscal/dinero";
import { cargarPrevision } from "@/lib/tesoreria/prevision";
import { GraficoPrevision, TablaPrevision } from "../grafico-prevision";

export const dynamic = "force-dynamic";

export default async function PrevisionTesoreria() {
  const s = await requerirSesion(ROLES_FACTURACION);
  const p = await enEmpresa(db(), s.empresaId, (tx) => cargarPrevision(tx, hoyMadrid()));
  const fecha = (iso: string) => iso.split("-").reverse().join("/");
  return (
    <>
      <h1>Previsión de tesorería</h1>
      <p className="muted">Próximas 13 semanas, desde el saldo en bancos y los vencimientos de facturas y gastos pendientes. <Link href="/tesoreria">Volver a tesorería</Link></p>
      {p.primeraSemanaNegativa && (
        <div className="error">⚠ Saldo previsto negativo en la semana del {fecha(p.primeraSemanaNegativa.desde)}: {formatearEuros(p.primeraSemanaNegativa.saldoFinalCent)}.</div>
      )}
      <div className="grid" style={{ margin: "12px 0" }}>
        <div className="panel"><div className="muted">Saldo en bancos hoy</div><b>{formatearEuros(p.saldoInicialCent)}</b></div>
        <div className="panel"><div className="muted">Saldo previsto en 13 semanas</div><b>{formatearEuros(p.semanas.at(-1)?.saldoFinalCent ?? p.saldoInicialCent)}</b></div>
        <div className="panel"><div className="muted">Saldo mínimo previsto</div><b>{formatearEuros(p.saldoMinimoCent)}</b></div>
        <div className="panel"><div className="muted">Cobros vencidos sin cobrar</div><b>{formatearEuros(p.cobrosVencidosCent)}</b></div>
        <div className="panel"><div className="muted">Pagos vencidos sin pagar</div><b>{formatearEuros(p.pagosVencidosCent)}</b></div>
      </div>
      <div className="panel">
        <b>Saldo previsto al final de cada semana</b>
        <GraficoPrevision p={p} />
      </div>
      <div className="panel">
        <TablaPrevision p={p} />
        <p className="muted" style={{ fontSize: 12 }}>
          Sin vencimiento, se usan los días de pago del cliente o proveedor desde la fecha de la factura.
          {p.recurrenteMensualCent > 0
            ? ` Los pagos recurrentes sin factura (nóminas, Seguridad Social, préstamos, impuestos) se estiman en ${formatearEuros(p.recurrenteMensualCent)} al mes, la media de los últimos 90 días conciliados.`
            : " Los pagos recurrentes sin factura (nóminas, Seguridad Social, préstamos, impuestos) se estimarán cuando concilies movimientos de esos tipos."}
          {p.impuestos.length > 0
            ? ` Incluye los impuestos estimados con lo registrado hasta hoy: ${p.impuestos.map((i) => `${i.concepto} ${formatearEuros(i.importeCent)} el ${fecha(i.fecha)}`).join("; ")}.`
            : " No hay impuestos trimestrales a pagar dentro de estas 13 semanas según lo registrado."}
        </p>
      </div>
    </>
  );
}
