import Link from "next/link";
import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_CONTABILIDAD, ROLES_FACTURACION } from "@/lib/auth/sesion";
import { hoyMadrid } from "@/lib/cobros/estado";
import { formatearEuros } from "@/lib/fiscal/dinero";
import { comparar, leerPresupuesto, realPorPartida } from "@/lib/presupuestos/presupuesto";

export const dynamic = "force-dynamic";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export default async function Presupuestos({ searchParams }: { searchParams: Promise<{ ejercicio?: string; guardado?: string }> }) {
  const q = await searchParams;
  const s = await requerirSesion(ROLES_CONTABILIDAD);
  const hoy = hoyMadrid(), anio = Number(hoy.slice(0, 4));
  const ejercicio = /^\d{4}$/.test(q.ejercicio ?? "") ? Number(q.ejercicio) : anio;
  const hastaMes = ejercicio < anio ? 12 : ejercicio > anio ? 0 : Number(hoy.slice(5, 7));
  const { pres, real } = await enEmpresa(db(), s.empresaId, async (tx) => ({ pres: await leerPresupuesto(tx, ejercicio), real: await realPorPartida(tx, ejercicio) }));
  const { filas, resultado } = comparar(pres, real, hastaMes);
  const hayPresupuesto = filas.some((f) => f.presupuestoAnualCent);
  const puedeEditar = ROLES_FACTURACION.includes(s.rol);
  const periodo = hastaMes === 12 ? "el año completo" : hastaMes ? `enero a ${MESES[hastaMes - 1]}` : "—";
  return (
    <>
      <h1>Presupuestos</h1>
      <form className="panel" style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
        <label>Ejercicio<input name="ejercicio" type="number" min={2000} max={2100} defaultValue={ejercicio} style={{ width: 100 }} /></label>
        <button className="btn btn-sec">Ver</button>
        {puedeEditar && <Link className="btn" href={`/presupuestos/editar?ejercicio=${ejercicio}`}>{hayPresupuesto ? "Editar presupuesto" : "Crear presupuesto"}</Link>}
        <span className="muted" style={{ fontSize: 13 }}>Comparación de {periodo}. Sin IVA; el IVA no deducible cuenta como gasto.</span>
      </form>
      {q.guardado && <div className="aviso panel">Presupuesto guardado. Los cambios quedan en la auditoría.</div>}
      {!hayPresupuesto && <div className="panel muted">Aún no hay presupuesto para {ejercicio}. {puedeEditar && "Puedes crearlo partiendo de lo real del año anterior."}</div>}
      <div className="grid">
        <div className="panel"><div className="muted">Resultado presupuestado</div><b>{formatearEuros(resultado.presupuestoCent)}</b></div>
        <div className="panel"><div className="muted">Resultado real</div><b style={{ color: resultado.realCent < resultado.presupuestoCent ? "var(--bad)" : undefined }}>{formatearEuros(resultado.realCent)}</b></div>
        <div className="panel"><div className="muted">Desviación</div><b style={{ color: resultado.realCent < resultado.presupuestoCent ? "var(--bad)" : undefined }}>{formatearEuros(resultado.realCent - resultado.presupuestoCent)}</b></div>
      </div>
      <div className="panel">
        <b>Presupuesto frente a real ({periodo})</b>
        <table>
          <thead><tr><th>Partida</th><th className="num">Presupuesto</th><th className="num">Real</th><th className="num">Desviación</th><th className="num">Ejecutado</th><th className="num">Presupuesto anual</th></tr></thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.partida}>
                <td style={{ fontWeight: f.esIngreso ? 600 : undefined }}>{f.nombre}</td>
                <td className="num">{formatearEuros(f.presupuestoCent)}</td>
                <td className="num">{formatearEuros(f.realCent)}</td>
                <td className="num" style={{ color: f.desfavorable && f.desviacionCent ? "var(--bad)" : undefined }}>
                  {f.desviacionCent > 0 ? "+" : ""}{formatearEuros(f.desviacionCent)}{f.desfavorable && f.desviacionCent ? " ▲" : ""}
                </td>
                <td className="num">{f.ejecucionPct === null ? "—" : `${f.ejecucionPct.toLocaleString("es-ES")} %`}</td>
                <td className="num">{formatearEuros(f.presupuestoAnualCent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12 }}>En rojo con ▲, las desviaciones desfavorables: ingresar menos o gastar más de lo previsto.</p>
      </div>
    </>
  );
}
