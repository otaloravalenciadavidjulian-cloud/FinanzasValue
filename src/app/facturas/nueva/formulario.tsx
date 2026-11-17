"use client";
import { useActionState } from "react";
import { CAUSAS_IVA } from "@/lib/fiscal/exenciones";
import { emitir } from "./acciones";

export function Formulario({ clientes, proyectos, hoy }: { clientes: { id: string; razon_social: string }[]; proyectos: { id: string; nombre: string }[]; hoy: string }) {
  const [estado, accion, enviando] = useActionState(emitir, {});
  const v = (k: string, i = 0, def = "") => estado.valores?.[k]?.[i] ?? def;
  return (
    <form key={JSON.stringify(estado.valores ?? {})} action={accion} className="panel" style={{ display: "grid", gap: 14 }}>
      {estado.error && <div className="error">{estado.error}</div>}
      <div className="grid">
        <label>Serie<select name="serie" defaultValue="A"><option value="A">A · Ordinarias</option></select></label>
        <label>Cliente<select name="cliente" required defaultValue={v("cliente")}><option value="" disabled>Selecciona…</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}</select></label>
        <label>Fecha de expedición<input type="date" name="fecha" defaultValue={v("fecha", 0, hoy)} max={hoy} required /></label>
        <label>Vencimiento<input type="date" name="vencimiento" defaultValue={v("vencimiento")} /></label>
        {proyectos.length > 0 && <label>Proyecto<select name="proyecto" defaultValue={v("proyecto")}><option value="">— Ninguno —</option>{proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>}
        <label>Retención IRPF<select name="retencion" defaultValue={v("retencion", 0, "0")}>{[0, 7, 15, 19].map((x) => <option key={x} value={x}>{x} %</option>)}</select></label>
      </div>
      <table>
        <thead><tr><th>Concepto</th><th>Cantidad</th><th>Precio (€)</th><th>Dto. %</th><th>IVA</th></tr></thead>
        <tbody>
          {[0, 1, 2].map((i) => (
            <tr key={i}>
              <td><input name="concepto" defaultValue={v("concepto", i)} required={i === 0} style={{ width: "100%" }} /></td>
              <td><input name="cantidad" defaultValue={v("cantidad", i, "1")} inputMode="decimal" /></td>
              <td><input name="precio" defaultValue={v("precio", i)} inputMode="decimal" placeholder="0,00" /></td>
              <td><input name="descuento" defaultValue={v("descuento", i, "0")} inputMode="decimal" /></td>
              <td><select name="iva" defaultValue={v("iva", i, "21")} aria-label="IVA">
                {[21, 10, 4].map((x) => <option key={x} value={x}>{x} %</option>)}
                <optgroup label="Sin IVA (la factura llevará la mención legal)">
                  {CAUSAS_IVA.map((c) => <option key={c.codigo} value={`0:${c.codigo}`}>0 % · {c.nombre}</option>)}
                </optgroup>
              </select></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Al emitir se asigna el número correlativo, se genera el registro con huella encadenada y la factura queda bloqueada.</p>
      <div><button className="btn" disabled={enviando}>{enviando ? "Emitiendo…" : "Emitir factura"}</button></div>
    </form>
  );
}
