/** Validación de NIF (DNI), NIE y CIF/NIF de personas jurídicas españolas. */
const LETRAS = "TRWAGMYFPDXBNJZSQVHLCKE";

export function normalizarNif(v: string): string {
  return v.toUpperCase().replace(/[\s.-]/g, "");
}

export function validarNif(valor: string): boolean {
  const v = normalizarNif(valor);
  if (/^\d{8}[A-Z]$/.test(v)) return LETRAS[Number(v.slice(0, 8)) % 23] === v[8];
  if (/^[KLM]\d{7}[A-Z]$/.test(v)) return LETRAS[Number(v.slice(1, 8)) % 23] === v[8];
  if (/^[XYZ]\d{7}[A-Z]$/.test(v)) {
    const n = "XYZ".indexOf(v[0]) + v.slice(1, 8);
    return LETRAS[Number(n) % 23] === v[8];
  }
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(v)) {
    const d = v.slice(1, 8);
    let suma = 0;
    for (let i = 0; i < 7; i++) {
      const n = Number(d[i]);
      if (i % 2 === 0) {
        const x = n * 2;
        suma += Math.floor(x / 10) + (x % 10);
      } else suma += n;
    }
    const control = (10 - (suma % 10)) % 10;
    const letra = "JABCDEFGHI"[control];
    const ultimo = v[8];
    // P, Q, R, S, W y N llevan letra; A, B, E, H llevan número; el resto admite ambos.
    if ("PQRSWN".includes(v[0])) return ultimo === letra;
    if ("ABEH".includes(v[0])) return ultimo === String(control);
    return ultimo === letra || ultimo === String(control);
  }
  return false;
}
