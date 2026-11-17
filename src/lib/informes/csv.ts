/** CSV con punto y coma, coma decimal y BOM, como lo abre Excel en España. */
export const celda = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Evita que Excel interprete como fórmula un texto que empiece por =, +, - o @ (inyección CSV).
  const seguro = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(,\d+)?$/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
};
export const importeCsv = (c: number) => (c / 100).toFixed(2).replace(".", ",");
export const importeOVacio = (c: number) => (c ? importeCsv(c) : "");
export const fechaCsv = (iso: string | null | undefined) => (iso ? iso.split("-").reverse().join("/") : "");
export const pctCsv = (p: number | string) => String(Number(p)).replace(".", ",");

export function aCsv(cabecera: string[], filas: (string | number | null | undefined)[][]) {
  return "﻿" + [cabecera, ...filas].map((f) => f.map(celda).join(";")).join("\r\n") + "\r\n";
}

export function respuestaCsv(nombre: string, contenido: string) {
  return new Response(contenido, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export function fechaValida(s: string | null) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(s) ? s : null;
}
