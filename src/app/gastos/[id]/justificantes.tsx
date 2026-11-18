"use client";
import { useActionState, useTransition } from "react";
import { conArchivoPreparado } from "../reducir-imagen";

type Estado = { error?: string; ok?: string };

export function FormularioAdjuntar({ accion }: { accion: (p: Estado, f: FormData) => Promise<Estado> }) {
  const [estado, enviar] = useActionState(accion, {});
  const [preparando, iniciar] = useTransition();
  return (
    <form key={JSON.stringify(estado)} action={(f) => iniciar(async () => enviar(await conArchivoPreparado(f)))}
      style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
      <label style={{ flex: 1, minWidth: 220 }}>Adjuntar justificante (PDF o foto)
        <input type="file" name="archivo" required accept="application/pdf,image/*" />
      </label>
      <button className="btn" disabled={preparando}>{preparando ? "Subiendo…" : "Adjuntar"}</button>
      {estado.error && <div className="error" style={{ width: "100%" }}>{estado.error}</div>}
      {estado.ok && <div className="muted" style={{ width: "100%" }}>{estado.ok}</div>}
    </form>
  );
}

export function BotonQuitarJustificante({ accion }: { accion: (p: { error?: string }, f: FormData) => Promise<{ error?: string }> }) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  return (
    <details>
      <summary className="muted" style={{ cursor: "pointer", fontSize: 12 }}>Mover a la papelera</summary>
      <form action={enviar} style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <input name="motivo" required placeholder="Motivo" aria-label="Motivo" />
        <button className="btn btn-sec" disabled={enviando}>Confirmar</button>
      </form>
      {estado.error && <div className="error">{estado.error}</div>}
    </details>
  );
}
