"use client";
import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { guardarGasto } from "../acciones";
import { leerArchivo, type ResultadoLectura } from "../justificantes";
import { conArchivoPreparado } from "../reducir-imagen";

const TIPOS = [21, 10, 5, 4, 2, 0];

interface Props {
  proveedores: { id: string; razon_social: string; nif: string }[];
  categorias: { codigo: string; nombre: string }[];
  hoy: string;
  puedeAltaProveedor: boolean;
  iaActiva: boolean;
}

/** Alta de gasto: primero, opcionalmente, se lee el justificante; después se revisa y se guarda. */
export function AltaGasto(props: Props) {
  const [lectura, setLectura] = useState<ResultadoLectura | null>(null);
  return (
    <>
      <LectorJustificante iaActiva={props.iaActiva} lectura={lectura} onLectura={setLectura} />
      <FormularioGasto {...props} lectura={lectura} />
    </>
  );
}

function LectorJustificante({ iaActiva, lectura, onLectura }: { iaActiva: boolean; lectura: ResultadoLectura | null; onLectura: (l: ResultadoLectura) => void }) {
  const [error, setError] = useState<string>();
  const [leyendo, iniciar] = useTransition();
  const leer = (f: FormData) => iniciar(async () => {
    setError(undefined);
    const r = await leerArchivo({}, await conArchivoPreparado(f));
    if (r.error) setError(r.error); else onLectura(r);
  });
  return (
    <div className="panel" style={{ display: "grid", gap: 10 }}>
      <b>Justificante</b>
      <p className="muted" style={{ margin: 0 }}>
        Sube la factura o el ticket (PDF o foto) y Value propondrá los datos para que los revises.
        {iaActiva ? " Se lee el QR tributario y el contenido con IA." : " Se lee el QR tributario; la lectura con IA no está activada."}
      </p>
      {lectura?.documentoId ? (
        <div className="aviso">
          <b>Leído: {lectura.nombre}.</b> Revisa todos los datos antes de guardar; los que no se han podido leer están vacíos.
          {lectura.avisos && lectura.avisos.length > 0 && <ul style={{ margin: "6px 0 0" }}>{lectura.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}
        </div>
      ) : (
        <form action={leer} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          <label style={{ flex: 1, minWidth: 220 }}>Archivo<input type="file" name="archivo" required accept="application/pdf,image/*" /></label>
          <button className="btn" disabled={leyendo}>{leyendo ? "Leyendo…" : "Subir y leer"}</button>
        </form>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

function FormularioGasto({ proveedores, categorias, hoy, puedeAltaProveedor, lectura }: Props & { lectura: ResultadoLectura | null }) {
  const [estado, accion, enviando] = useActionState(guardarGasto, {});
  const v = (k: string, d = "") => estado.valores?.[k] ?? lectura?.valores?.[k] ?? d;
  const duplicados = estado.posiblesDuplicados ?? [];
  const documentoId = v("documentoId", lectura?.documentoId ?? "");
  const nuevo = lectura?.proveedorNuevo;
  return (
    <form key={JSON.stringify(estado) + (lectura?.documentoId ?? "")} action={accion} className="panel" style={{ display: "grid", gap: 14 }}>
      {estado.error && <div className="error">{estado.error}</div>}
      {documentoId && <input type="hidden" name="documentoId" value={documentoId} />}
      {duplicados.length > 0 && (
        <div className="aviso">
          <b>Puede que este gasto ya esté registrado.</b> {duplicados[0].motivo}:
          <ul style={{ margin: "6px 0" }}>
            {duplicados.map((d) => <li key={d.id}><Link href={`/gastos/${d.id}`} target="_blank">{d.numero ?? "sin número"} del {d.fecha.split("-").reverse().join("/")}</Link></li>)}
          </ul>
          Si no es el mismo, pulsa otra vez en guardar.
          <input type="hidden" name="confirmar" value="1" />
        </div>
      )}
      <div className="grid">
        <label>Tipo de documento
          <select name="tipo" defaultValue={v("tipo", "factura")}>
            <option value="factura">Factura</option>
            <option value="factura_simplificada">Factura simplificada</option>
            <option value="ticket">Ticket</option>
            <option value="otro">Otro justificante</option>
          </select>
        </label>
        <label>Proveedor
          <select name="proveedor" defaultValue={v("proveedor")}>
            <option value="">— Sin proveedor (ticket) —</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.razon_social} · {p.nif}</option>)}
          </select>
        </label>
        {nuevo && (puedeAltaProveedor ? (
          <label style={{ alignSelf: "end" }}>
            <span><input type="checkbox" name="altaProveedor" value="1" defaultChecked={v("altaProveedor", "1") === "1"} style={{ width: "auto", marginRight: 6 }} />
              Si no eliges proveedor, dar de alta {nuevo.nombre ? `a ${nuevo.nombre}` : "al proveedor leído"} (NIF {nuevo.nif})</span>
            <input type="hidden" name="nuevoNif" value={nuevo.nif} />
            <input type="hidden" name="nuevoNombre" value={nuevo.nombre} />
          </label>
        ) : <p className="muted" style={{ alignSelf: "end", margin: 0 }}>Proveedor leído: {nuevo.nombre} (NIF {nuevo.nif}), aún no dado de alta.</p>)}
        <label>Número de factura<input name="numero" defaultValue={v("numero")} /></label>
        <label>Fecha de la factura<input type="date" name="fecha" required max={hoy} defaultValue={v("fecha", hoy)} /></label>
        <label>Categoría
          <select name="categoria" required defaultValue={v("categoria")}>
            <option value="">— Elige —</option>
            {categorias.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
          </select>
        </label>
        <label>Subcategoría<input name="subcategoria" defaultValue={v("subcategoria")} /></label>
      </div>
      <label>Descripción<input name="descripcion" required defaultValue={v("descripcion")} /></label>

      <div>
        <b>Importes</b>
        <p className="muted" style={{ margin: "4px 0 8px" }}>Una fila por cada tipo de IVA de la factura. Si la cuota de la factura difiere en céntimos, escríbela tal cual.</p>
        {[0, 1, 2].map((i) => (
          <div className="grid" key={i} style={{ marginBottom: 8 }}>
            <label>Base imponible (€)<input name={`base${i}`} inputMode="decimal" required={i === 0} defaultValue={v(`base${i}`)} /></label>
            <label>IVA
              <select name={`iva${i}`} defaultValue={v(`iva${i}`, "21")}>{TIPOS.map((t) => <option key={t} value={t}>{t} %</option>)}</select>
            </label>
            <label>Cuota de IVA (opcional)<input name={`cuota${i}`} inputMode="decimal" defaultValue={v(`cuota${i}`)} /></label>
            <label>% de IVA deducible<input name={`deducible${i}`} inputMode="decimal" defaultValue={v(`deducible${i}`, "100")} /></label>
          </div>
        ))}
      </div>

      <div className="grid">
        <label>Retención IRPF (%)<input name="retencion" inputMode="decimal" defaultValue={v("retencion", "0")} /></label>
        <label>Vencimiento<input type="date" name="vencimiento" defaultValue={v("vencimiento")} /></label>
        <label>Forma de pago<input name="metodo" defaultValue={v("metodo")} /></label>
        <label>Notas<input name="notas" defaultValue={v("notas")} /></label>
      </div>
      {!documentoId && <p className="muted" style={{ fontSize: 12, margin: 0 }}>Sin justificante, el gasto queda marcado como pendiente de documentación hasta que se adjunte.</p>}
      <div><button className="btn" disabled={enviando}>{enviando ? "Guardando…" : "Guardar gasto"}</button></div>
    </form>
  );
}
