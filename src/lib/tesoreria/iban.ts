/** IBAN sin espacios y en mayúsculas. */
export const normalizarIban = (s: string) => s.replace(/[\s-]/g, "").toUpperCase();

/** Comprueba el IBAN con el algoritmo mod 97 (ISO 13616) y, si es español, su longitud. */
export function validarIban(entrada: string): boolean {
  const iban = normalizarIban(entrada);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  if (iban.startsWith("ES") && iban.length !== 24) return false;
  const reordenado = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let resto = 0;
  for (const d of reordenado) resto = (resto * 10 + Number(d)) % 97;
  return resto === 1;
}

/** Entidad, oficina y número de cuenta de un IBAN español (lo que identifica la cuenta en la Norma 43). */
export function cuentaDeIban(iban: string): { entidad: string; oficina: string; cuenta: string } | null {
  const i = normalizarIban(iban);
  if (!i.startsWith("ES") || i.length !== 24) return null;
  return { entidad: i.slice(4, 8), oficina: i.slice(8, 12), cuenta: i.slice(14, 24) };
}

/** IBAN agrupado de cuatro en cuatro para mostrarlo. */
export const formatearIban = (iban: string) => normalizarIban(iban).replace(/(.{4})/g, "$1 ").trim();
