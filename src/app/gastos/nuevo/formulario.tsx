"use client";
import Link from "next/link";
import { useActionState } from "react";
import { guardarGasto } from "../acciones";

const TIPOS = [21, 10, 5, 4, 2, 0];

export function FormularioGasto({ proveedores, categorias, hoy }: {
  proveedores: { id: string; razon_social: string; nif: string }[];
  categorias: { codigo: string; nombre: string }[];
  hoy: string;
}) {
  const [estado, accion, enviando] = useActionState(guardarGasto, {});
  const v = (k: string, d = "") => estado.valores?.[k] ?? d;
  const duplicados = estado.posiblesDuplicados ?? [];
  return (
    <form key={JSON.stringify(estado)} action={accion} className="panel" style={{ display: "grid", gap: 14 }}>
      {estado.error && <div className="error">{estado.error}</div>}
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
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>El gasto queda marcado como pendiente de documentación hasta que se pueda adjuntar el justificante.</p>
      <div><button className="btn" disabled={enviando}>{enviando ? "Guardando…" : "Guardar gasto"}</button></div>
    </form>
  );
}
