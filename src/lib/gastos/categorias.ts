/**
 * Categorías de gasto con su cuenta del Plan General Contable (grupo 6), para que en la fase de
 * contabilidad cada gasto genere su asiento sin reclasificar.
 */
export const CATEGORIAS_GASTO = [
  { codigo: "compras", nombre: "Compras de mercaderías y materiales", cuenta: "600" },
  { codigo: "alquileres", nombre: "Alquileres", cuenta: "621" },
  { codigo: "reparaciones", nombre: "Reparaciones y mantenimiento", cuenta: "622" },
  { codigo: "profesionales", nombre: "Servicios profesionales (asesoría, abogados…)", cuenta: "623" },
  { codigo: "transportes", nombre: "Transportes y mensajería", cuenta: "624" },
  { codigo: "seguros", nombre: "Seguros", cuenta: "625" },
  { codigo: "bancarios", nombre: "Servicios bancarios y comisiones", cuenta: "626" },
  { codigo: "publicidad", nombre: "Publicidad y marketing", cuenta: "627" },
  { codigo: "suministros", nombre: "Suministros (luz, agua, telefonía, internet)", cuenta: "628" },
  { codigo: "software", nombre: "Software y suscripciones", cuenta: "629" },
  { codigo: "viajes", nombre: "Viajes, dietas y desplazamientos", cuenta: "629" },
  { codigo: "material_oficina", nombre: "Material de oficina", cuenta: "629" },
  { codigo: "formacion", nombre: "Formación", cuenta: "629" },
  { codigo: "otros_servicios", nombre: "Otros servicios", cuenta: "629" },
  { codigo: "tributos", nombre: "Tributos y tasas", cuenta: "631" },
  { codigo: "vehiculos", nombre: "Vehículos (combustible, peajes, parking)", cuenta: "629" },
] as const;

export type CodigoCategoria = (typeof CATEGORIAS_GASTO)[number]["codigo"];
export const CODIGOS_CATEGORIA = CATEGORIAS_GASTO.map((c) => c.codigo) as [CodigoCategoria, ...CodigoCategoria[]];
export const nombreCategoria = (codigo: string) => CATEGORIAS_GASTO.find((c) => c.codigo === codigo)?.nombre ?? codigo;
