import type { Tx } from "@/db/cliente";
import { CATEGORIAS_GASTO } from "@/lib/gastos/categorias";
import { cuentaOperacion, TIPOS_OPERACION, type TipoOperacion } from "@/lib/socios/socios";

/**
 * Contabilidad según el Plan General de Contable (RD 1514/2007) generada a partir de los documentos:
 * facturas emitidas, gastos, cobros, pagos y movimientos bancarios conciliados sin factura. Los
 * asientos no se teclean: se derivan siempre de lo registrado, así que cuadran por construcción.
 */

export const CUENTAS: Record<string, string> = {
  "100": "Capital social",
  "118": "Aportaciones de socios o propietarios",
  "129": "Resultado del ejercicio",
  "163": "Otras deudas a largo plazo con partes vinculadas",
  "400": "Proveedores",
  "410": "Acreedores por prestaciones de servicios",
  "430": "Clientes",
  "465": "Remuneraciones pendientes de pago",
  "472": "H.P., IVA soportado",
  "473": "H.P., retenciones y pagos a cuenta",
  "475": "H.P., acreedora por conceptos fiscales",
  "4751": "H.P., acreedora por retenciones practicadas",
  "476": "Organismos de la Seguridad Social, acreedores",
  "477": "H.P., IVA repercutido",
  "5133": "Otras deudas a corto plazo con otras partes vinculadas",
  "520": "Deudas a corto plazo con entidades de crédito",
  "551": "Cuenta corriente con socios y administradores",
  "555": "Partidas pendientes de aplicación",
  "572": "Bancos e instituciones de crédito c/c vista, euros",
  "600": "Compras de mercaderías",
  "621": "Arrendamientos y cánones",
  "622": "Reparaciones y conservación",
  "623": "Servicios de profesionales independientes",
  "624": "Transportes",
  "625": "Primas de seguros",
  "626": "Servicios bancarios y similares",
  "627": "Publicidad, propaganda y relaciones públicas",
  "628": "Suministros",
  "629": "Otros servicios",
  "631": "Otros tributos",
  "640": "Sueldos y salarios",
  "642": "Seguridad Social a cargo de la empresa",
  "662": "Intereses de deudas",
  "705": "Prestaciones de servicios",
  "769": "Otros ingresos financieros",
};

export interface Apunte { cuenta: string; debeCent: number; haberCent: number; concepto: string }
export interface Asiento {
  fecha: string;
  /** Orden estable dentro del día: documento de origen. */
  origen: { tipo: "factura" | "gasto" | "cobro" | "pago" | "banco" | "socio"; id: string };
  concepto: string;
  apuntes: Apunte[];
}

/** Apunte en el lado que toca: un importe negativo en el debe pasa al haber (rectificativas, devoluciones). */
function apunte(cuenta: string, debe: number, haber: number, concepto: string): Apunte | null {
  const neto = debe - haber;
  if (neto === 0) return null;
  return neto > 0 ? { cuenta, debeCent: neto, haberCent: 0, concepto } : { cuenta, debeCent: 0, haberCent: -neto, concepto };
}
const asiento = (fecha: string, origen: Asiento["origen"], concepto: string, partes: (Apunte | null)[]): Asiento =>
  ({ fecha, origen, concepto, apuntes: partes.filter((a): a is Apunte => a !== null) });

const cuentaCategoria = (c: string) => CATEGORIAS_GASTO.find((x) => x.codigo === c)?.cuenta ?? "629";
/** Las compras de mercaderías van a proveedores (400); los servicios, a acreedores (410). */
const cuentaAcreedor = (c: string) => (c === "compras" ? "400" : "410");

/** Cuentas de los movimientos del banco conciliados sin factura. */
const CUENTA_OTRO: Record<string, string> = {
  comisiones: "626", intereses: "662", impuestos: "475", seguridad_social: "476", nominas: "465",
  prestamo: "520", traspaso: "572", socios: "551", otros: "555",
};

