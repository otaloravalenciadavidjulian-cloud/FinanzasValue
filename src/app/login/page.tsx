"use client";
import { useActionState } from "react";
import { entrar } from "./acciones";

export default function Login() {
  const [estado, accion, enviando] = useActionState(entrar, {});
  return (
    <form key={estado.email ?? ""} action={accion} className="panel" style={{ maxWidth: 380, display: "grid", gap: 12 }}>
      <h1>Iniciar sesión</h1>
      {estado.error && <div className="error">{estado.error}</div>}
      <label>Email<input type="email" name="email" defaultValue={estado.email ?? ""} autoComplete="username" required /></label>
      <label>Contraseña<input type="password" name="contrasena" autoComplete="current-password" required /></label>
      <div><button className="btn" disabled={enviando}>{enviando ? "Entrando…" : "Entrar"}</button></div>
    </form>
  );
}
