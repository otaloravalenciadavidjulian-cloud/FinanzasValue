/** Periodos y plazos de presentación de las autoliquidaciones trimestrales y anuales (régimen general). */

export type Trimestre = 1 | 2 | 3 | 4;

export interface Periodo { ejercicio: number; trimestre: Trimestre; desde: string; hasta: string; etiqueta: string }

export function periodoTrimestral(ejercicio: number, trimestre: Trimestre): Periodo {
  const mesInicio = (trimestre - 1) * 3 + 1;
  const ultimoDia = new Date(Date.UTC(ejercicio, mesInicio + 2, 0)).getUTCDate();
  const mm = (m: number) => String(m).padStart(2, "0");
  return {
    ejercicio, trimestre,
    desde: `${ejercicio}-${mm(mesInicio)}-01`,
    hasta: `${ejercicio}-${mm(mesInicio + 2)}-${ultimoDia}`,
    etiqueta: `${trimestre}T ${ejercicio}`,
  };
}

export function trimestreDe(fechaIso: string): { ejercicio: number; trimestre: Trimestre } {
  const [a, m] = fechaIso.split("-").map(Number);
  return { ejercicio: a, trimestre: (Math.floor((m - 1) / 3) + 1) as Trimestre };
}

/**
 * Plazo de los modelos trimestrales 303, 111 y 115: del 1 al 20 del mes siguiente al trimestre;
 * el cuarto trimestre, hasta el 30 de enero. Si el último día es sábado, domingo o festivo nacional
 * el plazo se alarga, pero aquí se da la fecha general: compruébala en el calendario de la AEAT.
 */
export function plazoTrimestral(ejercicio: number, trimestre: Trimestre): { desde: string; hasta: string } {
  if (trimestre === 4) return { desde: `${ejercicio + 1}-01-01`, hasta: `${ejercicio + 1}-01-30` };
  const mes = String(trimestre * 3 + 1).padStart(2, "0");
  return { desde: `${ejercicio}-${mes}-01`, hasta: `${ejercicio}-${mes}-20` };
}

/** Modelo 347: en febrero del año siguiente. */
export const plazo347 = (ejercicio: number) => ({ desde: `${ejercicio + 1}-02-01`, hasta: `${ejercicio + 1}-02-28` });

/** Trimestre cuya presentación está abierta o es la próxima, según la fecha de hoy. */
export function trimestreAPresentar(hoy: string): { ejercicio: number; trimestre: Trimestre } {
  const { ejercicio, trimestre } = trimestreDe(hoy);
  return trimestre === 1 ? { ejercicio: ejercicio - 1, trimestre: 4 } : { ejercicio, trimestre: (trimestre - 1) as Trimestre };
}
