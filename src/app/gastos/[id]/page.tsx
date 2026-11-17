import { notFound } from "next/navigation";
import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_FACTURACION, ROLES_GASTOS } from "@/lib/auth/sesion";
import { ETIQUETA_PAGO, estadoCobro, hoyMadrid } from "@/lib/cobros/estado";
import { formatearEuros } from "@/lib/fiscal/dinero";
import { nombreCategoria } from "@/lib/gastos/categorias";
import { FormularioMovimiento } from "../../movimiento-form";
import { aPapelera, pagar, restaurar } from "../acciones";
import { BotonPapelera, BotonRestaurar } from "./papelera";
import { adjuntar, justificanteAPapelera } from "../justificantes";
import { BotonQuitarJustificante, FormularioAdjuntar } from "./justificantes";

export const dynamic = "force-dynamic";

const TIPO_DOC: Record<string, string> = { factura: "Factura", factura_simplificada: "Factura simplificada", ticket: "Ticket", otro: "Otro justificante" };
const fechaES = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");

export default async function Gasto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await requerirSesion();
  const datos = await enEmpresa(db(), s.empresaId, async (tx) => {
    const [g] = await tx`SELECT g.*, to_char(g.fecha_expedicion,'YYYY-MM-DD') AS fecha, to_char(g.vencimiento,'YYYY-MM-DD') AS venc,
        to_char(g.borrado_en AT TIME ZONE 'Europe/Madrid','DD/MM/YYYY HH24:MI') AS borrado, t.razon_social AS proveedor, t.nif AS proveedor_nif
      FROM gastos g LEFT JOIN terceros t ON t.id = g.proveedor_id WHERE g.id = ${id}`;
    if (!g) return null;
    if (s.rol === "empleado" && g.creado_por !== s.usuarioId) return null;
    const desglose = await tx`SELECT * FROM desglose_gasto WHERE gasto_id = ${id} ORDER BY tipo_iva DESC`;
    const pagos = await tx`SELECT id, to_char(fecha,'DD/MM/YYYY') AS fecha, importe_cent, metodo, notas FROM pagos WHERE gasto_id = ${id} ORDER BY fecha, creado_en`;
    const documentos = await tx`SELECT id, nombre, mime, tamano_bytes, sha256, to_char(creado_en AT TIME ZONE 'Europe/Madrid','DD/MM/YYYY HH24:MI') AS subido
      FROM documentos WHERE entidad = 'gasto' AND entidad_id = ${id} AND borrado_en IS NULL ORDER BY creado_en`;
    return { g, desglose, pagos, documentos };
  });
  if (!datos) notFound();
  const { g, desglose, pagos, documentos } = datos;
  const hoy = hoyMadrid();
  const totalCent = Number(g.total_cent);
  const pagadoCent = pagos.reduce((a, p) => a + Number(p.importe_cent), 0);
  const estado = estadoCobro({ totalCent, cobradoCent: pagadoCent, vencimiento: g.venc, hoy, anulada: Boolean(g.borrado_en) });
  const pendienteTexto = ((totalCent - pagadoCent) / 100).toFixed(2).replace(".", ",");
  const puedeGestionar = ROLES_GASTOS.includes(s.rol);
  return (
    <>
      <h1>{TIPO_DOC[g.tipo_documento]} {g.numero ?? ""} <span className={`estado estado-${estado}`} style={{ fontSize: 13, verticalAlign: "middle" }}>{ETIQUETA_PAGO[estado]}</span></h1>
      {g.borrado && <div className="aviso">En la papelera desde el {g.borrado}. Motivo: {g.motivo_borrado}</div>}
      {g.pendiente_documentacion && !g.borrado && <div className="aviso">Pendiente de documentación: falta adjuntar el justificante.</div>}
      <div className="panel">
        <p><b>{g.proveedor ?? "Sin proveedor"}</b>{g.proveedor_nif ? ` · NIF ${g.proveedor_nif}` : ""}<br />
          Fecha {fechaES(g.fecha)} · Vencimiento {fechaES(g.venc)} · {nombreCategoria(g.categoria)}{g.subcategoria ? ` / ${g.subcategoria}` : ""}</p>
        <p>{g.descripcion}</p>
        <table>
          <thead><tr><th className="num">IVA</th><th className="num">Base</th><th className="num">Cuota</th><th className="num">% deducible</th><th className="num">Cuota deducible</th></tr></thead>
          <tbody>{desglose.map((d) => <tr key={d.id}><td className="num">{Number(d.tipo_iva)} %</td><td className="num">{formatearEuros(Number(d.base_cent))}</td><td className="num">{formatearEuros(Number(d.cuota_cent))}</td><td className="num">{Number(d.deducible_pct)} %</td><td className="num">{formatearEuros(Number(d.cuota_deducible_cent))}</td></tr>)}</tbody>
        </table>
        <p className="num">
          {Number(g.retencion_cent) ? <>Retención IRPF ({Number(g.retencion_pct)} %): -{formatearEuros(Number(g.retencion_cent))}<br /></> : null}
          <b>Total: {formatearEuros(totalCent)}</b>
        </p>
        {g.notas && <p className="muted">{g.notas}</p>}
      </div>
      <div className="panel">
        <b>Justificantes</b>
        {documentos.length === 0 && <p className="muted">Ningún justificante adjunto.</p>}
        {documentos.length > 0 && (
          <table>
            <thead><tr><th>Archivo</th><th>Subido</th><th className="num">Tamaño</th><th>Huella SHA-256</th><th></th></tr></thead>
            <tbody>{documentos.map((d) => (
              <tr key={d.id}>
                <td><a href={`/documentos/${d.id}`} target="_blank" rel="noopener">{d.nombre}</a></td>
                <td>{d.subido}</td>
                <td className="num">{(Number(d.tamano_bytes) / 1024).toFixed(0)} KB</td>
                <td className="mono" title={d.sha256}>{d.sha256.slice(0, 16)}…</td>
                <td>{puedeGestionar && !g.borrado && <BotonQuitarJustificante accion={justificanteAPapelera.bind(null, id, d.id)} />}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {puedeGestionar && !g.borrado && <div style={{ marginTop: 10 }}><FormularioAdjuntar accion={adjuntar.bind(null, id)} /></div>}
      </div>
      <div className="panel">
        <b>Pagos</b>
        <p className="muted">Pagado {formatearEuros(pagadoCent)} de {formatearEuros(totalCent)} · pendiente {formatearEuros(totalCent - pagadoCent)}</p>
        {pagos.length > 0 && (
          <table>
            <thead><tr><th>Fecha</th><th>Método</th><th>Notas</th><th className="num">Importe</th></tr></thead>
            <tbody>{pagos.map((p) => <tr key={p.id}><td>{p.fecha}</td><td>{p.metodo}</td><td>{p.notas ?? ""}</td><td className="num">{formatearEuros(Number(p.importe_cent))}</td></tr>)}</tbody>
          </table>
        )}
        {!g.borrado && ROLES_FACTURACION.includes(s.rol) && (
          <FormularioMovimiento accion={pagar.bind(null, id)} pendiente={pendienteTexto} hoy={hoy} titulo="Registrar pago" boton="Registrar pago" />
        )}
      </div>
      {puedeGestionar && (
        <div className="panel">
          {g.borrado ? <BotonRestaurar accion={restaurar.bind(null, id)} /> : <BotonPapelera accion={aPapelera.bind(null, id)} />}
        </div>
      )}
    </>
  );
}
