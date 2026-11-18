"use client";
import { useActionState } from "react";
import { guardar } from "../acciones";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const euros = (c: number) => (c ? (c / 100).toFixed(2).replace(".", ",") : "");

export function FormularioPresupuesto({ ejercicio, partidas, valores }: {
  ejercicio: number; partidas: { codigo: string; nombre: string }[]; valores: Record<string, number[]>;
}) {
  const [estado, accion, enviando] = useActionState(guardar.bind(null, ejercicio), {});
  return (
    <form action={accion} className="panel" style={{ overflowX: "auto" }}>
      {estado.error && <div className="error">{estado.error}</div>}
      <table style={{ minWidth: 1300 }}>
        <thead><tr><th style={{ position: "sticky", left: 0, background: "var(--surface)", zIndex: 1 }}>Partida (€ sin IVA)</th>{MESES.map((m) => <th key={m} className="num">{m}</th>)}</tr></thead>
        <tbody>
          {partidas.map((p) => (
            <tr key={p.codigo}>
              <td style={{ minWidth: 220, position: "sticky", left: 0, background: "var(--surface)", zIndex: 1, fontWeight: p.codigo === "ingresos" ? 600 : undefined }}>{p.nombre}</td>
              {valores[p.codigo].map((v, i) => (
                <td key={i}><input name={`${p.codigo}.${i + 1}`} defaultValue={euros(v)} inputMode="decimal" aria-label={`${p.nombre}, ${MESES[i]}`}
                  style={{ width: 80, textAlign: "right", padding: "4px 6px" }} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 12 }}><button className="btn" disabled={enviando}>{enviando ? "Guardando…" : "Guardar presupuesto"}</button></div>
    </form>
  );
}
