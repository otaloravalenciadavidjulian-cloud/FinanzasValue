"use client";
import { useActionState } from "react";
import type { EstadoMovimiento } from "./facturas/[id]/acciones";

const METODOS = ["Transferencia", "Domiciliación", "Tarjeta", "Efectivo", "Bizum", "Compensación", "Otro"];

/** Formulario de cobro o pago: fecha, importe (por defecto lo pendiente) y método. */
export function FormularioMovimiento({ accion, pendiente, hoy, titulo, boton }: {
  accion: (p: EstadoMovimiento, f: FormData) => Promise<EstadoMovimiento>; pendiente: string; hoy: string; titulo: string; boton: string;
}) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  const v = (k: string, d: string) => estado.valores?.[k] ?? d;
  return (
    <form key={JSON.stringify(estado)} action={enviar} style={{ display: "grid", gap: 10, marginTop: 12 }}>
      <b>{titulo}</b>
      {estado.error && <div className="error">{estado.error}</div>}
      {estado.ok && <div className="muted">{estado.ok}</div>}
      <div className="grid">
        <label>Fecha<input type="date" name="fecha" max={hoy} required defaultValue={v("fecha", hoy)} /></label>
        <label>Importe (€)<input name="importe" inputMode="decimal" required defaultValue={v("importe", pendiente)} /></label>
        <label>Método<select name="metodo" defaultValue={v("metodo", "Transferencia")}>{METODOS.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>Notas<input name="notas" defaultValue={v("notas", "")} /></label>
      </div>
      <div><button className="btn" disabled={enviando}>{enviando ? "Guardando…" : boton}</button></div>
    </form>
  );
}
