"use client";
import { useActionState } from "react";

type Estado = { error?: string };

export function BotonSugerencia({ accion, texto }: { accion: (p: Estado) => Promise<Estado>; texto: string }) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  return (
    <form action={enviar}>
      <button className="btn btn-sec" disabled={enviando} style={{ textAlign: "left", width: "100%" }}>{enviando ? "Conciliando…" : texto}</button>
      {estado.error && <div className="error" style={{ marginTop: 4 }}>{estado.error}</div>}
    </form>
  );
}

export function FormularioOtro({ accion, categorias }: { accion: (p: Estado, f: FormData) => Promise<Estado>; categorias: [string, string][] }) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  return (
    <form action={enviar} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <select name="categoria" required defaultValue="" aria-label="Tipo de movimiento">
        <option value="">Sin factura: elige tipo…</option>
        {categorias.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <input name="nota" placeholder="Nota (opcional)" aria-label="Nota" style={{ flex: 1, minWidth: 120 }} />
      <button className="btn btn-sec" disabled={enviando}>Marcar</button>
      {estado.error && <div className="error" style={{ width: "100%" }}>{estado.error}</div>}
    </form>
  );
}

export function FormularioDeshacer({ accion }: { accion: (p: Estado, f: FormData) => Promise<Estado> }) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  return (
    <details>
      <summary className="muted" style={{ cursor: "pointer", fontSize: 12 }}>Deshacer</summary>
      <form action={enviar} style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <input name="motivo" required placeholder="Motivo" aria-label="Motivo" />
        <button className="btn btn-sec" disabled={enviando}>Confirmar</button>
      </form>
      {estado.error && <div className="error">{estado.error}</div>}
    </details>
  );
}
