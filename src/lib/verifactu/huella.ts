import { createHash } from "node:crypto";
import { aDecimalAEAT } from "../fiscal/dinero";

/**
 * Huella (hash) de los registros de facturación según la Orden HAC/1177/2024 y el documento
 * técnico de la AEAT "Detalle de las especificaciones técnicas para generación de la huella".
 * SHA-256 sobre la cadena "campo=valor&campo=valor…", en hexadecimal y mayúsculas.
 */

export type TipoFacturaAEAT = "F1" | "F2" | "F3" | "R1" | "R2" | "R3" | "R4" | "R5";

export interface DatosAlta {
  nifEmisor: string;
  numSerie: string;
  /** Fecha de expedición en formato ISO (yyyy-mm-dd). */
  fechaExpedicion: string;
  tipoFactura: TipoFacturaAEAT;
  cuotaTotalCent: number;
  importeTotalCent: number;
  /** Huella del registro anterior de la cadena, vacía en el primer registro. */
  huellaAnterior: string;
  /** Fecha, hora y huso horario de generación del registro (ISO 8601 con desfase). */
  fechaHoraHuso: string;
}

export interface DatosAnulacion {
  nifEmisor: string;
  numSerie: string;
  fechaExpedicion: string;
  huellaAnterior: string;
  fechaHoraHuso: string;
}

/** yyyy-mm-dd a dd-mm-yyyy, formato de fecha de la AEAT. */
export function fechaAEAT(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Fecha no válida: ${iso}`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function cadenaAlta(d: DatosAlta): string {
  return [
    `IDEmisorFactura=${d.nifEmisor.trim()}`,
    `NumSerieFactura=${d.numSerie.trim()}`,
    `FechaExpedicionFactura=${fechaAEAT(d.fechaExpedicion)}`,
    `TipoFactura=${d.tipoFactura}`,
    `CuotaTotal=${aDecimalAEAT(d.cuotaTotalCent)}`,
    `ImporteTotal=${aDecimalAEAT(d.importeTotalCent)}`,
    `Huella=${d.huellaAnterior}`,
    `FechaHoraHusoGenRegistro=${d.fechaHoraHuso}`,
  ].join("&");
}

export function cadenaAnulacion(d: DatosAnulacion): string {
  return [
    `IDEmisorFacturaAnulada=${d.nifEmisor.trim()}`,
    `NumSerieFacturaAnulada=${d.numSerie.trim()}`,
    `FechaExpedicionFacturaAnulada=${fechaAEAT(d.fechaExpedicion)}`,
    `Huella=${d.huellaAnterior}`,
    `FechaHoraHusoGenRegistro=${d.fechaHoraHuso}`,
  ].join("&");
}

export function huella(cadena: string): string {
  return createHash("sha256").update(cadena, "utf8").digest("hex").toUpperCase();
}

/** Fecha y hora actual en Europe/Madrid con su desfase, p. ej. 2026-11-17T19:20:30+01:00. */
export function fechaHoraHusoMadrid(fecha: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23", timeZoneName: "longOffset",
  }).formatToParts(fecha);
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? "";
  const offset = p("timeZoneName").replace("GMT", "") || "+00:00";
  return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}:${p("second")}${offset}`;
}

export interface RegistroEncadenado {
  cadena: string;
  huella: string;
  huellaAnterior: string | null;
}

/** Comprueba que una secuencia de registros forma una cadena íntegra. */
export function verificarCadena(registros: RegistroEncadenado[]): { ok: true } | { ok: false; indice: number; motivo: string } {
  let anterior = "";
  for (let i = 0; i < registros.length; i++) {
    const r = registros[i];
    if ((r.huellaAnterior ?? "") !== anterior) return { ok: false, indice: i, motivo: "La huella anterior no coincide" };
    if (!r.cadena.includes(`&Huella=${anterior}&`)) return { ok: false, indice: i, motivo: "La cadena no contiene la huella anterior" };
    if (huella(r.cadena) !== r.huella) return { ok: false, indice: i, motivo: "La huella no corresponde a los datos" };
    anterior = r.huella;
  }
  return { ok: true };
}
