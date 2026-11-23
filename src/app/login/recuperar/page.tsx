"use client";
import Link from "next/link";
import { useActionState } from "react";
import { CampoContrasena } from "@/app/campo-contrasena";
import { recuperar } from "./acciones";

export default function Recuperar() {
  const [estado, accion, enviando] = useActionState(recuperar, {});
  if (estado.ok) {
    return (
      <div className="acceso-form">
        <h1>Listo</h1>
        <div className="aviso">{estado.ok}</div>
        <Link className="btn" href="/login" style={{ textAlign: "center", lineHeight: "46px", padding: 0 }}>Ir a iniciar sesión</Link>
      </div>
    );
  }
  return (
    <form key={estado.email ?? ""} action={accion} className="acceso-form">
      <h1>Recuperar contraseña</h1>
      <p className="subtitulo">Solo para administradores. Si no lo eres, pide a tu administrador una contraseña nueva desde Usuarios.</p>
      {estado.error && <div className="error">{estado.error}</div>}
      <label>Email<input type="email" name="email" defaultValue={estado.email ?? ""} autoComplete="username" placeholder="tu@empresa.com" required /></label>
      <label>Código de recuperación<CampoContrasena name="codigo" autoComplete="off" required /></label>
      <p className="nota" style={{ textAlign: "left", marginTop: -8 }}>Es el valor de SETUP_TOKEN en Netlify: Site configuration → Environment variables.</p>
      <label>Contraseña nueva (mínimo 12 caracteres)<CampoContrasena name="nueva" autoComplete="new-password" minLength={12} required /></label>
      <label>Repite la contraseña nueva<CampoContrasena name="repetir" autoComplete="new-password" minLength={12} required /></label>
      <button className="btn" disabled={enviando}>{enviando ? "Guardando…" : "Cambiar contraseña"}</button>
      <p className="nota"><Link href="/login">Volver a iniciar sesión</Link></p>
    </form>
  );
}
