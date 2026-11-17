/** Causas de las operaciones sin IVA repercutido, con la mención que debe llevar la factura. */
export const CAUSAS_IVA = [
  { codigo: "E1", nombre: "Exenta (art. 20 LIVA)", mencion: "Operación exenta de IVA (art. 20 de la Ley 37/1992)" },
  { codigo: "E2", nombre: "Exportación (art. 21 LIVA)", mencion: "Operación exenta de IVA por exportación (art. 21 de la Ley 37/1992)" },
  { codigo: "E3", nombre: "Asimilada a exportación (art. 22 LIVA)", mencion: "Operación exenta de IVA (art. 22 de la Ley 37/1992)" },
  { codigo: "E4", nombre: "Zonas francas y depósitos (arts. 23 y 24 LIVA)", mencion: "Operación exenta de IVA (arts. 23 y 24 de la Ley 37/1992)" },
  { codigo: "E5", nombre: "Entrega intracomunitaria (art. 25 LIVA)", mencion: "Entrega intracomunitaria exenta de IVA (art. 25 de la Ley 37/1992)" },
  { codigo: "E6", nombre: "Exenta por otra causa", mencion: "Operación exenta de IVA" },
  { codigo: "N1", nombre: "No sujeta (arts. 7, 14 y otros)", mencion: "Operación no sujeta a IVA (art. 7 de la Ley 37/1992)" },
  { codigo: "N2", nombre: "No sujeta por localización", mencion: "Operación no sujeta a IVA en España por reglas de localización (arts. 68 a 70 de la Ley 37/1992)" },
  { codigo: "S2", nombre: "Inversión del sujeto pasivo", mencion: "Inversión del sujeto pasivo (art. 84.Uno.2.º de la Ley 37/1992)" },
] as const;

export type CausaIva = (typeof CAUSAS_IVA)[number]["codigo"];
export const CODIGOS_CAUSA = CAUSAS_IVA.map((c) => c.codigo) as [CausaIva, ...CausaIva[]];
export const causaIva = (codigo: string | null | undefined) => CAUSAS_IVA.find((c) => c.codigo === codigo);