export async function generarAsientos(tx: Tx, desde: string, hasta: string): Promise<Asiento[]> {
  const out: Asiento[] = [];

  const facturas = await tx<{ id: string; fecha: string; num_serie: string; cliente: string | null; base: string; iva: string; ret: string; total: string }[]>`
    SELECT id, to_char(fecha_expedicion,'YYYY-MM-DD') AS fecha, num_serie, destinatario->>'razon_social' AS cliente,
           base_cent AS base, cuota_iva_cent AS iva, retencion_cent AS ret, total_cent AS total
    FROM facturas WHERE NOT anulada AND fecha_expedicion BETWEEN ${desde}::date AND ${hasta}::date`;
  for (const f of facturas) {
    const c = `Factura ${f.num_serie}${f.cliente ? ` · ${f.cliente}` : ""}`;
    out.push(asiento(f.fecha, { tipo: "factura", id: f.id }, c, [
      apunte("430", Number(f.total), 0, c), apunte("473", Number(f.ret), 0, c),
      apunte("705", 0, Number(f.base), c), apunte("477", 0, Number(f.iva), c),
    ]));
  }

  const gastos = await tx<{ id: string; fecha: string; numero: string | null; descripcion: string; proveedor: string | null; categoria: string;
    base: string; iva: string; deducible: string; ret: string; total: string }[]>`
    SELECT g.id, to_char(g.fecha_expedicion,'YYYY-MM-DD') AS fecha, g.numero, g.descripcion, t.razon_social AS proveedor, g.categoria,
           g.base_cent AS base, g.cuota_iva_cent AS iva, g.cuota_deducible_cent AS deducible, g.retencion_cent AS ret, g.total_cent AS total
    FROM gastos g LEFT JOIN terceros t ON t.id = g.proveedor_id
    WHERE g.borrado_en IS NULL AND g.fecha_expedicion BETWEEN ${desde}::date AND ${hasta}::date`;
  for (const g of gastos) {
    const c = `${g.numero ? `Factura ${g.numero}` : g.descripcion}${g.proveedor ? ` · ${g.proveedor}` : ""}`;
    const noDeducible = Number(g.iva) - Number(g.deducible);
    out.push(asiento(g.fecha, { tipo: "gasto", id: g.id }, c, [
      // El IVA no deducible es más gasto.
      apunte(cuentaCategoria(g.categoria), Number(g.base) + noDeducible, 0, c), apunte("472", Number(g.deducible), 0, c),
      apunte(cuentaAcreedor(g.categoria), 0, Number(g.total), c), apunte("4751", 0, Number(g.ret), c),
    ]));
  }

  const cobros = await tx<{ id: string; fecha: string; num_serie: string; importe: string }[]>`
    SELECT c.id, to_char(c.fecha,'YYYY-MM-DD') AS fecha, f.num_serie, c.importe_cent AS importe
    FROM cobros c JOIN facturas f ON f.id = c.factura_id WHERE c.fecha BETWEEN ${desde}::date AND ${hasta}::date`;
  for (const c of cobros) {
    const t = `Cobro factura ${c.num_serie}`;
    out.push(asiento(c.fecha, { tipo: "cobro", id: c.id }, t, [apunte("572", Number(c.importe), 0, t), apunte("430", 0, Number(c.importe), t)]));
  }

  const pagos = await tx<{ id: string; fecha: string; numero: string | null; descripcion: string; categoria: string; importe: string }[]>`
    SELECT p.id, to_char(p.fecha,'YYYY-MM-DD') AS fecha, g.numero, g.descripcion, g.categoria, p.importe_cent AS importe
    FROM pagos p JOIN gastos g ON g.id = p.gasto_id WHERE p.fecha BETWEEN ${desde}::date AND ${hasta}::date`;
  for (const p of pagos) {
    const t = `Pago ${p.numero ? `factura ${p.numero}` : p.descripcion}`;
    out.push(asiento(p.fecha, { tipo: "pago", id: p.id }, t, [apunte(cuentaAcreedor(p.categoria), Number(p.importe), 0, t), apunte("572", 0, Number(p.importe), t)]));
  }

  const otros = await tx<{ id: string; fecha: string; descripcion: string; categoria: string; importe: string }[]>`
    SELECT m.id, to_char(m.fecha_operacion,'YYYY-MM-DD') AS fecha, m.descripcion, k.categoria, m.importe_cent AS importe
    FROM conciliaciones k JOIN movimientos_bancarios m ON m.id = k.movimiento_id
    WHERE k.deshecha_en IS NULL AND k.tipo = 'otro' AND k.categoria <> 'traspaso'
      AND m.fecha_operacion BETWEEN ${desde}::date AND ${hasta}::date`;
  for (const o of otros) {
    const importe = Number(o.importe);
    // Los intereses cobrados son ingreso (769); los pagados, gasto (662).
    const contra = o.categoria === "intereses" && importe > 0 ? "769" : CUENTA_OTRO[o.categoria] ?? "555";
    out.push(asiento(o.fecha, { tipo: "banco", id: o.id }, o.descripcion, [apunte("572", importe, 0, o.descripcion), apunte(contra, 0, importe, o.descripcion)]));
  }

  // Financiación de los socios: fondos propios o deuda, nunca ingresos.
  const socios = await tx<{ id: string; fecha: string; tipo: TipoOperacion; plazo: "corto" | "largo" | null; prestamo_plazo: "corto" | "largo" | null; socio: string; importe: string }[]>`
    SELECT o.id, to_char(o.fecha,'YYYY-MM-DD') AS fecha, o.tipo, o.plazo, p.plazo AS prestamo_plazo, s.nombre AS socio, o.importe_cent AS importe
    FROM operaciones_socios o JOIN socios s ON s.id = o.socio_id LEFT JOIN operaciones_socios p ON p.id = o.prestamo_id
    WHERE o.borrado_en IS NULL AND o.fecha BETWEEN ${desde}::date AND ${hasta}::date`;
  for (const o of socios) {
    const t = `${TIPOS_OPERACION[o.tipo]} · ${o.socio}`;
    const cuenta = cuentaOperacion(o.tipo, o.plazo ?? o.prestamo_plazo);
    const importe = Number(o.importe);
    out.push(asiento(o.fecha, { tipo: "socio", id: o.id }, t, o.tipo === "devolucion"
      ? [apunte(cuenta, importe, 0, t), apunte("572", 0, importe, t)]
      : [apunte("572", importe, 0, t), apunte(cuenta, 0, importe, t)]));
  }

  const orden = { factura: 0, gasto: 1, cobro: 2, pago: 3, banco: 4, socio: 5 };
  return out.filter((a) => a.apuntes.length > 0)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || orden[a.origen.tipo] - orden[b.origen.tipo] || a.origen.id.localeCompare(b.origen.id));
}

