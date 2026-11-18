import Link from "next/link";
import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_FACTURACION } from "@/lib/auth/sesion";
import { hoyMadrid } from "@/lib/cobros/estado";
import { formatearEuros } from "@/lib/fiscal/dinero";
import { prestamosPendientes, resumenSocios, TIPOS_OPERACION, type TipoOperacion } from "@/lib/socios/socios";
import { quitarOperacion } from "./acciones";
import { BotonBorrar } from "./borrar";
import { FormularioOperacion, FormularioSocio } from "./formularios";

export const dynamic = "force-dynamic";
const fechaES = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");

export default async function Socios() {
  const s = await requerirSesion(ROLES_FACTURACION);
  const { socios, prestamos, operaciones } = await enEmpresa(db(), s.empresaId, async (tx) => ({
    socios: await resumenSocios(tx),
    prestamos: await prestamosPendientes(tx),
    operaciones: await tx<{ id: string; fecha: string; tipo: TipoOperacion; socio: string; importe_cent: string; plazo: string | null; vencimiento: string | null; interes_pct: string | null; concepto: string | null; conciliada: boolean }[]>`
      SELECT o.id, to_char(o.fecha,'YYYY-MM-DD') AS fecha, o.tipo, s.nombre AS socio, o.importe_cent, o.plazo, to_char(o.vencimiento,'YYYY-MM-DD') AS vencimiento, o.interes_pct, o.concepto,
             EXISTS (SELECT 1 FROM conciliaciones k WHERE k.operacion_socio_id = o.id AND k.deshecha_en IS NULL) AS conciliada
      FROM operaciones_socios o JOIN socios s ON s.id = o.socio_id WHERE o.borrado_en IS NULL ORDER BY o.fecha DESC, o.creado_en DESC LIMIT 200`,
  }));
  const hoy = hoyMadrid();
  const total = (k: "capitalCent" | "aportacionesCent" | "prestamoPendienteCent") => socios.reduce((a, x) => a + x[k], 0);
  return (
    <>
      <h1>Socios y financiación</h1>
      <p className="muted">
        Dinero que entra en la empresa sin ser un ingreso: el capital que aportan los socios y los préstamos que hacen a la empresa.
        No lleva IVA y no cuenta en la facturación ni en la rentabilidad, pero sí en la tesorería y en la contabilidad.
        Si importas el extracto del banco, concilia el movimiento en <Link href="/tesoreria/conciliar">Conciliación</Link> con la operación registrada aquí.
      </p>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", marginBottom: 16 }}>
        <div className="panel"><div className="muted">Capital aportado</div><b style={{ fontSize: 22 }}>{formatearEuros(total("capitalCent"))}</b></div>
        <div className="panel"><div className="muted">Otras aportaciones</div><b style={{ fontSize: 22 }}>{formatearEuros(total("aportacionesCent"))}</b></div>
        <div className="panel"><div className="muted">Préstamos de socios pendientes</div><b style={{ fontSize: 22 }}>{formatearEuros(total("prestamoPendienteCent"))}</b></div>
      </div>
      <FormularioOperacion hoy={hoy} socios={socios.map((x) => ({ id: x.id, nombre: x.nombre }))}
        prestamos={prestamos.filter((p) => p.pendienteCent > 0).map((p) => ({ id: p.id, socioId: p.socio_id,
          etiqueta: `Préstamo del ${fechaES(p.fecha)} · pendiente ${formatearEuros(p.pendienteCent)}${p.vencimiento ? ` · vence ${fechaES(p.vencimiento)}` : ""}` }))} />
      {socios.length === 0 && <p className="muted">Da de alta primero a los socios.</p>}
      <div className="panel">
        <b>Socios</b>
        <table>
          <thead><tr><th>Socio</th><th>NIF</th><th className="num">Participación</th><th className="num">Capital</th><th className="num">Otras aportaciones</th><th className="num">Préstamo pendiente</th></tr></thead>
          <tbody>
            {socios.map((x) => <tr key={x.id}><td>{x.nombre}</td><td className="mono">{x.nif ?? "—"}</td><td className="num">{x.participacionPct !== null ? `${x.participacionPct.toLocaleString("es-ES")} %` : "—"}</td>
              <td className="num">{formatearEuros(x.capitalCent)}</td><td className="num">{formatearEuros(x.aportacionesCent)}</td><td className="num">{formatearEuros(x.prestamoPendienteCent)}</td></tr>)}
            {!socios.length && <tr><td colSpan={6} className="muted">Todavía no hay socios.</td></tr>}
          </tbody>
        </table>
      </div>
      <FormularioSocio />
      <div className="panel">
        <b>Operaciones</b>
        <table>
          <thead><tr><th>Fecha</th><th>Socio</th><th>Tipo</th><th>Detalle</th><th className="num">Importe</th><th></th></tr></thead>
          <tbody>
            {operaciones.map((o) => <tr key={o.id}>
              <td>{fechaES(o.fecha)}</td><td>{o.socio}</td><td>{TIPOS_OPERACION[o.tipo]}</td>
              <td className="muted">{[o.plazo ? `${o.plazo === "largo" ? "Largo" : "Corto"} plazo` : null, o.vencimiento ? `devolución ${fechaES(o.vencimiento)}` : null,
                o.interes_pct !== null ? `${Number(o.interes_pct).toLocaleString("es-ES")} % anual` : null, o.concepto, o.conciliada ? "conciliada con el banco" : null].filter(Boolean).join(" · ") || "—"}</td>
              <td className="num" style={{ color: o.tipo === "devolucion" ? "var(--bad)" : undefined }}>{o.tipo === "devolucion" ? "−" : "+"}{formatearEuros(Number(o.importe_cent))}</td>
              <td>{!o.conciliada && <BotonBorrar accion={quitarOperacion.bind(null, o.id)} />}</td>
            </tr>)}
            {!operaciones.length && <tr><td colSpan={6} className="muted">Todavía no hay aportaciones ni préstamos.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
