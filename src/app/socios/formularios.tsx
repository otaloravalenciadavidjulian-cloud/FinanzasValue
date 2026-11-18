"use client";
import { useActionState, useEffect, useState } from "react";
import { crearOperacion, crearSocio, type EstadoSocios } from "./acciones";

const Mensaje = ({ e }: { e: EstadoSocios }) => e.error ? <div className="error">{e.error}</div> : e.ok ? <div className="muted">{e.ok}</div> : null;

export function FormularioSocio() {
  const [e, accion, enviando] = useActionState(crearSocio, {});
  const v = (k: string) => e.valores?.[k] ?? "";
  return (
    <form key={JSON.stringify(e)} action={accion} className="panel" style={{ display: "grid", gap: 12 }}>
      <b>Nuevo socio</b>
      <Mensaje e={e} />
      <div className="grid">
        <label>Nombre o razón social<input name="nombre" required defaultValue={v("nombre")} /></label>
        <label>NIF (opcional)<input name="nif" defaultValue={v("nif")} /></label>
        <label>Participación % (opcional)<input name="participacion" inputMode="decimal" defaultValue={v("participacion")} /></label>
        <label>Email (opcional)<input name="email" type="email" defaultValue={v("email")} /></label>
      </div>
      <div><button className="btn" disabled={enviando}>{enviando ? "Guardando…" : "Guardar socio"}</button></div>
    </form>
  );
}

type Prestamo = { id: string; socioId: string; etiqueta: string };

export function FormularioOperacion({ socios, prestamos, hoy }: { socios: { id: string; nombre: string }[]; prestamos: Prestamo[]; hoy: string }) {
  const [e, accion, enviando] = useActionState(crearOperacion, {});
  const v = (k: string, d = "") => e.valores?.[k] ?? d;
  const [tipo, setTipo] = useState(v("tipo", "capital"));
  const [socio, setSocio] = useState(v("socio"));
  // Tras guardar, el formulario se vacía: los desplegables vuelven a su valor inicial.
  useEffect(() => { if (e.ok) { setTipo("capital"); setSocio(""); } }, [e]);
  const suyos = prestamos.filter((p) => p.socioId === socio);
  return (
    <form key={JSON.stringify(e)} action={accion} className="panel" style={{ display: "grid", gap: 12 }}>
      <b>Registrar aportación, préstamo o devolución</b>
      <Mensaje e={e} />
      <div className="grid">
        <label>Socio<select name="socio" required value={socio} onChange={(x) => setSocio(x.target.value)}>
          <option value="" disabled>Selecciona…</option>{socios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>
        <label>Tipo<select name="tipo" value={tipo} onChange={(x) => setTipo(x.target.value)}>
          <option value="capital">Aportación de capital (inicial o ampliación)</option>
          <option value="aportacion">Aportación sin ampliar capital</option>
          <option value="prestamo">Préstamo del socio a la empresa</option>
          <option value="devolucion">Devolución de préstamo al socio</option>
        </select></label>
        <label>Fecha<input type="date" name="fecha" required max={hoy} defaultValue={v("fecha", hoy)} /></label>
        <label>Importe (€)<input name="importe" required inputMode="decimal" placeholder="0,00" defaultValue={v("importe")} /></label>
        {tipo === "prestamo" && <>
          <label>Plazo<select name="plazo" defaultValue={v("plazo", "largo")}>
            <option value="largo">Largo plazo (más de 12 meses)</option><option value="corto">Corto plazo (hasta 12 meses)</option></select></label>
          <label>Fecha de devolución (opcional)<input type="date" name="vencimiento" defaultValue={v("vencimiento")} /></label>
          <label>Interés anual % (opcional)<input name="interes" inputMode="decimal" placeholder="0" defaultValue={v("interes")} /></label>
        </>}
        {tipo === "devolucion" && <label>Préstamo que se devuelve<select name="prestamo" required defaultValue={v("prestamo")}>
          <option value="" disabled>{socio ? (suyos.length ? "Selecciona…" : "Este socio no tiene préstamos pendientes") : "Elige antes el socio"}</option>
          {suyos.map((p) => <option key={p.id} value={p.id}>{p.etiqueta}</option>)}</select></label>}
        <label>Concepto (opcional)<input name="concepto" maxLength={300} defaultValue={v("concepto")} /></label>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {tipo === "capital" && "Capital social (cuenta 100). Es dinero que entra en la empresa, pero no es un ingreso: no lleva IVA ni cuenta en la rentabilidad."}
        {tipo === "aportacion" && "Aportación de socios (cuenta 118), por ejemplo para cubrir pérdidas, sin ampliar el capital. No es un ingreso."}
        {tipo === "prestamo" && "Deuda de la empresa con el socio (cuenta 163 a largo plazo o 5133 a corto). Si indicas la fecha de devolución, aparece como pago previsto en la tesorería."}
        {tipo === "devolucion" && "Salida de dinero que reduce la deuda con el socio. No es un gasto."}
      </p>
      <div><button className="btn" disabled={enviando || socios.length === 0}>{enviando ? "Guardando…" : "Registrar"}</button></div>
    </form>
  );
}
