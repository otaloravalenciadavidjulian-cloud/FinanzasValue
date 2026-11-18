"use client";
import { useActionState } from "react";
import { entrar } from "./acciones";

export default function Login() {
  const [estado, accion, enviando] = useActionState(entrar, {});
  return (
    <form key={estado.email ?? ""} action={accion} className="acceso-form">
      <h1>Bienvenido</h1>
      <p className="subtitulo">Inicia sesión para continuar.</p>
      {estado.error && <div className="error">{estado.error}</div>}
      <label>Email<input type="email" name="email" defaultValue={estado.email ?? ""} autoComplete="username" placeholder="tu@empresa.com" autoFocus required /></label>
      <label>Contraseña<input type="password" name="contrasena" autoComplete="current-password" placeholder="••••••••" required /></label>
      <button className="btn" disabled={enviando}>{enviando ? "Entrando…" : "Entrar"}</button>
      <p className="nota">Conexión cifrada · Verificación en dos pasos disponible</p>
    </form>
  );
}
