import { redondear } from "./dinero";

/** Importe con IVA de una base, con el mismo redondeo que la factura. */
export function conIva(baseCent: number, tipoIva: number): number {
  return baseCent + redondear((baseCent * tipoIva) / 100);
}

/**
 * Base imponible a partir de un importe con IVA incluido. Busca, cerca del cociente exacto,
 * la base cuyo IVA redondeado suma exactamente el importe pedido; si no existe (algún céntimo
 * no se puede alcanzar), devuelve la más cercana.
 */
export function baseDesdeConIva(totalCent: number, tipoIva: number): number {
  const aprox = redondear((totalCent * 100) / (100 + tipoIva));
  for (const d of [0, -1, 1, -2, 2]) if (conIva(aprox + d, tipoIva) === totalCent) return aprox + d;
  return aprox;
}
