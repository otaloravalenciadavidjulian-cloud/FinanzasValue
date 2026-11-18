import Link from "next/link";
import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_CONTABILIDAD } from "@/lib/auth/sesion";
import { hoyMadrid } from "@/lib/cobros/estado";
import { CUENTAS, generarAsientos, perdidasYGanancias, sumasYSaldos } from "@/lib/contabilidad/asientos";
import { formatearEuros } from "@/lib/fiscal/dinero";

export const dynamic = "force-dynamic";

const fecha = (iso: string) => iso.split("-").reverse().join("/");
const e = (c: number) => (c ? formatearEuros(c) : "");

export default async function Contabilidad({ searchParams }: { searchParams: Promise<{ ejercicio?: string; mes?: string; vista?: string; cuenta?: string }> }) {
  const q = await searchParams;
  const s = await requerirSesion(ROLES_CONTABILIDAD);
  const hoy = hoyMadrid();
  const ejercicio = /^\d{4}$/.test(q.ejercicio ?? "") ? Number(q.ejercicio) : Number(hoy.slice(0, 4));
  const mes = /^(0?[1-9]|1[0-2])$/.test(q.mes ?? "") ? Number(q.mes) : null;
  const vista = ["diario", "sumas", "pyg", "mayor"].includes(q.vista ?? "") ? q.vista! : "pyg";
  const cuenta = q.cuenta && /^\d{3,4}$/.test(q.cuenta) ? q.cuenta : null;
  const desde = mes ? `${ejercicio}-${String(mes).padStart(2, "0")}-01` : `${ejercicio}-01-01`;
  const hasta = mes ? new Date(Date.UTC(ejercicio, mes, 0)).toISOString().slice(0, 10) : `${ejercicio}-12-31`;
  const asientos = await enEmpresa(db(), s.empresaId, (tx) => generarAsientos(tx, desde, hasta));
  const saldos = sumasYSaldos(asientos);
  const pyg = perdidasYGanancias(saldos);
  const params = (extra: Record<string, string>) => new URLSearchParams({ ejercicio: String(ejercicio), ...(mes ? { mes: String(mes) } : {}), vista, ...extra }).toString();
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const pestanas: [string, string][] = [["pyg", "Pérdidas y ganancias"], ["sumas", "Sumas y saldos"], ["diario", "Libro diario"], ["mayor", "Libro mayor"]];
  const mayor = cuenta ? asientos.flatMap((a, i) => a.apuntes.filter((p) => p.cuenta === cuenta).map((p) => ({ ...p, fecha: a.fecha, n: i + 1 }))) : [];
  let acumulado = 0;
  return (
    <>
      <h1>Contabilidad</h1>
      <p className="muted" style={{ marginTop: -8 }}>Asientos del Plan General Contable generados automáticamente desde facturas, gastos, cobros, pagos y movimientos del banco conciliados.</p>
      <form className="panel" style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
        <input type="hidden" name="vista" value={vista} />
        {cuenta && <input type="hidden" name="cuenta" value={cuenta} />}
        <label>Ejercicio<input name="ejercicio" type="number" min={2000} max={2100} defaultValue={ejercicio} style={{ width: 100 }} /></label>
        <label>Periodo<select name="mes" defaultValue={mes ?? ""}><option value="">Todo el año</option>{meses.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
        <button className="btn btn-sec">Ver</button>
        <a className="btn btn-sec" href={`/contabilidad/diario.csv?desde=${desde}&hasta=${hasta}`}>Descargar diario (CSV)</a>
      </form>
      <nav style={{ display: "flex", gap: 16, margin: "8px 0 12px", flexWrap: "wrap" }}>
        {pestanas.map(([k, t]) => k === vista ? <b key={k}>{t}</b> : <Link key={k} href={`/contabilidad?${params({ vista: k })}`}>{t}</Link>)}
      </nav>

      {vista === "pyg" && (
        <div className="panel">
          <table>
            <tbody>
              <tr><td colSpan={2}><b>Ingresos</b></td><td className="num"><b>{formatearEuros(pyg.totalIngresosCent)}</b></td></tr>
              {pyg.ingresos.map((s) => <tr key={s.cuenta}><td className="mono">{s.cuenta}</td><td>{s.nombre}</td><td className="num">{formatearEuros(s.importeCent)}</td></tr>)}
              <tr><td colSpan={2}><b>Gastos</b></td><td className="num"><b>{formatearEuros(-pyg.totalGastosCent)}</b></td></tr>
              {pyg.gastos.map((s) => <tr key={s.cuenta}><td className="mono">{s.cuenta}</td><td>{s.nombre}</td><td className="num">{formatearEuros(-s.importeCent)}</td></tr>)}
              <tr><td colSpan={2}><b>Resultado antes de impuestos</b></td>
                <td className="num" style={{ color: pyg.resultadoCent < 0 ? "var(--bad)" : undefined }}><b>{formatearEuros(pyg.resultadoCent)}</b></td></tr>
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 12 }}>Sin amortizaciones, nóminas detalladas ni periodificaciones: es el resultado según lo registrado en Value.</p>
        </div>
      )}

      {vista === "sumas" && (
        <div className="panel">
          <table>
            <thead><tr><th>Cuenta</th><th>Nombre</th><th className="num">Debe</th><th className="num">Haber</th><th className="num">Saldo deudor</th><th className="num">Saldo acreedor</th></tr></thead>
            <tbody>{saldos.map((s) => (
              <tr key={s.cuenta}><td className="mono"><Link href={`/contabilidad?${params({ vista: "mayor", cuenta: s.cuenta })}`}>{s.cuenta}</Link></td><td>{s.nombre}</td>
                <td className="num">{e(s.debeCent)}</td><td className="num">{e(s.haberCent)}</td>
                <td className="num">{s.saldoCent > 0 ? formatearEuros(s.saldoCent) : ""}</td><td className="num">{s.saldoCent < 0 ? formatearEuros(-s.saldoCent) : ""}</td></tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={2}><b>Totales</b></td>
              <td className="num"><b>{formatearEuros(saldos.reduce((x, s) => x + s.debeCent, 0))}</b></td>
              <td className="num"><b>{formatearEuros(saldos.reduce((x, s) => x + s.haberCent, 0))}</b></td><td colSpan={2}></td></tr></tfoot>
          </table>
        </div>
      )}

      {vista === "diario" && (
        <div className="panel">
          <table>
            <thead><tr><th>Nº</th><th>Fecha</th><th>Cuenta</th><th>Concepto</th><th className="num">Debe</th><th className="num">Haber</th></tr></thead>
            <tbody>{asientos.map((a, i) => a.apuntes.map((p, j) => (
              <tr key={`${i}-${j}`} style={j === 0 ? { borderTop: "2px solid var(--line)" } : undefined}>
                <td>{j === 0 ? i + 1 : ""}</td><td>{j === 0 ? fecha(a.fecha) : ""}</td>
                <td className="mono" title={CUENTAS[p.cuenta]}>{p.cuenta}</td><td>{j === 0 ? a.concepto : <span className="muted">{CUENTAS[p.cuenta]}</span>}</td>
                <td className="num">{e(p.debeCent)}</td><td className="num">{e(p.haberCent)}</td>
              </tr>
            )))}
            {!asientos.length && <tr><td colSpan={6} className="muted">No hay asientos en el periodo.</td></tr>}</tbody>
          </table>
        </div>
      )}

      {vista === "mayor" && (
        <div className="panel">
          <form style={{ display: "flex", gap: 8, alignItems: "end", marginBottom: 10 }}>
            <input type="hidden" name="vista" value="mayor" /><input type="hidden" name="ejercicio" value={ejercicio} />
            {mes && <input type="hidden" name="mes" value={mes} />}
            <label>Cuenta<select name="cuenta" defaultValue={cuenta ?? ""}><option value="">— Elige —</option>
              {saldos.map((s) => <option key={s.cuenta} value={s.cuenta}>{s.cuenta} · {s.nombre}</option>)}</select></label>
            <button className="btn btn-sec">Ver</button>
          </form>
          {cuenta && (
            <table>
              <thead><tr><th>Asiento</th><th>Fecha</th><th>Concepto</th><th className="num">Debe</th><th className="num">Haber</th><th className="num">Saldo</th></tr></thead>
              <tbody>{mayor.map((m, i) => {
                acumulado += m.debeCent - m.haberCent;
                return <tr key={i}><td>{m.n}</td><td>{fecha(m.fecha)}</td><td>{m.concepto}</td><td className="num">{e(m.debeCent)}</td><td className="num">{e(m.haberCent)}</td><td className="num">{formatearEuros(acumulado)}</td></tr>;
              })}</tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
