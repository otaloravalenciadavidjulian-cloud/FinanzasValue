import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_FACTURACION } from "@/lib/auth/sesion";
import { formatearEuros } from "@/lib/fiscal/dinero";
import { alternarProyecto } from "./acciones";
import { FormularioProyecto } from "./formulario";

export const dynamic = "force-dynamic";

export default async function Proyectos() {
  const s = await requerirSesion(ROLES_FACTURACION);
  const { proyectos, clientes } = await enEmpresa(db(), s.empresaId, async (tx) => ({
    proyectos: await tx<{ id: string; nombre: string; activo: boolean; cliente: string | null; ingresos: string; gastos: string }[]>`
      SELECT p.id, p.nombre, p.activo, t.razon_social AS cliente,
        coalesce((SELECT sum(base_cent) FROM facturas f WHERE f.proyecto_id = p.id AND NOT f.anulada), 0) AS ingresos,
        coalesce((SELECT sum(base_cent + cuota_iva_cent - cuota_deducible_cent) FROM gastos g WHERE g.proyecto_id = p.id AND g.borrado_en IS NULL), 0) AS gastos
      FROM proyectos p LEFT JOIN terceros t ON t.id = p.cliente_id ORDER BY p.activo DESC, p.nombre`,
    clientes: await tx<{ id: string; razon_social: string }[]>`SELECT id, razon_social FROM terceros WHERE es_cliente AND borrado_en IS NULL ORDER BY razon_social`,
  }));
  return (
    <>
      <h1>Proyectos</h1>
      <p className="muted" style={{ marginTop: -8 }}>Asigna facturas y gastos a un proyecto para ver si es rentable. Las cifras son sin IVA (el IVA no deducible cuenta como coste).</p>
      <FormularioProyecto clientes={clientes} />
      <div className="panel">
        <table>
          <thead><tr><th>Proyecto</th><th>Cliente</th><th className="num">Ingresos</th><th className="num">Costes</th><th className="num">Margen</th><th></th></tr></thead>
          <tbody>
            {proyectos.map((p) => {
              const margen = Number(p.ingresos) - Number(p.gastos);
              return (
                <tr key={p.id} style={p.activo ? undefined : { opacity: 0.6 }}>
                  <td>{p.nombre}{!p.activo && " (cerrado)"}</td><td>{p.cliente ?? "—"}</td>
                  <td className="num">{formatearEuros(Number(p.ingresos))}</td><td className="num">{formatearEuros(Number(p.gastos))}</td>
                  <td className="num" style={{ color: margen < 0 ? "var(--bad)" : undefined }}><b>{formatearEuros(margen)}</b></td>
                  <td><form action={alternarProyecto.bind(null, p.id, !p.activo)}><button className="btn btn-sec" style={{ padding: "2px 8px", fontSize: 12 }}>{p.activo ? "Cerrar" : "Reabrir"}</button></form></td>
                </tr>
              );
            })}
            {!proyectos.length && <tr><td colSpan={6} className="muted">Todavía no hay proyectos.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
