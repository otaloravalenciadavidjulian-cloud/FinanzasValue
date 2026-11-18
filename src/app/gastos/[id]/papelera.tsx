"use client";
import { useActionState } from "react";

export function BotonPapelera({ accion }: { accion: (p: { error?: string }, f: FormData) => Promise<{ error?: string }> }) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  return (
    <form action={enviar} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
      <label style={{ flex: 1, minWidth: 220 }}>Motivo para mandarlo a la papelera<input name="motivo" required placeholder="p. ej. registrado dos veces" /></label>
      <button className="btn btn-sec" disabled={enviando}>Mover a la papelera</button>
      {estado.error && <div className="error" style={{ width: "100%" }}>{estado.error}</div>}
    </form>
  );
}

export function BotonRestaurar({ accion }: { accion: (p: { error?: string }) => Promise<{ error?: string }> }) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  return (
    <form action={enviar}>
      <button className="btn" disabled={enviando}>Restaurar</button>
      {estado.error && <div className="error" style={{ marginTop: 8 }}>{estado.error}</div>}
    </form>
  );
}
