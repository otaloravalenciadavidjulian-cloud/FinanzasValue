import { createHash } from "node:crypto";

/**
 * Lector de extractos bancarios en formato Norma 43 (cuaderno 43 de la AEB/CSB), el que exportan
 * todos los bancos españoles. Registros de 80 caracteres:
 *  11 cabecera de cuenta · 22 movimiento · 23 conceptos complementarios · 24 equivalencia de divisa
 *  33 final de cuenta (totales y saldo final) · 88 fin de fichero.
 * Se comprueban los totales y el saldo final del propio fichero: si no cuadran, no se importa.
 */

export class ErrorNorma43 extends Error {}

export interface MovimientoN43 {
  fechaOperacion: string;
  fechaValor: string;
  /** Positivo: abono. Negativo: cargo. */
  importeCent: number;
  conceptoComun: string;
  conceptoPropio: string;
  documento: string;
  referencia1: string;
  referencia2: string;
  /** Conceptos complementarios (registros 23) unidos. */
  descripcion: string;
  /** Identificador estable del movimiento para no importarlo dos veces. */
  huella: string;
}

export interface CuentaN43 {
  entidad: string;
  oficina: string;
  cuenta: string;
  fechaDesde: string;
  fechaHasta: string;
  divisa: string;
  saldoInicialCent: number;
  saldoFinalCent: number;
  titular: string;
  movimientos: MovimientoN43[];
}

/** Conceptos comunes de la norma, para mostrar el tipo de movimiento. */
export const CONCEPTOS_COMUNES: Record<string, string> = {
  "01": "Talones / reintegros", "02": "Abonarés / entregas / ingresos", "03": "Domiciliados / recibos", "04": "Giros / transferencias / traspasos",
  "05": "Amortizaciones préstamos", "06": "Remesas efectos", "07": "Suscripciones / dividendos", "08": "Divisas / billetes",
  "09": "Operaciones con valores", "10": "Cheques de gasolina", "11": "Cajeros", "12": "Tarjetas de crédito / débito",
  "13": "Operaciones extranjero", "14": "Devoluciones e impagados", "15": "Nóminas / seguros sociales", "16": "Timbres / corretaje",
  "17": "Intereses / comisiones / gastos", "98": "Anulaciones / correcciones", "99": "Varios",
};

/** Los ficheros suelen venir en Latin-1; si el contenido es UTF-8 válido, se respeta. */
export function decodificar(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}

