import { notFound } from "next/navigation";
import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion } from "@/lib/auth/sesion";
import { formatearEuros } from "@/lib/fiscal/dinero";
import { LEYENDA_VERIFACTU, urlQR } from "@/lib/verifactu/qr";

export const dynamic = "force-dynamic";

export default async function Factura({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const datos = await enEmpresa(db(), (await requerirSesion()).empresaId, async (tx) => {
    const [f] = await tx`SELECT f.*, to_char(f.fecha_expedicion,'YYYY-MM-DD') AS fecha, e.nif AS nif_emisor, e.razon_social AS emisor
      FROM facturas f JOIN empresas e ON e.id = f.empresa_id WHERE f.id = ${id}`;
    if (!f) return null;
    const lineas = await tx`SELECT * FROM lineas_factura WHERE factura_id = ${id} ORDER BY orden`;
    const desglose = await tx`SELECT * FROM desglose_iva WHERE factura_id = ${id} ORDER BY tipo_iva DESC`;
    const registros = await tx`SELECT tipo, secuencia, huella, huella_anterior, fecha_hora_huso FROM registros_facturacion WHERE factura_id = ${id} ORDER BY secuencia`;
    return { f, lineas, desglose, registros };
  });
  if (!datos) notFound();
  const { f, lineas, desglose, registros } = datos;
  const qr = urlQR({ nifEmisor: f.nif_emisor, numSerie: f.num_serie, fechaExpedicion: f.fecha, importeTotalCent: Number(f.total_cent), entorno: process.env.VERIFACTU_ENTORNO === "produccion" ? "produccion" : "pruebas" });
  return (
    <>
      <h1>Factura {f.num_serie}{f.anulada ? " (anulada)" : ""}</h1>
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
        <b>Registro de facturación</b>
        {registros.map((r) => <p key={r.secuencia} className="mono">#{r.secuencia} {r.tipo} · {r.fecha_hora_huso}<br />Huella {r.huella}<br />Anterior {r.huella_anterior ?? "(primer registro)"}</p>)}
      </div>
    </>
  );
}
