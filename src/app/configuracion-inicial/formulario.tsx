"use client";
import { useActionState } from "react";
import { configurar } from "./acciones";
import { CampoContrasena } from "@/app/campo-contrasena";

export function Formulario() {
  const [estado, accion, enviando] = useActionState(configurar, {});
  const v = (k: string) => estado.valores?.[k] ?? "";
  return (
    <form key={JSON.stringify(estado.valores ?? {})} action={accion} className="panel" style={{ maxWidth: 720, display: "grid", gap: 14 }}>
      <h1>Configuración inicial</h1>
      <p className="muted">Crea tu empresa y tu usuario administrador. Solo se puede hacer una vez.</p>
      {estado.error && <div className="error">{estado.error}</div>}
      <label>Código de configuración (variable SETUP_TOKEN de Netlify)<CampoContrasena name="token" required /></label>
      <div className="grid">
        <label>Razón social<input name="razon" defaultValue={v("razon")} required /></label>
        <label>CIF/NIF<input name="nif" defaultValue={v("nif")} required /></label>
        <label>Domicilio fiscal<input name="domicilio" defaultValue={v("domicilio")} required /></label>
        <label>Código postal<input name="cp" defaultValue={v("cp")} required pattern="\d{5}" /></label>
        <label>Municipio<input name="municipio" defaultValue={v("municipio")} required /></label>
        <label>Provincia<input name="provincia" defaultValue={v("provincia")} required /></label>
      </div>
      <div className="grid">
        <label>Tu nombre<input name="nombre" defaultValue={v("nombre")} required /></label>
        <label>Email<input name="email" defaultValue={v("email")} type="email" required autoComplete="username" /></label>
        <label>Contraseña (mínimo 12 caracteres)<CampoContrasena name="contrasena" minLength={12} required autoComplete="new-password" /></label>
      </div>
      <div><button className="btn" disabled={enviando}>{enviando ? "Creando…" : "Crear empresa y entrar"}</button></div>
    </form>
  );
}
