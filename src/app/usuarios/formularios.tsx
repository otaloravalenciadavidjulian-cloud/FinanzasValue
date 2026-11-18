"use client";
import { useActionState } from "react";
import { accionUsuario, crearUsuario } from "./acciones";

type Rol = { codigo: string; nombre: string; descripcion: string };

function Resultado({ e }: { e: { error?: string; ok?: string; temporal?: string } }) {
  if (e.error) return <div className="error">{e.error}</div>;
  if (!e.ok) return null;
  return <div className="aviso">{e.ok}{e.temporal && <> <code style={{ fontSize: 15, fontWeight: 600 }}>{e.temporal}</code></>}</div>;
}

export function NuevoUsuario({ roles }: { roles: Rol[] }) {
  const [estado, accion, enviando] = useActionState(crearUsuario, {});
  return (
    <form action={accion} className="panel" style={{ display: "grid", gap: 10 }}>
      <b>Dar acceso a una persona</b>
      <Resultado e={estado} />
      <div className="grid">
        <label>Nombre<input name="nombre" required /></label>
        <label>Email<input name="email" type="email" required /></label>
        <label>Rol<select name="rol" defaultValue="contable">{roles.map((r) => <option key={r.codigo} value={r.codigo}>{r.nombre}: {r.descripcion}</option>)}</select></label>
      </div>
      <div><button className="btn" disabled={enviando}>{enviando ? "Creando…" : "Dar acceso"}</button></div>
    </form>
  );
}

export function AccionesUsuario({ id, rol, activa, mfa, propio, roles }: { id: string; rol: string; activa: boolean; mfa: boolean; propio: boolean; roles: Rol[] }) {
  const [estado, accion, enviando] = useActionState(accionUsuario.bind(null, id), {});
  if (propio) return <span className="muted" style={{ fontSize: 13 }}>Tú</span>;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <form action={accion} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <input type="hidden" name="accion" value="rol" />
        <select name="rol" defaultValue={rol} aria-label="Rol" disabled={!activa}>{roles.map((r) => <option key={r.codigo} value={r.codigo}>{r.nombre}</option>)}</select>
        <button className="btn btn-sec" disabled={enviando || !activa} style={{ padding: "4px 10px" }}>Cambiar rol</button>
      </form>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[
          activa ? ["desactivar", "Quitar acceso"] : ["activar", "Reactivar"],
          ...(activa ? [["contrasena", "Nueva contraseña"]] : []),
          ...(activa && mfa ? [["mfa", "Quitar doble factor"]] : []),
        ].map(([a, t]) => (
          <form key={a} action={accion}><input type="hidden" name="accion" value={a} />
            <button className="btn btn-sec" disabled={enviando} style={{ padding: "4px 10px", fontSize: 13 }}>{t}</button></form>
        ))}
      </div>
      <Resultado e={estado} />
    </div>
  );
}
