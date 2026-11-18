import { z } from "zod";
import { enEmpresa, type Sql, type Tx } from "@/db/cliente";
import { normalizarNif, validarNif } from "@/lib/fiscal/nif";

/**
 * Socios y su financiación: aportaciones de capital, aportaciones sin ampliar capital, préstamos y
 * devoluciones. Son entradas y salidas de dinero, no ingresos ni gastos: no llevan IVA ni cuentan en
 * la facturación ni en la rentabilidad. En contabilidad van a fondos propios (100, 118) o a deudas
 * con partes vinculadas (163 a largo plazo, 5133 a corto).
 */

export class ErrorSocio extends Error {}

export const TIPOS_OPERACION = {
  capital: "Aportación de capital",
  aportacion: "Aportación sin ampliar capital",
  prestamo: "Préstamo del socio a la empresa",
  devolucion: "Devolución de préstamo al socio",
} as const;
export type TipoOperacion = keyof typeof TIPOS_OPERACION;

/** Cuenta del PGC de cada operación. */
export function cuentaOperacion(tipo: TipoOperacion, plazo: "corto" | "largo" | null): string {
  if (tipo === "capital") return "100";
  if (tipo === "aportacion") return "118";
  return plazo === "largo" ? "163" : "5133";
}

/** Signo del movimiento de dinero: entra (+) o sale (−). */
export const entraDinero = (tipo: TipoOperacion) => tipo !== "devolucion";

interface Contexto { empresaId: string; usuarioId?: string; hoy?: string }

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida");
const socio = z.object({
  nombre: z.string().trim().min(1, "Indica el nombre del socio"),
  nif: z.string().trim().optional(),
  participacionPct: z.number().positive("La participación debe ser mayor que 0").max(100, "La participación no puede superar el 100 %").optional(),
  email: z.string().trim().email("Email no válido").optional().or(z.literal("")),
});
export type EntradaSocio = z.input<typeof socio>;

export async function altaSocio(sql: Sql, ctx: Contexto, entrada: EntradaSocio) {
  const s = socio.parse(entrada);
  const nif = s.nif ? normalizarNif(s.nif) : null;
  if (nif && !validarNif(nif)) throw new ErrorSocio("El NIF del socio no es válido");
  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    const [r] = await tx<{ id: string }[]>`
      INSERT INTO socios (empresa_id, nombre, nif, participacion_pct, email)
      VALUES (${ctx.empresaId}, ${s.nombre}, ${nif}, ${s.participacionPct ?? null}, ${s.email || null}) RETURNING id`;
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
      VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, 'alta_socio', 'socio', ${r.id}, ${tx.json({ nombre: s.nombre, nif })})`;
    return r;
  });
}

const operacion = z.object({
  socioId: z.string().uuid("Elige el socio"),
  tipo: z.enum(["capital", "aportacion", "prestamo", "devolucion"]),
  fecha,
  importeCent: z.number().int().positive("El importe debe ser mayor que 0"),
  plazo: z.enum(["corto", "largo"]).optional(),
  vencimiento: fecha.optional(),
  interesPct: z.number().min(0, "El interés no puede ser negativo").max(100).optional(),
  prestamoId: z.string().uuid().optional(),
  concepto: z.string().trim().max(300).optional(),
});
export type EntradaOperacion = z.input<typeof operacion>;

/** Lo que queda por devolver de cada préstamo. */
export async function prestamosPendientes(tx: Tx, socioId?: string) {
  return (await tx<{ id: string; socio_id: string; socio: string; fecha: string; vencimiento: string | null; plazo: "corto" | "largo"; importe_cent: string; pendiente_cent: string }[]>`
    SELECT p.id, p.socio_id, s.nombre AS socio, to_char(p.fecha,'YYYY-MM-DD') AS fecha, to_char(p.vencimiento,'YYYY-MM-DD') AS vencimiento, p.plazo, p.importe_cent,
           p.importe_cent - coalesce((SELECT sum(d.importe_cent) FROM operaciones_socios d WHERE d.prestamo_id = p.id AND d.borrado_en IS NULL), 0) AS pendiente_cent
    FROM operaciones_socios p JOIN socios s ON s.id = p.socio_id
    WHERE p.tipo = 'prestamo' AND p.borrado_en IS NULL ${socioId ? tx`AND p.socio_id = ${socioId}` : tx``}
    ORDER BY p.fecha`).map((p) => ({ ...p, importeCent: Number(p.importe_cent), pendienteCent: Number(p.pendiente_cent) }));
}

export async function registrarOperacion(sql: Sql, ctx: Contexto, entrada: EntradaOperacion) {
  const o = operacion.parse(entrada);
  if (ctx.hoy && o.fecha > ctx.hoy) throw new ErrorSocio("La fecha no puede ser futura");
  if (o.tipo === "prestamo" && !o.plazo) throw new ErrorSocio("Indica si el préstamo es a corto o a largo plazo");
  if (o.tipo === "prestamo" && o.vencimiento && o.vencimiento < o.fecha) throw new ErrorSocio("El vencimiento no puede ser anterior a la fecha del préstamo");
  if (o.tipo === "devolucion" && !o.prestamoId) throw new ErrorSocio("Elige el préstamo que se devuelve");
  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    const [s] = await tx`SELECT id FROM socios WHERE id = ${o.socioId} AND borrado_en IS NULL`;
    if (!s) throw new ErrorSocio("Socio no encontrado");
    if (o.tipo === "devolucion") {
      const [p] = (await prestamosPendientes(tx, o.socioId)).filter((x) => x.id === o.prestamoId);
      if (!p) throw new ErrorSocio("Ese préstamo no es de este socio");
      // Bloquea el préstamo para que dos devoluciones simultáneas no superen lo pendiente.
      await tx`SELECT id FROM operaciones_socios WHERE id = ${p.id} FOR UPDATE`;
      if (o.importeCent > p.pendienteCent) throw new ErrorSocio(`La devolución supera lo pendiente del préstamo (${(p.pendienteCent / 100).toFixed(2).replace(".", ",")} €)`);
      if (o.fecha < p.fecha) throw new ErrorSocio("La devolución no puede ser anterior al préstamo");
    }
    const [r] = await tx<{ id: string }[]>`
      INSERT INTO operaciones_socios (empresa_id, socio_id, tipo, fecha, importe_cent, plazo, vencimiento, interes_pct, prestamo_id, concepto, creado_por)
      VALUES (${ctx.empresaId}, ${o.socioId}, ${o.tipo}, ${o.fecha}, ${o.importeCent}, ${o.tipo === "prestamo" ? o.plazo! : null},
        ${o.tipo === "prestamo" ? o.vencimiento ?? null : null}, ${o.tipo === "prestamo" ? o.interesPct ?? null : null},
        ${o.tipo === "devolucion" ? o.prestamoId! : null}, ${o.concepto || null}, ${ctx.usuarioId ?? null}) RETURNING id`;
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
      VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, 'operacion_socio', 'operacion_socio', ${r.id}, ${tx.json({ ...o } as never)})`;
    return r;
  });
}

