import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion } from "@/lib/auth/sesion";
import { formatearEuros } from "@/lib/fiscal/dinero";
import { FormularioProveedor } from "./formulario";

export const dynamic = "force-dynamic";

export default async function Proveedores() {
  const { empresaId } = await requerirSesion();
  const filas = await enEmpresa(db(), empresaId, (tx) => tx<{ id: string; razon_social: string; nif: string; categoria: string | null; dias_pago: number; gastado: string; pendiente: string }[]>`
    SELECT t.id, t.razon_social, t.nif, t.categoria, t.dias_pago,
           coalesce(sum(g.total_cent), 0) AS gastado,
           coalesce(sum(g.total_cent - coalesce((SELECT sum(p.importe_cent) FROM pagos p WHERE p.gasto_id = g.id), 0)), 0) AS pendiente
    FROM terceros t LEFT JOIN gastos g ON g.proveedor_id = t.id AND g.borrado_en IS NULL
    WHERE t.es_proveedor AND t.borrado_en IS NULL GROUP BY t.id ORDER BY t.razon_social`);
  return (
    <>
      <h1>Proveedores</h1>
      <FormularioProveedor />
      <div className="panel">
        <table>
          <thead><tr><th>Razón social</th><th>NIF</th><th>Categoría</th><th>Pago</th><th className="num">Gastado</th><th className="num">Pendiente de pago</th></tr></thead>
          <tbody>
            {filas.map((p) => <tr key={p.id}><td>{p.razon_social}</td><td className="mono">{p.nif}</td><td>{p.categoria ?? "—"}</td><td>{p.dias_pago} días</td>
              <td className="num">{formatearEuros(Number(p.gastado))}</td><td className="num">{formatearEuros(Number(p.pendiente))}</td></tr>)}
            {!filas.length && <tr><td colSpan={6} className="muted">Todavía no hay proveedores.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
