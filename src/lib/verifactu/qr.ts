import { aDecimalAEAT } from "../fiscal/dinero";
import { fechaAEAT } from "./huella";

/** URL del QR tributario (Orden HAC/1177/2024, art. 21) para el cotejo de la factura en la AEAT. */
const BASE = {
  produccion: "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR",
  pruebas: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR",
} as const;

export type EntornoAEAT = keyof typeof BASE;

export function urlQR(p: { nifEmisor: string; numSerie: string; fechaExpedicion: string; importeTotalCent: number; entorno: EntornoAEAT }): string {
  const q = new URLSearchParams({
    nif: p.nifEmisor,
    numserie: p.numSerie,
    fecha: fechaAEAT(p.fechaExpedicion),
    importe: aDecimalAEAT(p.importeTotalCent),
  });
  return `${BASE[p.entorno]}?${q.toString()}`;
}

/** Leyenda junto al QR en sistemas VERI*FACTU: "VERI*FACTU" o este texto (Orden HAC/1177/2024). */
export const LEYENDA_VERIFACTU = "Factura verificable en la sede electrónica de la AEAT";
