"use client";
import { useActionState } from "react";
import { crearCliente } from "./acciones";

export function FormularioCliente() {
  const [estado, accion, enviando] = useActionState(crearCliente, {});
  const v = (k: string) => estado.valores?.[k] ?? "";
  return (
    <form key={JSON.stringify(estado)} action={accion} className="panel" style={{ display: "grid", gap: 12 }}>
      <b>Nuevo cliente</b>
      {estado.error && <div className="error">{estado.error}</div>}
      {estado.ok && <div className="muted">{estado.ok}</div>}
      <div className="grid">
        <label>Razón social<input name="razon" required defaultValue={v("razon")} /></label>
        <label>CIF/NIF<input name="nif" required defaultValue={v("nif")} /></label>
        <label>Dirección fiscal<input name="direccion" defaultValue={v("direccion")} /></label>
        <label>Código postal<input name="cp" defaultValue={v("cp")} /></label>
        <label>Municipio<input name="municipio" defaultValue={v("municipio")} /></label>
        <label>Provincia<input name="provincia" defaultValue={v("provincia")} /></label>
        <label>Email<input name="email" type="email" defaultValue={v("email")} /></label>
        <label>Teléfono<input name="telefono" defaultValue={v("telefono")} /></label>
        <label>Días de pago<input name="dias" type="number" min={0} defaultValue={v("dias") || "30"} /></label>
      </div>
      <div><button className="btn" disabled={enviando}>{enviando ? "Guardando…" : "Guardar cliente"}</button></div>
    </form>
  );
}
