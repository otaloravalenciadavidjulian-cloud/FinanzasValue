import Link from "next/link";
import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_CONTABILIDAD } from "@/lib/auth/sesion";
import { hoyMadrid } from "@/lib/cobros/estado";
import { formatearEuros } from "@/lib/fiscal/dinero";
import { calcular303, calcular347, calcularRetenciones, casillas303, UMBRAL_347, type Casilla } from "@/lib/impuestos/modelos";
import { plazo347, trimestreAPresentar, type Trimestre } from "@/lib/impuestos/periodos";

export const dynamic = "force-dynamic";

const fecha = (iso: string) => iso.split("-").reverse().join("/");

function TablaCasillas({ casillas }: { casillas: Casilla[] }) {
  return (
    <table>
      <thead><tr><th>Casilla</th><th>Concepto</th><th className="num">Importe</th></tr></thead>
      <tbody>{casillas.map((c) => (
        <tr key={c.casilla}><td className="mono">[{c.casilla}]</td><td>{c.concepto}</td>
          <td className="num">{c.esNumero ? c.importeCent : formatearEuros(c.importeCent)}</td></tr>
      ))}</tbody>
    </table>
  );
}

export default async function Impuestos({ searchParams }: { searchParams: Promise<{ ejercicio?: string; trimestre?: string }> }) {
  const q = await searchParams;
  const s = await requerirSesion(ROLES_CONTABILIDAD);
  const hoy = hoyMadrid();
  const def = trimestreAPresentar(hoy);
  const ejercicio = /^\d{4}$/.test(q.ejercicio ?? "") ? Number(q.ejercicio) : def.ejercicio;
  const trimestre = (["1", "2", "3", "4"].includes(q.trimestre ?? "") ? Number(q.trimestre) : def.trimestre) as Trimestre;
  const { m303, m111, m115, m347 } = await enEmpresa(db(), s.empresaId, async (tx) => ({
    m303: await calcular303(tx, ejercicio, trimestre),
    m111: await calcularRetenciones(tx, "111", ejercicio, trimestre),
    m115: await calcularRetenciones(tx, "115", ejercicio, trimestre),
    m347: await calcular347(tx, ejercicio),
  }));
  const anyos = [def.ejercicio + 1, def.ejercicio, def.ejercicio - 1, def.ejercicio - 2].filter((a) => a <= Number(hoy.slice(0, 4)));
  const plazo = `del ${fecha(m303.plazo.desde)} al ${fecha(m303.plazo.hasta)}`;
  return (
    <>
      <h1>Impuestos</h1>
      <div className="aviso">
        Borradores calculados con lo registrado en Value. <b>Value no presenta declaraciones</b>: revisa las cifras (o pásalas a tu asesor)
        y preséntalas tú en la sede electrónica de la AEAT. Los plazos son los generales; si el último día es festivo, se amplían.
      </div>
      <form className="panel" style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
        <label>Ejercicio<select name="ejercicio" defaultValue={String(ejercicio)}>{anyos.map((a) => <option key={a}>{a}</option>)}</select></label>
        <label>Trimestre<select name="trimestre" defaultValue={String(trimestre)}>{[1, 2, 3, 4].map((t) => <option key={t} value={t}>{t}T</option>)}</select></label>
        <button className="btn btn-sec">Ver</button>
      </form>

      <div className="panel">
        <h2 style={{ fontSize: 17, margin: "0 0 4px" }}>Modelo 303 · IVA {m303.periodo.etiqueta}</h2>
        <p className="muted" style={{ marginTop: 0 }}>Plazo {plazo}.</p>
        {m303.avisos.map((a) => <div key={a} className="aviso" style={{ marginBottom: 8 }}>{a}</div>)}
        <TablaCasillas casillas={casillas303(m303)} />
        <p style={{ fontSize: 16 }}>
          {m303.resultadoCent > 0 ? <>Resultado a ingresar: <b>{formatearEuros(m303.resultadoCent)}</b></>
            : m303.resultadoCent < 0 ? <>Resultado a compensar o devolver: <b>{formatearEuros(-m303.resultadoCent)}</b>{trimestre === 4 ? " (en el 4T se puede pedir la devolución)" : " (se compensa en los siguientes trimestres)"}</>
            : <>Sin actividad o resultado cero.</>}
        </p>
        <p className="muted" style={{ fontSize: 12 }}>Si hay cuotas a compensar de trimestres anteriores, réstalas en la casilla 110. Value considera todos los gastos como operaciones interiores corrientes (no bienes de inversión, importaciones ni operaciones intracomunitarias).</p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
        <div className="panel">
          <h2 style={{ fontSize: 17, margin: "0 0 4px" }}>Modelo 111 · Retenciones {m111.periodo.etiqueta}</h2>
          <p className="muted" style={{ marginTop: 0 }}>Plazo {plazo}. Profesionales y otras actividades económicas.</p>
          <TablaCasillas casillas={m111.casillas} />
          <p className="muted" style={{ fontSize: 12 }}>Las retenciones de nóminas (casillas 01 a 03) aún no se registran en Value: añádelas aparte.</p>
        </div>
        <div className="panel">
          <h2 style={{ fontSize: 17, margin: "0 0 4px" }}>Modelo 115 · Alquileres {m115.periodo.etiqueta}</h2>
          <p className="muted" style={{ marginTop: 0 }}>Plazo {plazo}. Retenciones de los gastos de categoría «Alquileres».</p>
          <TablaCasillas casillas={m115.casillas} />
        </div>
      </div>

      <div className="panel">
        <h2 style={{ fontSize: 17, margin: "0 0 4px" }}>Modelo 347 · Operaciones con terceros {ejercicio}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Plazo del {fecha(plazo347(ejercicio).desde)} al {fecha(plazo347(ejercicio).hasta)}. Clientes y proveedores con más de {formatearEuros(UMBRAL_347)} en el año, IVA incluido.
          Se excluyen las operaciones con retención y los tickets sin proveedor.
        </p>
        <table>
          <thead><tr><th>Clave</th><th>NIF</th><th>Nombre</th><th className="num">1T</th><th className="num">2T</th><th className="num">3T</th><th className="num">4T</th><th className="num">Total anual</th></tr></thead>
          <tbody>
            {m347.map((d) => (
              <tr key={d.terceroId + d.clave}>
                <td title={d.clave === "A" ? "Compras" : "Ventas"}>{d.clave} · {d.clave === "A" ? "compras" : "ventas"}</td>
                <td className="mono">{d.nif}</td><td>{d.nombre}</td>
                {d.trimestres.map((t, i) => <td key={i} className="num">{formatearEuros(t)}</td>)}
                <td className="num"><b>{formatearEuros(d.totalCent)}</b></td>
              </tr>
            ))}
            {!m347.length && <tr><td colSpan={8} className="muted">Ningún cliente ni proveedor supera el umbral en {ejercicio}.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted"><Link href="/tesoreria/prevision">La previsión de tesorería</Link> ya incluye el pago estimado de estos impuestos.</p>
    </>
  );
}
