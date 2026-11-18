import type { Tx } from "@/db/cliente";
import { periodoTrimestral, plazoTrimestral, type Periodo, type Trimestre } from "./periodos";

/**
 * Borradores de las autoliquidaciones calculados con lo registrado en Value. Value no presenta
 * declaraciones: el resultado es orientativo y lo debe revisar la empresa o su asesor antes de
 * presentarlo en la sede electrónica de la AEAT.
 */

/** importeCent es un número de personas, no un importe, cuando esNumero es true. */
export interface Casilla { casilla: string; concepto: string; importeCent: number; tipo?: number; esNumero?: boolean }

export interface Modelo303 {
  periodo: Periodo;
  plazo: { desde: string; hasta: string };
  devengado: { tipo: number; baseCent: number; cuotaCent: number; casillas: [string, string, string] | null }[];
  rectificaciones: { baseCent: number; cuotaCent: number };
  totalDevengadoCent: number;
  deducible: { baseCent: number; cuotaCent: number };
  resultadoCent: number;
  avisos: string[];
}

/** Casillas del modelo 303 por tipo de IVA en el régimen general (base, tipo, cuota). */
const CASILLAS_TIPO: Record<number, [string, string, string]> = {
  4: ["01", "02", "03"],
  5: ["153", "154", "155"],
  10: ["04", "05", "06"],
  21: ["07", "08", "09"],
};

export async function calcular303(tx: Tx, ejercicio: number, trimestre: Trimestre): Promise<Modelo303> {
  const periodo = periodoTrimestral(ejercicio, trimestre);
  const avisos: string[] = [];
  // El IVA se devenga con la operación: se usa la fecha de operación si consta.
  const devengado = await tx<{ tipo: string; base: string; cuota: string }[]>`
    SELECT d.tipo_iva AS tipo, sum(d.base_cent) AS base, sum(d.cuota_cent) AS cuota
    FROM facturas f JOIN desglose_iva d ON d.factura_id = f.id
    WHERE NOT f.anulada AND f.tipo_factura NOT LIKE 'R%'
      AND coalesce(f.fecha_operacion, f.fecha_expedicion) BETWEEN ${periodo.desde}::date AND ${periodo.hasta}::date
    GROUP BY d.tipo_iva ORDER BY d.tipo_iva`;
  const [rect] = await tx<{ base: string; cuota: string }[]>`
    SELECT coalesce(sum(f.base_cent), 0) AS base, coalesce(sum(f.cuota_iva_cent), 0) AS cuota
    FROM facturas f WHERE NOT f.anulada AND f.tipo_factura LIKE 'R%'
      AND f.fecha_expedicion BETWEEN ${periodo.desde}::date AND ${periodo.hasta}::date`;
  const [ded] = await tx<{ base: string; cuota: string; sin_doc: number }[]>`
    SELECT coalesce(sum(d.base_cent) FILTER (WHERE d.cuota_deducible_cent <> 0), 0) AS base, coalesce(sum(d.cuota_deducible_cent), 0) AS cuota,
           count(DISTINCT g.id) FILTER (WHERE g.pendiente_documentacion)::int AS sin_doc
    FROM gastos g JOIN desglose_gasto d ON d.gasto_id = g.id
    WHERE g.borrado_en IS NULL AND g.fecha_expedicion BETWEEN ${periodo.desde}::date AND ${periodo.hasta}::date`;
  const lineas = devengado.map((d) => {
    const tipo = Number(d.tipo);
    if (tipo !== 0 && !CASILLAS_TIPO[tipo]) avisos.push(`Hay ventas al ${tipo} %, que no tienen casilla propia en el régimen general: revísalas.`);
    return { tipo, baseCent: Number(d.base), cuotaCent: Number(d.cuota), casillas: CASILLAS_TIPO[tipo] ?? null };
  });
  if (lineas.some((l) => l.tipo === 0)) avisos.push("Las ventas al 0 % (exentas o no sujetas) no van en estas casillas: decláralas en la casilla que corresponda a su causa.");
  if (ded.sin_doc > 0) avisos.push(`${ded.sin_doc} gastos del trimestre no tienen justificante: sin factura no se puede deducir su IVA.`);
  const totalDevengado = lineas.filter((l) => l.tipo !== 0).reduce((s, l) => s + l.cuotaCent, 0) + Number(rect.cuota);
  const deducible = { baseCent: Number(ded.base), cuotaCent: Number(ded.cuota) };
  return {
    periodo, plazo: plazoTrimestral(ejercicio, trimestre), devengado: lineas,
    rectificaciones: { baseCent: Number(rect.base), cuotaCent: Number(rect.cuota) },
    totalDevengadoCent: totalDevengado, deducible, resultadoCent: totalDevengado - deducible.cuotaCent, avisos,
  };
}

/** Casillas principales del 303 en el orden del formulario. */
export function casillas303(m: Modelo303): Casilla[] {
  const out: Casilla[] = [];
  for (const l of m.devengado) {
    if (!l.casillas) continue;
    out.push({ casilla: l.casillas[0], concepto: `Base imponible al ${l.tipo} %`, importeCent: l.baseCent },
      { casilla: l.casillas[2], concepto: `Cuota al ${l.tipo} %`, importeCent: l.cuotaCent, tipo: l.tipo });
  }
  if (m.rectificaciones.baseCent || m.rectificaciones.cuotaCent) {
    out.push({ casilla: "14", concepto: "Modificación de bases (rectificativas)", importeCent: m.rectificaciones.baseCent },
      { casilla: "15", concepto: "Modificación de cuotas (rectificativas)", importeCent: m.rectificaciones.cuotaCent });
  }
  out.push({ casilla: "27", concepto: "Total cuota devengada", importeCent: m.totalDevengadoCent },
    { casilla: "28", concepto: "Base de cuotas soportadas en operaciones interiores corrientes", importeCent: m.deducible.baseCent },
    { casilla: "29", concepto: "Cuotas soportadas deducibles en operaciones interiores corrientes", importeCent: m.deducible.cuotaCent },
    { casilla: "45", concepto: "Total a deducir", importeCent: m.deducible.cuotaCent },
    { casilla: "46", concepto: "Resultado del régimen general", importeCent: m.resultadoCent });
  return out;
}

