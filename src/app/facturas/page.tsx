import Link from "next/link";
import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion } from "@/lib/auth/sesion";
import { ETIQUETA_COBRO, estadoCobro, hoyMadrid } from "@/lib/cobros/estado";
import { formatearEuros } from "@/lib/fiscal/dinero";

export const dynamic = "force-dynamic";

export default async function Facturas() {
  const filas = await enEmpresa(db(), (await requerirSesion()).empresaId, (tx) => tx<{
    id: string; num_serie: string; fecha: string; cliente: string | null; base_cent: string; cuota_iva_cent: string; total_cent: string; anulada: boolean; cobrado: string; venc: string | null;
  }[]>`
    SELECT f.id, f.num_serie, to_char(f.fecha_expedicion, 'DD/MM/YYYY') AS fecha, f.destinatario->>'razon_social' AS cliente,
           f.base_cent, f.cuota_iva_cent, f.total_cent, f.anulada, to_char(f.vencimiento,'YYYY-MM-DD') AS venc,
           coalesce((SELECT sum(c.importe_cent) FROM cobros c WHERE c.factura_id = f.id), 0) AS cobrado
    FROM facturas f ORDER BY f.fecha_expedicion DESC, f.num_serie DESC LIMIT 200`);
  const hoy = hoyMadrid();
  const conEstado = filas.map((f) => ({ ...f, estado: estadoCobro({ totalCent: Number(f.total_cent), cobradoCent: Number(f.cobrado), vencimiento: f.venc, hoy, anulada: f.anulada }) }));
  const pendiente = conEstado.filter((f) => !f.anulada).reduce((a, f) => a + Number(f.total_cent) - Number(f.cobrado), 0);
  const vencido = conEstado.filter((f) => f.estado === "vencida").reduce((a, f) => a + Number(f.total_cent) - Number(f.cobrado), 0);
  return (
    <>
      <h1>Ingresos y facturación</h1>
      <p className="muted">Pendiente de cobro: <b>{formatearEuros(pendiente)}</b>{vencido ? <> · vencido: <b style={{ color: "var(--bad)" }}>{formatearEuros(vencido)}</b></> : null}</p>
      <p><Link className="btn" href="/facturas/nueva">Nueva factura</Link></p>
      <div className="panel">
        <table>
          <thead><tr><th>Número</th><th>Fecha</th><th>Cliente</th><th className="num">Base</th><th className="num">IVA</th><th className="num">Total</th><th className="num">Pendiente</th><th>Estado</th></tr></thead>
          <tbody>
            {conEstado.map((f) => (
              <tr key={f.id}>
                <td className="mono"><Link href={`/facturas/${f.id}`}>{f.num_serie}</Link></td>
                <td>{f.fecha}</td><td>{f.cliente ?? "Simplificada"}</td>
                <td className="num">{formatearEuros(Number(f.base_cent))}</td>
                <td className="num">{formatearEuros(Number(f.cuota_iva_cent))}</td>
                <td className="num">{formatearEuros(Number(f.total_cent))}</td>
                <td className="num">{f.anulada ? "—" : formatearEuros(Number(f.total_cent) - Number(f.cobrado))}</td>
                <td><span className={`estado estado-${f.estado}`}>{ETIQUETA_COBRO[f.estado]}</span></td>
              </tr>
            ))}
            {!filas.length && <tr><td colSpan={8} className="muted">Todavía no hay facturas.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
