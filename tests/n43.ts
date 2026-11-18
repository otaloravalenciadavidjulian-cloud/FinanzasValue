/** Genera extractos Norma 43 de prueba con el formato de 80 caracteres por registro. */
export interface MovPrueba { fecha: string; importeCent: number; concepto?: string; comun?: string; texto?: string }

const aammdd = (iso: string) => iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
const imp = (c: number) => String(Math.abs(c)).padStart(14, "0");
const clave = (c: number) => (c < 0 ? "1" : "2");
const fila = (s: string) => { if (s.length > 80) throw new Error(`registro de ${s.length}`); return s.padEnd(80, " "); };

export function extractoN43(o: { entidad?: string; oficina?: string; cuenta?: string; desde: string; hasta: string; saldoInicialCent: number; movimientos: MovPrueba[];
  saldoFinalCent?: number; totalHaberCent?: number }): string {
  const ent = o.entidad ?? "2100", ofi = o.oficina ?? "0418", cta = o.cuenta ?? "0200051332";
  const out: string[] = [];
  out.push(fila(`11${ent}${ofi}${cta}${aammdd(o.desde)}${aammdd(o.hasta)}${clave(o.saldoInicialCent)}${imp(o.saldoInicialCent)}9783EMPRESA DE PRUEBA SL`));
  for (const m of o.movimientos) {
    out.push(fila(`22    ${ofi}${aammdd(m.fecha)}${aammdd(m.fecha)}${m.comun ?? "04"}000${clave(m.importeCent)}${imp(m.importeCent)}0000000000${"REF1".padEnd(12)}${"REF2".padEnd(16)}`));
    if (m.texto) out.push(fila(`2301${m.texto.padEnd(38).slice(0, 38)}${(m.concepto ?? "").padEnd(38).slice(0, 38)}`));
  }
  const debe = o.movimientos.filter((m) => m.importeCent < 0), haber = o.movimientos.filter((m) => m.importeCent > 0);
  const sum = (ms: MovPrueba[]) => ms.reduce((s, m) => s + Math.abs(m.importeCent), 0);
  const saldoFinal = o.saldoFinalCent ?? o.saldoInicialCent - sum(debe) + sum(haber);
  out.push(fila(`33${ent}${ofi}${cta}${String(debe.length).padStart(5, "0")}${imp(sum(debe))}${String(haber.length).padStart(5, "0")}${imp(o.totalHaberCent ?? sum(haber))}${clave(saldoFinal)}${imp(saldoFinal)}978`));
  out.push(fila(`88${"9".repeat(18)}${String(out.length + 1).padStart(6, "0")}`));
  return out.join("\r\n") + "\r\n";
}
