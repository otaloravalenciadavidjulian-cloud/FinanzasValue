/**
 * Importes en céntimos enteros. Nunca se usa coma flotante para guardar dinero.
 */

/** Redondeo al céntimo "half away from zero", el habitual en facturación. */
export function redondear(valor: number): number {
  const r = Math.round(Math.abs(valor) + Number.EPSILON);
  return valor < 0 ? -r : r;
}

/** Céntimos a texto con dos decimales y punto, como exige el XML de la AEAT ("123.45"). */
export function aDecimalAEAT(centimos: number): string {
  if (!Number.isInteger(centimos)) throw new Error("El importe debe estar en céntimos enteros");
  const signo = centimos < 0 ? "-" : "";
  const abs = Math.abs(centimos);
  return `${signo}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Texto decimal ("1.234,56" o "1234.56") a céntimos. */
export function aCentimos(texto: string): number {
  const limpio = texto.trim().replace(/\s/g, "");
  const normal = limpio.includes(",") ? limpio.replace(/\./g, "").replace(",", ".") : limpio;
  if (!/^-?\d+(\.\d{1,2})?$/.test(normal)) throw new Error(`Importe no válido: ${texto}`);
  const [ent, dec = ""] = normal.replace("-", "").split(".");
  const c = Number(ent) * 100 + Number(dec.padEnd(2, "0"));
  return normal.startsWith("-") ? -c : c;
}

const formato = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
export const formatearEuros = (centimos: number) => formato.format(centimos / 100);
