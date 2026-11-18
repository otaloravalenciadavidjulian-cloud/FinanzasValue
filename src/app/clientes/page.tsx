import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion } from "@/lib/auth/sesion";
import { formatearEuros } from "@/lib/fiscal/dinero";
import { FormularioCliente } from "./formulario";

export const dynamic = "force-dynamic";

export default async function Clientes() {
  const { empresaId } = await requerirSesion();
  const filas = await enEmpresa(db(), empresaId, (tx) => tx<{ id: string; razon_social: string; nif: string; email: string | null; dias_pago: number; facturado: string }[]>`
    SELECT t.id, t.razon_social, t.nif, t.email, t.dias_pago, coalesce(sum(f.total_cent) FILTER (WHERE NOT f.anulada), 0) AS facturado
    FROM terceros t LEFT JOIN facturas f ON f.cliente_id = t.id
    WHERE t.es_cliente AND t.borrado_en IS NULL GROUP BY t.id ORDER BY t.razon_social`);
  return (
    <>
      <h1>Clientes</h1>
      <FormularioCliente />
      <div className="panel">
        <table>
          <thead><tr><th>Razón social</th><th>NIF</th><th>Email</th><th>Pago</th><th className="num">Facturado</th></tr></thead>
          <tbody>
            {filas.map((c) => <tr key={c.id}><td>{c.razon_social}</td><td className="mono">{c.nif}</td><td>{c.email ?? "—"}</td><td>{c.dias_pago} días</td><td className="num">{formatearEuros(Number(c.facturado))}</td></tr>)}
            {!filas.length && <tr><td colSpan={5} className="muted">Todavía no hay clientes.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
