"use client";
import Link from "next/link";
import { useActionState } from "react";
import { apagarDobleFactor, confirmarDobleFactor, nuevaContrasena } from "./acciones";

export function CambioContrasena() {
  const [e, accion, enviando] = useActionState(nuevaContrasena, {});
  return (
    <form action={accion} style={{ display: "grid", gap: 10, maxWidth: 420 }}>
      {e.error && <div className="error">{e.error}</div>}
      {e.ok && <div className="aviso">{e.ok}</div>}
      <label>Contraseña actual<input type="password" name="actual" autoComplete="current-password" required /></label>
      <label>Nueva contraseña (al menos 12 caracteres)<input type="password" name="nueva" autoComplete="new-password" minLength={12} required /></label>
      <label>Repite la nueva<input type="password" name="repetir" autoComplete="new-password" minLength={12} required /></label>
      <div><button className="btn" disabled={enviando}>{enviando ? "Guardando…" : "Cambiar contraseña"}</button></div>
    </form>
  );
}

export function ConfirmarDobleFactor({ qr, secreto }: { qr: string; secreto: string }) {
  const [e, accion, enviando] = useActionState(confirmarDobleFactor, {});
  if (e.codigos) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <div className="aviso">Doble factor activado. Guarda estos códigos de recuperación en un lugar seguro: cada uno sirve una vez para entrar si pierdes el móvil. No se volverán a mostrar.</div>
        <pre style={{ fontSize: 15, columns: 2, maxWidth: 360 }}>{e.codigos.join("\n")}</pre>
        <div><Link className="btn" href="/cuenta">Hecho</Link></div>
      </div>
    );
  }
  return (
    <form action={accion} style={{ display: "grid", gap: 10, maxWidth: 420 }}>
      <ol style={{ margin: 0, paddingLeft: 18 }}>
        <li>Abre tu aplicación de autenticación (Google Authenticator, Microsoft Authenticator, 1Password…) y escanea este código.</li>
        <li>Escribe el código de 6 cifras que te muestra.</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="Código QR para la aplicación de autenticación" width={200} height={200} style={{ background: "#fff", padding: 8, borderRadius: 6 }} />
      <div className="muted" style={{ fontSize: 13 }}>Si no puedes escanearlo, introduce esta clave: <code>{secreto.replace(/(.{4})/g, "$1 ").trim()}</code></div>
      {e.error && <div className="error">{e.error}</div>}
      <label>Código<input name="codigo" inputMode="numeric" autoComplete="one-time-code" pattern="\d{3}\s?\d{3}" required /></label>
      <div><button className="btn" disabled={enviando}>{enviando ? "Comprobando…" : "Activar"}</button></div>
    </form>
  );
}

export function DesactivarDobleFactor() {
  const [e, accion, enviando] = useActionState(apagarDobleFactor, {});
  return (
    <form action={accion} style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
      <label>Tu contraseña<input type="password" name="contrasena" autoComplete="current-password" required /></label>
      <button className="btn btn-sec" disabled={enviando}>Desactivar doble factor</button>
      {e.error && <div className="error">{e.error}</div>}
    </form>
  );
}
