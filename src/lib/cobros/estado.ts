/**
 * Estado de cobro (o de pago) de una factura a partir de su total, lo cobrado y el vencimiento.
 * Sirve igual para rectificativas negativas: lo pendiente lleva el signo del total.
 */
export type EstadoCobro = "anulada" | "cobrada" | "parcial" | "vencida" | "pendiente";

export function estadoCobro(p: { totalCent: number; cobradoCent: number; vencimiento?: string | null; hoy: string; anulada?: boolean }): EstadoCobro {
  if (p.anulada) return "anulada";
  const pendiente = p.totalCent - p.cobradoCent;
  if (pendiente === 0 || Math.sign(pendiente) !== Math.sign(p.totalCent)) return "cobrada";
  if (p.vencimiento && p.vencimiento < p.hoy) return "vencida";
  return p.cobradoCent !== 0 ? "parcial" : "pendiente";
}

export const ETIQUETA_COBRO: Record<EstadoCobro, string> = {
  anulada: "Anulada", cobrada: "Cobrada", parcial: "Cobro parcial", vencida: "Vencida", pendiente: "Pendiente",
};
export const ETIQUETA_PAGO: Record<EstadoCobro, string> = {
  anulada: "En la papelera", cobrada: "Pagada", parcial: "Pago parcial", vencida: "Vencida", pendiente: "Pendiente",
};

/**
 * Comprueba que un nuevo cobro deja lo cobrado entre 0 y el total (con el signo del total).
 * Devuelve el mensaje de error o null.
 */
export function validarImporteCobro(totalCent: number, cobradoCent: number, importeCent: number): string | null {
  if (!Number.isInteger(importeCent) || importeCent === 0) return "El importe no puede ser cero";
  const nuevo = cobradoCent + importeCent;
  const [min, max] = totalCent >= 0 ? [0, totalCent] : [totalCent, 0];
  if (nuevo > max || nuevo < min) {
    const pendiente = totalCent - cobradoCent;
    return `El importe supera lo pendiente (${(pendiente / 100).toFixed(2).replace(".", ",")} €)`;
  }
  return null;
}

/** Fecha de hoy en Madrid (yyyy-mm-dd). */
export function hoyMadrid(fecha: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(fecha);
}
