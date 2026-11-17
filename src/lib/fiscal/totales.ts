import { redondear } from "./dinero";

export const TIPOS_IVA = [21, 10, 5, 4, 2, 0] as const;

export interface LineaFactura {
  concepto: string;
  /** Cantidad, admite decimales (horas, kilos…). Negativa en rectificativas por diferencias. */
  cantidad: number;
  precioUnitarioCent: number;
  descuentoPct?: number;
  tipoIva: number;
  /** Obligatoria al 0 %: causa de exención, no sujeción o inversión del sujeto pasivo. */
  causaIva?: string | null;
}

export interface DesgloseIva {
  tipoIva: number;
  causaIva?: string | null;
  baseCent: number;
  cuotaCent: number;
}

export interface Totales {
  lineas: { baseCent: number }[];
  desglose: DesgloseIva[];
  baseCent: number;
  cuotaIvaCent: number;
  retencionCent: number;
  totalCent: number;
}

/**
 * Calcula bases, cuotas por tipo de IVA, retención y total.
 * La cuota se calcula sobre la base agregada de cada tipo (art. 6 RD 1619/2012 exige
 * consignar base, tipo y cuota por cada tipo impositivo).
 */
export function calcularTotales(lineas: LineaFactura[], retencionPct = 0): Totales {
  if (!lineas.length) throw new Error("La factura necesita al menos una línea");
  const porTipo = new Map<string, { tipoIva: number; causaIva: string | null; baseCent: number }>();
  const ls = lineas.map((l) => {
    if (!TIPOS_IVA.includes(l.tipoIva as (typeof TIPOS_IVA)[number])) {
      throw new Error(`Tipo de IVA no admitido: ${l.tipoIva}`);
    }
    const causa = l.tipoIva === 0 ? (l.causaIva || null) : null;
    if (l.tipoIva === 0 && !causa) throw new Error("Indica por qué la línea va sin IVA (exenta, no sujeta o inversión del sujeto pasivo)");
    if (l.tipoIva !== 0 && l.causaIva) throw new Error("La causa de exención solo se indica en líneas al 0 %");
    const dto = l.descuentoPct ?? 0;
    if (dto < 0 || dto > 100) throw new Error("El descuento debe estar entre 0 y 100");
    const baseCent = redondear(l.cantidad * l.precioUnitarioCent * (1 - dto / 100));
    const clave = `${l.tipoIva}|${causa ?? ""}`;
    const g = porTipo.get(clave) ?? { tipoIva: l.tipoIva, causaIva: causa, baseCent: 0 };
    g.baseCent += baseCent;
    porTipo.set(clave, g);
    return { baseCent };
  });
  const desglose = [...porTipo.values()]
    .sort((a, b) => b.tipoIva - a.tipoIva || (a.causaIva ?? "").localeCompare(b.causaIva ?? ""))
    .map((g) => ({ tipoIva: g.tipoIva, ...(g.causaIva ? { causaIva: g.causaIva } : {}), baseCent: g.baseCent, cuotaCent: redondear((g.baseCent * g.tipoIva) / 100) }));
  const baseCent = desglose.reduce((s, d) => s + d.baseCent, 0);
  const cuotaIvaCent = desglose.reduce((s, d) => s + d.cuotaCent, 0);
  const retencionCent = redondear((baseCent * retencionPct) / 100);
  return { lineas: ls, desglose, baseCent, cuotaIvaCent, retencionCent, totalCent: baseCent + cuotaIvaCent - retencionCent };
}