/** Borra una operación registrada por error. No se puede si está conciliada o si es un préstamo con devoluciones. */
export async function borrarOperacion(sql: Sql, ctx: Contexto, id: string) {
  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    const [o] = await tx<{ tipo: TipoOperacion }[]>`SELECT tipo FROM operaciones_socios WHERE id = ${id} AND borrado_en IS NULL FOR UPDATE`;
    if (!o) throw new ErrorSocio("Operación no encontrada");
    const [k] = await tx`SELECT 1 FROM conciliaciones WHERE operacion_socio_id = ${id} AND deshecha_en IS NULL`;
    if (k) throw new ErrorSocio("Está conciliada con un movimiento del banco: deshaz antes la conciliación");
    const [d] = await tx`SELECT 1 FROM operaciones_socios WHERE prestamo_id = ${id} AND borrado_en IS NULL`;
    if (d) throw new ErrorSocio("El préstamo tiene devoluciones registradas: bórralas antes");
    await tx`UPDATE operaciones_socios SET borrado_en = now() WHERE id = ${id}`;
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
      VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, 'borrar_operacion_socio', 'operacion_socio', ${id}, ${tx.json({ tipo: o.tipo })})`;
  });
}

/** Resumen por socio: capital aportado, otras aportaciones y préstamo pendiente. */
export async function resumenSocios(tx: Tx) {
  return (await tx<{ id: string; nombre: string; nif: string | null; participacion_pct: string | null; capital: string; aportaciones: string; prestado: string; devuelto: string }[]>`
    SELECT s.id, s.nombre, s.nif, s.participacion_pct,
      coalesce(sum(o.importe_cent) FILTER (WHERE o.tipo = 'capital'), 0) AS capital,
      coalesce(sum(o.importe_cent) FILTER (WHERE o.tipo = 'aportacion'), 0) AS aportaciones,
      coalesce(sum(o.importe_cent) FILTER (WHERE o.tipo = 'prestamo'), 0) AS prestado,
      coalesce(sum(o.importe_cent) FILTER (WHERE o.tipo = 'devolucion'), 0) AS devuelto
    FROM socios s LEFT JOIN operaciones_socios o ON o.socio_id = s.id AND o.borrado_en IS NULL
    WHERE s.borrado_en IS NULL GROUP BY s.id ORDER BY s.nombre`).map((s) => ({
    id: s.id, nombre: s.nombre, nif: s.nif, participacionPct: s.participacion_pct === null ? null : Number(s.participacion_pct),
    capitalCent: Number(s.capital), aportacionesCent: Number(s.aportaciones), prestamoPendienteCent: Number(s.prestado) - Number(s.devuelto),
  }));
}
