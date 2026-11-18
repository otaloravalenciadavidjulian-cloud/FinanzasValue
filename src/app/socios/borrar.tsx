"use client";
import { useActionState } from "react";
import type { EstadoSocios } from "./acciones";

export function BotonBorrar({ accion }: { accion: (p: EstadoSocios, f: FormData) => Promise<EstadoSocios> }) {
  const [e, a, enviando] = useActionState(accion, {});
  return (
    <form action={a} style={{ display: "inline" }}>
      <button className="btn btn-sec" style={{ padding: "2px 8px", fontSize: 12 }} disabled={enviando}>Borrar</button>
      {e.error && <span className="error" style={{ display: "block", fontSize: 12 }}>{e.error}</span>}
    </form>
  );
}