export interface SaldoCuenta { cuenta: string; nombre: string; debeCent: number; haberCent: number; saldoCent: number }

/** Balance de sumas y saldos. Saldo positivo: deudor. */
export function sumasYSaldos(asientos: Asiento[]): SaldoCuenta[] {
  const m = new Map<string, SaldoCuenta>();
  for (const a of asientos) for (const p of a.apuntes) {
    const s = m.get(p.cuenta) ?? { cuenta: p.cuenta, nombre: CUENTAS[p.cuenta] ?? "", debeCent: 0, haberCent: 0, saldoCent: 0 };
    s.debeCent += p.debeCent;
    s.haberCent += p.haberCent;
    s.saldoCent = s.debeCent - s.haberCent;
    m.set(p.cuenta, s);
  }
  return [...m.values()].sort((a, b) => a.cuenta.localeCompare(b.cuenta));
}

/** Cuenta de pérdidas y ganancias simplificada: ingresos (grupo 7) menos gastos (grupo 6). */
export function perdidasYGanancias(saldos: SaldoCuenta[]) {
  const ingresos = saldos.filter((s) => s.cuenta.startsWith("7")).map((s) => ({ ...s, importeCent: -s.saldoCent }));
  const gastos = saldos.filter((s) => s.cuenta.startsWith("6")).map((s) => ({ ...s, importeCent: s.saldoCent }));
  const totalIngresos = ingresos.reduce((x, s) => x + s.importeCent, 0), totalGastos = gastos.reduce((x, s) => x + s.importeCent, 0);
  return { ingresos, gastos, totalIngresosCent: totalIngresos, totalGastosCent: totalGastos, resultadoCent: totalIngresos - totalGastos };
}