export interface ModeloRetenciones {
  modelo: "111" | "115";
  periodo: Periodo;
  plazo: { desde: string; hasta: string };
  perceptores: number;
  baseCent: number;
  retencionesCent: number;
  casillas: Casilla[];
}

/**
 * Retenciones practicadas en las facturas recibidas: alquileres de locales (115) y profesionales y
 * demás actividades económicas (111). Las nóminas aún no se registran en Value: sus retenciones
 * (casillas 01 a 03 del 111) hay que añadirlas aparte.
 */
export async function calcularRetenciones(tx: Tx, modelo: "111" | "115", ejercicio: number, trimestre: Trimestre): Promise<ModeloRetenciones> {
  const periodo = periodoTrimestral(ejercicio, trimestre);
  const alquiler = modelo === "115";
  const [r] = await tx<{ perceptores: number; base: string; ret: string }[]>`
    SELECT count(DISTINCT coalesce(proveedor_id::text, id::text))::int AS perceptores, coalesce(sum(base_cent), 0) AS base, coalesce(sum(retencion_cent), 0) AS ret
    FROM gastos WHERE borrado_en IS NULL AND retencion_cent <> 0 AND (categoria = 'alquileres') = ${alquiler}
      AND fecha_expedicion BETWEEN ${periodo.desde}::date AND ${periodo.hasta}::date`;
  const base = Number(r.base), ret = Number(r.ret);
  const casillas: Casilla[] = alquiler
    ? [{ casilla: "01", concepto: "Número de perceptores", importeCent: r.perceptores, esNumero: true }, { casilla: "02", concepto: "Base de las retenciones", importeCent: base },
      { casilla: "03", concepto: "Retenciones e ingresos a cuenta", importeCent: ret }, { casilla: "05", concepto: "Resultado a ingresar", importeCent: ret }]
    : [{ casilla: "07", concepto: "Actividades económicas: número de perceptores", importeCent: r.perceptores, esNumero: true },
      { casilla: "08", concepto: "Actividades económicas: importe de las percepciones", importeCent: base },
      { casilla: "09", concepto: "Actividades económicas: importe de las retenciones", importeCent: ret },
      { casilla: "28", concepto: "Suma de retenciones", importeCent: ret }, { casilla: "30", concepto: "Resultado a ingresar", importeCent: ret }];
  return { modelo, periodo, plazo: plazoTrimestral(ejercicio, trimestre), perceptores: r.perceptores, baseCent: base, retencionesCent: ret, casillas };
}

export interface Declarado347 {
  terceroId: string;
  nif: string;
  nombre: string;
  clave: "A" | "B";
  totalCent: number;
  trimestres: [number, number, number, number];
}

/** Umbral del modelo 347: operaciones con un mismo tercero de más de 3.005,06 € en el año, IVA incluido. */
export const UMBRAL_347 = 300506;

/**
 * Modelo 347: clientes (clave B, ventas) y proveedores (clave A, compras) que superan el umbral.
 * Se excluyen las operaciones con retención (se declaran en otros modelos) y los tickets sin proveedor.
 */
export async function calcular347(tx: Tx, ejercicio: number): Promise<Declarado347[]> {
  const desde = `${ejercicio}-01-01`, hasta = `${ejercicio}-12-31`;
  const filas = await tx<{ tercero_id: string; nif: string; nombre: string; clave: "A" | "B"; t: number; importe: string }[]>`
    SELECT t.id AS tercero_id, t.nif, t.razon_social AS nombre, 'B' AS clave, extract(quarter FROM f.fecha_expedicion)::int AS t,
           sum(f.base_cent + f.cuota_iva_cent) AS importe
    FROM facturas f JOIN terceros t ON t.id = f.cliente_id
    WHERE NOT f.anulada AND f.retencion_cent = 0 AND f.fecha_expedicion BETWEEN ${desde}::date AND ${hasta}::date
    GROUP BY t.id, t.nif, t.razon_social, 5
    UNION ALL
    SELECT t.id, t.nif, t.razon_social, 'A', extract(quarter FROM g.fecha_expedicion)::int, sum(g.base_cent + g.cuota_iva_cent)
    FROM gastos g JOIN terceros t ON t.id = g.proveedor_id
    WHERE g.borrado_en IS NULL AND g.retencion_cent = 0 AND g.fecha_expedicion BETWEEN ${desde}::date AND ${hasta}::date
    GROUP BY t.id, t.nif, t.razon_social, 5`;
  const mapa = new Map<string, Declarado347>();
  for (const f of filas) {
    const k = `${f.tercero_id}|${f.clave}`;
    const d = mapa.get(k) ?? { terceroId: f.tercero_id, nif: f.nif, nombre: f.nombre, clave: f.clave, totalCent: 0, trimestres: [0, 0, 0, 0] };
    d.trimestres[f.t - 1] += Number(f.importe);
    d.totalCent += Number(f.importe);
    mapa.set(k, d);
  }
  return [...mapa.values()].filter((d) => d.totalCent > UMBRAL_347).sort((a, b) => a.clave.localeCompare(b.clave) || b.totalCent - a.totalCent);
}
