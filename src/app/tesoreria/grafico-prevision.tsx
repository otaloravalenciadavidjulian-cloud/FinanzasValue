import { formatearEuros } from "@/lib/fiscal/dinero";
import type { Prevision } from "@/lib/tesoreria/prevision";

const corta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const compacto = (c: number) => {
  const e = c / 100;
  return Math.abs(e) >= 1000 ? `${(e / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} mil €` : `${Math.round(e)} €`;
};

/** Saldo previsto al final de cada semana. Una sola serie: el título la nombra y no lleva leyenda. */
export function GraficoPrevision({ p }: { p: Prevision }) {
  const W = 760, H = 220, izq = 64, der = 16, arriba = 12, abajo = 28;
  const valores = [p.saldoInicialCent, ...p.semanas.map((s) => s.saldoFinalCent)];
  let min = Math.min(0, ...valores), max = Math.max(0, ...valores);
  if (min === max) max = min + 100;
  const margen = (max - min) * 0.08;
  min -= min < 0 ? margen : 0;
  max += margen;
  const x = (i: number) => izq + (i * (W - izq - der)) / (valores.length - 1);
  const y = (v: number) => arriba + ((max - v) * (H - arriba - abajo)) / (max - min);
  const puntos = valores.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const ticks = [max - margen, (max - margen + min) / 2, min].map((v) => Math.round(v));
  const etiquetas = ["Hoy", ...p.semanas.map((s) => corta(s.hasta))];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Saldo previsto al final de cada semana" style={{ width: "100%", height: "auto", display: "block" }}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={izq} x2={W - der} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
          <text x={izq - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{compacto(t)}</text>
        </g>
      ))}
      {min < 0 && <line x1={izq} x2={W - der} y1={y(0)} y2={y(0)} stroke="var(--muted)" strokeWidth={1} strokeDasharray="4 3" />}
      <polyline points={puntos} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
      {valores.map((v, i) => (
        <g key={i}>
          {/* Zona de puntero más grande que el punto, con el valor como tooltip. */}
          <circle cx={x(i)} cy={y(v)} r={12} fill="transparent">
            <title>{`${i === 0 ? "Hoy" : `Semana hasta el ${corta(p.semanas[i - 1].hasta)}`}: ${formatearEuros(v)}`}</title>
          </circle>
          <circle cx={x(i)} cy={y(v)} r={v < 0 ? 4.5 : 4} fill={v < 0 ? "var(--bad)" : "var(--accent)"} stroke="var(--surface)" strokeWidth={2} pointerEvents="none" />
          {i % 2 === 0 && <text x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">{etiquetas[i]}</text>}
        </g>
      ))}
    </svg>
  );
}

/** Vista de tabla con los mismos datos. */
export function TablaPrevision({ p }: { p: Prevision }) {
  return (
    <table>
      <thead><tr><th>Semana</th><th className="num">Cobros</th><th className="num">Pagos</th><th className="num">Recurrentes (estimado)</th><th className="num">Saldo final</th></tr></thead>
      <tbody>{p.semanas.map((s, i) => (
        <tr key={s.desde}>
          <td>{corta(s.desde)} – {corta(s.hasta)}{i === 0 && (p.cobrosVencidosCent || p.pagosVencidosCent) ? " (incluye lo vencido)" : ""}</td>
          <td className="num">{formatearEuros(s.cobrosCent)}</td>
          <td className="num">{formatearEuros(-s.pagosCent)}</td>
          <td className="num">{formatearEuros(-s.recurrentesCent)}</td>
          <td className="num" style={{ color: s.saldoFinalCent < 0 ? "var(--bad)" : undefined }}><b>{formatearEuros(s.saldoFinalCent)}</b></td>
        </tr>
      ))}</tbody>
    </table>
  );
}
