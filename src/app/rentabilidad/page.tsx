import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_CONTABILIDAD } from "@/lib/auth/sesion";
import { hoyMadrid } from "@/lib/cobros/estado";
import { formatearEuros } from "@/lib/fiscal/dinero";
import { nombreCategoria } from "@/lib/gastos/categorias";
import { rentabilidad, type Fila } from "@/lib/rentabilidad/informe";

export const dynamic = "force-dynamic";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const pct = (p: number | null) => (p === null ? "—" : `${p.toLocaleString("es-ES")} %`);

function Tabla({ filas, titulo, columna, sinGastos }: { filas: Fila[]; titulo: string; columna: string; sinGastos?: string }) {
  return (
    <div className="panel">
      <b>{titulo}</b>
      <table>
        <thead><tr><th>{columna}</th><th className="num">Ingresos</th><th className="num">Costes</th><th className="num">Margen</th><th className="num">Margen %</th></tr></thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.clave}><td>{f.nombre}</td><td className="num">{formatearEuros(f.ingresosCent)}</td><td className="num">{formatearEuros(f.gastosCent)}</td>
              <td className="num" style={{ color: f.margenCent < 0 ? "var(--bad)" : undefined }}><b>{formatearEuros(f.margenCent)}</b></td><td className="num">{pct(f.margenPct)}</td></tr>
          ))}
          {!filas.length && <tr><td colSpan={5} className="muted">Sin datos en el periodo.</td></tr>}
        </tbody>
      </table>
      {sinGastos && <p className="muted" style={{ fontSize: 12 }}>{sinGastos}</p>}
    </div>
  );
}

export default async function Rentabilidad({ searchParams }: { searchParams: Promise<{ ejercicio?: string }> }) {
  const q = await searchParams;
  const s = await requerirSesion(ROLES_CONTABILIDAD);
  const hoy = hoyMadrid();
  const ejercicio = /^\d{4}$/.test(q.ejercicio ?? "") ? Number(q.ejercicio) : Number(hoy.slice(0, 4));
  const hasta = ejercicio === Number(hoy.slice(0, 4)) ? hoy : `${ejercicio}-12-31`;
  const r = await enEmpresa(db(), s.empresaId, (tx) => rentabilidad(tx, `${ejercicio}-01-01`, hasta));
  return (
    <>
      <h1>Rentabilidad</h1>
      <form className="panel" style={{ display: "flex", gap: 12, alignItems: "end" }}>
        <label>Ejercicio<input name="ejercicio" type="number" min={2000} max={2100} defaultValue={ejercicio} style={{ width: 100 }} /></label>
        <button className="btn btn-sec">Ver</button>
        <span className="muted" style={{ fontSize: 13 }}>Cifras sin IVA, por fecha de factura. El IVA no deducible cuenta como coste. No incluye nóminas ni pagos sin factura.</span>
      </form>
      <div className="grid">
        <div className="panel"><div className="muted">Ingresos</div><b>{formatearEuros(r.total.ingresosCent)}</b></div>
        <div className="panel"><div className="muted">Costes</div><b>{formatearEuros(r.total.gastosCent)}</b></div>
        <div className="panel"><div className="muted">Margen</div><b style={{ color: r.total.margenCent < 0 ? "var(--bad)" : undefined }}>{formatearEuros(r.total.margenCent)}</b></div>
        <div className="panel"><div className="muted">Margen sobre ingresos</div><b>{pct(r.total.margenPct)}</b></div>
      </div>
      <Tabla titulo="Por mes" columna="Mes" filas={r.porMes.map((m) => ({ ...m, nombre: `${MESES[Number(m.clave.slice(5)) - 1]} ${m.clave.slice(0, 4)}` }))} />
      <Tabla titulo="Por cliente" columna="Cliente" filas={r.porCliente}
        sinGastos="Los costes de un cliente son los gastos asignados a sus proyectos." />
      <Tabla titulo="Por proyecto" columna="Proyecto" filas={r.porProyecto} />
      <div className="panel">
        <b>Costes por categoría</b>
        <table>
          <thead><tr><th>Categoría</th><th className="num">Importe</th><th className="num">% del total</th></tr></thead>
          <tbody>
            {r.gastosPorCategoria.map((c) => <tr key={c.categoria}><td>{nombreCategoria(c.categoria)}</td><td className="num">{formatearEuros(c.gastosCent)}</td><td className="num">{pct(c.pct)}</td></tr>)}
            {!r.gastosPorCategoria.length && <tr><td colSpan={3} className="muted">Sin gastos en el periodo.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
