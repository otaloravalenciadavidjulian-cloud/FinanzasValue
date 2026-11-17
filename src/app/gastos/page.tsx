import Link from "next/link";
import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_GASTOS } from "@/lib/auth/sesion";
import { ETIQUETA_PAGO, estadoCobro, hoyMadrid } from "@/lib/cobros/estado";
import { formatearEuros } from "@/lib/fiscal/dinero";
import { nombreCategoria } from "@/lib/gastos/categorias";

export const dynamic = "force-dynamic";

interface Fila {
  id: string; numero: string | null; fecha: string; proveedor: string | null; categoria: string; descripcion: string;
  base_cent: string; cuota_deducible_cent: string; total_cent: string; pagado: string; venc: string | null;
  pendiente_documentacion: boolean; borrado: boolean;
}

export default async function Gastos({ searchParams }: { searchParams: Promise<{ papelera?: string }> }) {
  const s = await requerirSesion();
  const papelera = (await searchParams).papelera === "1";
  const soloPropios = s.rol === "empleado" ? s.usuarioId : null;
  const filas = await enEmpresa(db(), s.empresaId, (tx) => tx<Fila[]>`
    SELECT g.id, g.numero, to_char(g.fecha_expedicion,'DD/MM/YYYY') AS fecha, t.razon_social AS proveedor, g.categoria, g.descripcion,
           g.base_cent, g.cuota_deducible_cent, g.total_cent, to_char(g.vencimiento,'YYYY-MM-DD') AS venc, g.pendiente_documentacion,
           g.borrado_en IS NOT NULL AS borrado,
           coalesce((SELECT sum(p.importe_cent) FROM pagos p WHERE p.gasto_id = g.id), 0) AS pagado
    FROM gastos g LEFT JOIN terceros t ON t.id = g.proveedor_id
    WHERE (g.borrado_en IS NOT NULL) = ${papelera} AND (${soloPropios}::uuid IS NULL OR g.creado_por = ${soloPropios}::uuid)
    ORDER BY g.fecha_expedicion DESC, g.creado_en DESC LIMIT 300`);
  const hoy = hoyMadrid();
  const conEstado = filas.map((g) => ({ ...g, estado: estadoCobro({ totalCent: Number(g.total_cent), cobradoCent: Number(g.pagado), vencimiento: g.venc, hoy, anulada: g.borrado }) }));
  const pendiente = conEstado.filter((g) => !g.borrado).reduce((a, g) => a + Number(g.total_cent) - Number(g.pagado), 0);
  const sinDocumento = conEstado.filter((g) => g.pendiente_documentacion && !g.borrado).length;
  return (
    <>
      <h1>{papelera ? "Papelera de gastos" : "Gastos"}</h1>
      <p style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {ROLES_GASTOS.includes(s.rol) && !papelera && <Link className="btn" href="/gastos/nuevo">Nuevo gasto</Link>}
        <Link className="btn btn-sec" href={papelera ? "/gastos" : "/gastos?papelera=1"}>{papelera ? "Volver a gastos" : "Ver papelera"}</Link>
      </p>
      {!papelera && (
        <p className="muted">Pendiente de pago: <b>{formatearEuros(pendiente)}</b>
          {sinDocumento > 0 && <> · <span style={{ color: "var(--bad)" }}>{sinDocumento} {sinDocumento === 1 ? "gasto" : "gastos"} pendiente{sinDocumento === 1 ? "" : "s"} de documentación</span></>}
        </p>
      )}
      <div className="panel">
        <table>
          <thead><tr><th>Fecha</th><th>Proveedor</th><th>Número</th><th>Categoría</th><th className="num">Base</th><th className="num">IVA deducible</th><th className="num">Total</th><th>Estado</th></tr></thead>
          <tbody>
            {conEstado.map((g) => (
              <tr key={g.id}>
                <td>{g.fecha}</td>
                <td><Link href={`/gastos/${g.id}`}>{g.proveedor ?? g.descripcion}</Link></td>
                <td style={{ whiteSpace: "nowrap" }}>{g.numero ?? "—"}</td>
                <td>{nombreCategoria(g.categoria)}</td>
                <td className="num">{formatearEuros(Number(g.base_cent))}</td>
                <td className="num">{formatearEuros(Number(g.cuota_deducible_cent))}</td>
                <td className="num">{formatearEuros(Number(g.total_cent))}</td>
                <td><span className={`estado estado-${g.estado}`}>{ETIQUETA_PAGO[g.estado]}</span>{g.pendiente_documentacion && !g.borrado ? <span className="estado" title="Falta el justificante" style={{ marginLeft: 4 }}>Sin documento</span> : null}</td>
              </tr>
            ))}
            {!filas.length && <tr><td colSpan={8} className="muted">{papelera ? "La papelera está vacía." : "Todavía no hay gastos."}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