const fecha = (aammdd: string, linea: number) => {
  if (!/^\d{6}$/.test(aammdd)) throw new ErrorNorma43(`Fecha no válida en la línea ${linea}`);
  const iso = `20${aammdd.slice(0, 2)}-${aammdd.slice(2, 4)}-${aammdd.slice(4, 6)}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) throw new ErrorNorma43(`Fecha no válida en la línea ${linea}`);
  return iso;
};

const importe = (s: string, linea: number) => {
  if (!/^\d{14}$/.test(s)) throw new ErrorNorma43(`Importe no válido en la línea ${linea}`);
  return Number(s);
};

/** Clave 1 = deudor/cargo (resta), 2 = acreedor/abono (suma). */
const signo = (clave: string, linea: number) => {
  if (clave === "1") return -1;
  if (clave === "2") return 1;
  throw new ErrorNorma43(`Clave de debe/haber no válida en la línea ${linea}`);
};

const limpio = (s: string) => s.replace(/\s+/g, " ").trim();

export function leerNorma43(contenido: string): CuentaN43[] {
  const lineas = contenido.split(/\r?\n/).map((l) => l.replace(/\r$/, "")).filter((l) => l.trim() !== "");
  if (lineas.length === 0) throw new ErrorNorma43("El fichero está vacío");
  if (!lineas[0].startsWith("11")) throw new ErrorNorma43("No parece un extracto en Norma 43 (la primera línea debe empezar por 11)");

  const cuentas: CuentaN43[] = [];
  let actual: CuentaN43 | null = null;
  let mov: (Omit<MovimientoN43, "huella" | "descripcion"> & { complementos: string[] }) | null = null;
  let finFichero = false;
  const cerrarMovimiento = () => {
    if (mov && actual) {
      const { complementos, ...m } = mov;
      actual.movimientos.push({ ...m, descripcion: limpio(complementos.join(" ")) || CONCEPTOS_COMUNES[m.conceptoComun] || "Movimiento", huella: "" });
    }
    mov = null;
  };

  lineas.forEach((original, i) => {
    const n = i + 1;
    if (finFichero) throw new ErrorNorma43(`Hay datos después del fin de fichero (línea ${n})`);
    const l = original.padEnd(80, " ");
    const tipo = l.slice(0, 2);
    switch (tipo) {
      case "11": {
        if (actual) throw new ErrorNorma43(`Falta el final de cuenta antes de la línea ${n}`);
        actual = {
          entidad: l.slice(2, 6), oficina: l.slice(6, 10), cuenta: l.slice(10, 20),
          fechaDesde: fecha(l.slice(20, 26), n), fechaHasta: fecha(l.slice(26, 32), n),
          saldoInicialCent: signo(l.slice(32, 33), n) * importe(l.slice(33, 47), n),
          divisa: l.slice(47, 50), titular: limpio(l.slice(51, 77)), saldoFinalCent: 0, movimientos: [],
        };
        if (actual.divisa !== "978") throw new ErrorNorma43("Solo se admiten cuentas en euros");
        break;
      }
      case "22": {
        if (!actual) throw new ErrorNorma43(`Movimiento sin cabecera de cuenta (línea ${n})`);
        cerrarMovimiento();
        const valor = importe(l.slice(28, 42), n);
        if (valor === 0) break; // apuntes a cero: no son movimientos de dinero
        mov = {
          fechaOperacion: fecha(l.slice(10, 16), n), fechaValor: fecha(l.slice(16, 22), n),
          conceptoComun: l.slice(22, 24), conceptoPropio: l.slice(24, 27).trim(),
          importeCent: signo(l.slice(27, 28), n) * valor,
          documento: l.slice(42, 52).trim(), referencia1: l.slice(52, 64).trim(), referencia2: l.slice(64, 80).trim(),
          complementos: [],
        };
        break;
      }
      case "23": {
        if (mov) (mov as { complementos: string[] }).complementos.push(l.slice(4, 42), l.slice(42, 80));
        break;
      }
      case "24":
        break;
      case "33": {
        if (!actual) throw new ErrorNorma43(`Final de cuenta sin cabecera (línea ${n})`);
        cerrarMovimiento();
        const c: CuentaN43 = actual;
        const numDebe = Number(l.slice(20, 25)), totalDebe = importe(l.slice(25, 39), n);
        const numHaber = Number(l.slice(39, 44)), totalHaber = importe(l.slice(44, 58), n);
        c.saldoFinalCent = signo(l.slice(58, 59), n) * importe(l.slice(59, 73), n);
        const cargos = c.movimientos.filter((m) => m.importeCent < 0), abonos = c.movimientos.filter((m) => m.importeCent > 0);
        const suma = (ms: MovimientoN43[]) => ms.reduce((s, m) => s + Math.abs(m.importeCent), 0);
        if (suma(cargos) !== totalDebe || suma(abonos) !== totalHaber) {
          throw new ErrorNorma43("Los movimientos no suman los totales del final de cuenta: el fichero está incompleto o dañado");
        }
        if (cargos.length > numDebe || abonos.length > numHaber) throw new ErrorNorma43("El número de apuntes no coincide con el final de cuenta");
        if (c.saldoInicialCent - totalDebe + totalHaber !== c.saldoFinalCent) {
          throw new ErrorNorma43("El saldo final no cuadra con el saldo inicial y los movimientos");
        }
        asignarHuellas(c);
        cuentas.push(c);
        actual = null;
        break;
      }
      case "88":
        if (actual) throw new ErrorNorma43("Falta el final de cuenta antes del fin de fichero");
        finFichero = true;
        break;
      default:
        throw new ErrorNorma43(`Tipo de registro desconocido "${tipo}" en la línea ${n}`);
    }
  });
  if (actual) throw new ErrorNorma43("El fichero termina sin el final de cuenta (registro 33)");
  if (cuentas.length === 0) throw new ErrorNorma43("El fichero no contiene ninguna cuenta");
  return cuentas;
}

/**
 * La huella combina los datos del movimiento y su orden entre movimientos idénticos del mismo día,
 * para que dos cargos iguales el mismo día no se confundan y un extracto solapado no los duplique.
 */
function asignarHuellas(c: CuentaN43) {
  const vistos = new Map<string, number>();
  for (const m of c.movimientos) {
    const base = [c.entidad, c.oficina, c.cuenta, m.fechaOperacion, m.fechaValor, m.importeCent, m.conceptoComun, m.conceptoPropio,
      m.documento, m.referencia1, m.referencia2, m.descripcion].join("|");
    const orden = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, orden);
    m.huella = createHash("sha256").update(`${base}|${orden}`).digest("hex");
  }
}
