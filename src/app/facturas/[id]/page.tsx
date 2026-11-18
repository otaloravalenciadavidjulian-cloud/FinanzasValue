import { notFound } from "next/navigation";
import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_FACTURACION } from "@/lib/auth/sesion";
import { ETIQUETA_COBRO, estadoCobro, hoyMadrid } from "@/lib/cobros/estado";
import { FormularioMovimiento } from "../../movimiento-form";
import { cobrar } from "./acciones";
import { formatearEuros } from "@/lib/fiscal/dinero";
import { entornoAEAT } from "@/lib/facturacion/documento";
import { importeTotalRegistro } from "@/lib/facturacion/emitir";
import { LEYENDA_VERIFACTU, urlQR } from "@/lib/verifactu/qr";

export const dynamic = "force-dynamic";

export default async function Factura({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sesion = await requerirSesion();
  const datos = await enEmpresa(db(), sesion.empresaId, async (tx) => {
    const [f] = await tx`SELECT f.*, to_char(f.fecha_expedicion,'YYYY-MM-DD') AS fecha, to_char(f.vencimiento,'YYYY-MM-DD') AS venc, e.nif AS nif_emisor, e.razon_social AS emisor
      FROM facturas f JOIN empresas e ON e.id = f.empresa_id WHERE f.id = ${id}`;
    if (!f) return null;
    const lineas = await tx`SELECT * FROM lineas_factura WHERE factura_id = ${id} ORDER BY orden`;
    const desglose = await tx`SELECT * FROM desglose_iva WHERE factura_id = ${id} ORDER BY tipo_iva DESC`;
    const registros = await tx`SELECT tipo, secuencia, huella, huella_anterior, fecha_hora_huso FROM registros_facturacion WHERE factura_id = ${id} ORDER BY secuencia`;
    const cobros = await tx`SELECT id, to_char(fecha,'DD/MM/YYYY') AS fecha, importe_cent, metodo, notas FROM cobros WHERE factura_id = ${id} ORDER BY fecha, creado_en`;
    return { f, lineas, desglose, registros, cobros };
  });
  if (!datos) notFound();
  const { f, lineas, desglose, registros, cobros } = datos;
  const hoy = hoyMadrid();
  const totalCent = Number(f.total_cent);
  const cobradoCent = cobros.reduce((a, c) => a + Number(c.importe_cent), 0);
  const vencimiento: string | null = f.venc;
  const estado = estadoCobro({ totalCent, cobradoCent, vencimiento, hoy, anulada: f.anulada });
  const pendienteTexto = ((totalCent - cobradoCent) / 100).toFixed(2).replace(".", ",");
  const qr = urlQR({ nifEmisor: f.nif_emisor, numSerie: f.num_serie, fechaExpedicion: f.fecha, importeTotalCent: importeTotalRegistro({ baseCent: Number(f.base_cent), cuotaIvaCent: Number(f.cuota_iva_cent) }), entorno: entornoAEAT() });
  const dst = f.destinatario as { direccion?: string; codigo_postal?: string; municipio?: string; provincia?: string; pais?: string } | null;
  const facturaeLista = !!dst && !f.anulada && !!dst.direccion && !!dst.municipio && (dst.pais && dst.pais !== "ES" ? true : /^\d{5}$/.test(dst.codigo_postal ?? "") && !!dst.provincia);
  return (
    <>
      <h1>Factura {f.num_serie}{f.anulada ? " (anulada)" : ""}</h1>
      <p style={{ display: "flex", gap: 8 }}>
        <a className="btn" href={`/facturas/${f.id}/pdf`} target="_blank" rel="noopener">Ver PDF</a>
        <a className="btn btn-sec" href={`/facturas/${f.id}/xml`}>Descargar XML VERI*FACTU</a>
        {facturaeLista && (
          <a className="btn btn-sec" href={`/facturas/${f.id}/facturae`} title="Formato Facturae 3.2.2 sin firmar. Para FACe, fírmala con el certificado de la empresa (por ejemplo, con AutoFirma).">Descargar Facturae</a>
        )}
      </p>
      {f.destinatario && !f.anulada && !facturaeLista && (
        <p className="muted" style={{ fontSize: 13 }}>No se puede generar la factura electrónica (Facturae) porque se emitió sin la dirección completa del cliente. Completa su ficha para las próximas facturas.</p>
      )}
      <div className="panel">
        <p><b>{f.emisor}</b> · NIF {f.nif_emisor}<br />Cliente: {f.destinatario?.razon_social ?? "—"} · NIF {f.destinatario?.nif ?? "—"}</p>
        <table>
          <thead><tr><th>Concepto</th><th className="num">Cantidad</th><th className="num">Precio</th><th className="num">IVA</th><th className="num">Base</th></tr></thead>
          <tbody>{lineas.map((l) => <tr key={l.id}><td>{l.concepto}</td><td className="num">{Number(l.cantidad)}</td><td className="num">{formatearEuros(Number(l.precio_unitario_cent))}</td><td className="num">{Number(l.tipo_iva)} %</td><td className="num">{formatearEuros(Number(l.base_cent))}</td></tr>)}</tbody>
        </table>
        <p className="num">
          {desglose.map((d) => <span key={d.tipo_iva}>Base {Number(d.tipo_iva)} %: {formatearEuros(Number(d.base_cent))} · IVA: {formatearEuros(Number(d.cuota_cent))}<br /></span>)}
          {Number(f.retencion_cent) ? <>Retención IRPF: −{formatearEuros(Number(f.retencion_cent))}<br /></> : null}
          <b>Total: {formatearEuros(Number(f.total_cent))}</b>
        </p>
        <p>QR tributario (VERI*FACTU) · {LEYENDA_VERIFACTU}<br /><span className="mono">{qr}</span></p>
      </div>
      <div className="panel">
        <b>Cobros</b> <span className={`estado estado-${estado}`}>{ETIQUETA_COBRO[estado]}</span>
        <p className="muted">Cobrado {formatearEuros(cobradoCent)} de {formatearEuros(totalCent)} · pendiente {formatearEuros(totalCent - cobradoCent)}{vencimiento ? ` · vence el ${vencimiento.split("-").reverse().join("/")}` : ""}</p>
        {cobros.length > 0 && (
          <table>
            <thead><tr><th>Fecha</th><th>Método</th><th>Notas</th><th className="num">Importe</th></tr></thead>
            <tbody>{cobros.map((c) => <tr key={c.id}><td>{c.fecha}</td><td>{c.metodo}</td><td>{c.notas ?? ""}</td><td className="num">{formatearEuros(Number(c.importe_cent))}</td></tr>)}</tbody>
          </table>
        )}
        {!f.anulada && ROLES_FACTURACION.includes(sesion.rol) && (
          <FormularioMovimiento accion={cobrar.bind(null, f.id)} pendiente={pendienteTexto} hoy={hoy} titulo="Registrar cobro" boton="Registrar cobro" />
        )}
        {cobros.length > 0 && <p className="muted" style={{ fontSize: 12 }}>Los cobros no se borran. Para corregir uno, registra otro con importe negativo.</p>}
      </div>
      <div className="panel">
        <b>Registro de facturación</b>
        {registros.map((r) => <p key={r.secuencia} className="mono">#{r.secuencia} {r.tipo} · {r.fecha_hora_huso}<br />Huella {r.huella}<br />Anterior {r.huella_anterior ?? "(primer registro)"}</p>)}
      </div>
    </>
  );
}
