import Link from "next/link";
import { db, enEmpresa } from "@/db/cliente";
import { empresaActualId } from "@/lib/empresa-actual";
import { formatearEuros } from "@/lib/fiscal/dinero";

export const dynamic = "force-dynamic";

export default async function Facturas() {
  const filas = await enEmpresa(db(), empresaActualId(), (tx) => tx<{
    id: string; num_serie: string; fecha: string; cliente: string | null; base_cent: string; cuota_iva_cent: string; total_cent: string; anulada: boolean;
  }[]>`
    SELECT f.id, f.num_serie, to_char(f.fecha_expedicion, 'DD/MM/YYYY') AS fecha, f.destinatario->>'razon_social' AS cliente,
           f.base_cent, f.cuota_iva_cent, f.total_cent, f.anulada
    FROM facturas f ORDER BY f.fecha_expedicion DESC, f.num_serie DESC LIMIT 200`);
  return (
    <>
      <h1>Ingresos y facturación</h1>
      <p><Link className="btn" href="/facturas/nueva">Nueva factura</Link></p>
      <div className="panel">
        <table>
          <thead><tr><th>Número</th><th>Fecha</th><th>Cliente</th><th className="num">Base</th><th className="num">IVA</th><th className="num">Total</th><th>Estado</th></tr></thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id}>
                <td className="mono"><Link href={`/facturas/${f.id}`}>{f.num_serie}</Link></td>
                <td>{f.fecha}</td><td>{f.cliente ?? "Simplificada"}</td>
                <td className="num">{formatearEuros(Number(f.base_cent))}</td>
                <td className="num">{formatearEuros(Number(f.cuota_iva_cent))}</td>
                <td className="num">{formatearEuros(Number(f.total_cent))}</td>
                <td>{f.anulada ? "Anulada" : "Emitida"}</td>
              </tr>
            ))}
            {!filas.length && <tr><td colSpan={7} className="muted">Todavía no hay facturas.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
