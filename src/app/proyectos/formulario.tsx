"use client";
import { useActionState } from "react";
import { crearProyecto } from "./acciones";

export function FormularioProyecto({ clientes }: { clientes: { id: string; razon_social: string }[] }) {
  const [estado, accion, enviando] = useActionState(crearProyecto, {});
  return (
    <form key={JSON.stringify(estado)} action={accion} className="panel" style={{ display: "grid", gap: 10 }}>
      <b>Nuevo proyecto</b>
      {estado.error && <div className="error">{estado.error}</div>}
      {estado.ok && <div className="muted">{estado.ok}</div>}
      <div className="grid">
        <label>Nombre<input name="nombre" required placeholder="p. ej. Web tienda online" /></label>
        <label>Cliente (opcional)<select name="cliente" defaultValue=""><option value="">— Sin cliente —</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}</select></label>
      </div>
      <div><button className="btn" disabled={enviando}>{enviando ? "Guardando…" : "Crear proyecto"}</button></div>
    </form>
  );
}
