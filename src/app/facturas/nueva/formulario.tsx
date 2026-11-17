"use client";
import { useActionState } from "react";
import { emitir } from "./acciones";

export function Formulario({ clientes, hoy }: { clientes: { id: string; razon_social: string }[]; hoy: string }) {
  const [estado, accion, enviando] = useActionState(emitir, {});
  return (
    <form action={accion} className="panel" style={{ display: "grid", gap: 14 }}>
      {estado.error && <div className="error">{estado.error}</div>}
      <div className="grid">
        <label>Serie<select name="serie" defaultValue="A"><option value="A">A · Ordinarias</option></select></label>
        <label>Cliente<select name="cliente" required defaultValue=""><option value="" disabled>Selecciona…</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}</select></label>
        <label>Fecha de expedición<input type="date" name="fecha" defaultValue={hoy} max={hoy} required /></label>
        <label>Vencimiento<input type="date" name="vencimiento" /></label>
        <label>Retención IRPF<select name="retencion" defaultValue="0">{[0, 7, 15, 19].map((x) => <option key={x} value={x}>{x} %</option>)}</select></label>
      </div>
      <table>
        <thead><tr><th>Concepto</th><th>Cantidad</th><th>Precio (€)</th><th>Dto. %</th><th>IVA</th></tr></thead>
        <tbody>
          {[0, 1, 2].map((i) => (
            <tr key={i}>
              <td><input name="concepto" required={i === 0} style={{ width: "100%" }} /></td>
              <td><input name="cantidad" defaultValue="1" inputMode="decimal" /></td>
              <td><input name="precio" inputMode="decimal" placeholder="0,00" /></td>
              <td><input name="descuento" defaultValue="0" inputMode="decimal" /></td>
              <td><select name="iva" defaultValue="21">{[21, 10, 4, 0].map((x) => <option key={x} value={x}>{x} %</option>)}</select></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Al emitir se asigna el número correlativo, se genera el registro con huella encadenada y la factura queda bloqueada.</p>
      <div><button className="btn" disabled={enviando}>{enviando ? "Emitiendo…" : "Emitir factura"}</button></div>
    </form>
  );
}
