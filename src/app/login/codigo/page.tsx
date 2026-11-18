"use client";
import Link from "next/link";
import { useActionState } from "react";
import { confirmarCodigo } from "../acciones";

export default function Codigo() {
  const [estado, accion, enviando] = useActionState(confirmarCodigo, {});
  return (
    <form action={accion} className="acceso-form">
      <h1>Verificación en dos pasos</h1>
      <p className="subtitulo">Escribe el código de 6 cifras de tu aplicación de autenticación. Si no tienes el móvil, usa uno de tus códigos de recuperación.</p>
      {estado.error && <div className="error">{estado.error}</div>}
      <label>Código<input name="codigo" inputMode="numeric" autoComplete="one-time-code" autoFocus required maxLength={20} /></label>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button className="btn" disabled={enviando}>{enviando ? "Comprobando…" : "Continuar"}</button>
        <Link href="/login" className="muted" style={{ fontSize: 13 }}>Volver</Link>
      </div>
    </form>
  );
}
