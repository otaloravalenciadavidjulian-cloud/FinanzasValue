"use client";
import Link from "next/link";
import { useActionState } from "react";
import { entrar } from "./acciones";
import { CampoContrasena } from "@/app/campo-contrasena";

export default function Login() {
  const [estado, accion, enviando] = useActionState(entrar, {});
  return (
    <form key={estado.email ?? ""} action={accion} className="acceso-form">
      <h1>Bienvenido</h1>
      <p className="subtitulo">Inicia sesión para continuar.</p>
      {estado.error && <div className="error">{estado.error}</div>}
      <label>Email<input type="email" name="email" defaultValue={estado.email ?? ""} autoComplete="username" placeholder="tu@empresa.com" autoFocus required /></label>
      <label>Contraseña<CampoContrasena name="contrasena" autoComplete="current-password" placeholder="••••••••" required /></label>
      <button className="btn" disabled={enviando}>{enviando ? "Entrando…" : "Entrar"}</button>
      <p className="nota"><Link href="/login/recuperar">¿Has olvidado tu contraseña?</Link></p>
      <p className="nota">Conexión cifrada · Verificación en dos pasos disponible</p>
    </form>
  );
}
