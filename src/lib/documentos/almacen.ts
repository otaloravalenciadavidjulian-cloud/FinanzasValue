import { createHash } from "node:crypto";
import { enEmpresa, type Sql, type Tx } from "@/db/cliente";

/**
 * Justificantes guardados en la propia base de datos (tabla documentos_contenido), con su huella
 * SHA-256 para detectar alteraciones y archivos repetidos. Nunca se borran: van a la papelera.
 */

export class ErrorDocumento extends Error {}

/** Límite por archivo: el plan gratuito de Netlify no admite peticiones mucho mayores. */
export const TAMANO_MAXIMO = 4 * 1024 * 1024;

export type MimeJustificante = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

/** Tipo real del archivo según sus primeros bytes (no se confía en lo que diga el navegador). */
export function detectarMime(b: Uint8Array): MimeJustificante | null {
  const empieza = (...x: number[]) => x.every((v, i) => b[i] === v);
  if (empieza(0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf"; // %PDF-
  if (empieza(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (empieza(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (empieza(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

export const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export interface Archivo { nombre: string; bytes: Uint8Array }

function validar(a: Archivo): MimeJustificante {
  if (a.bytes.length === 0) throw new ErrorDocumento("El archivo está vacío");
  if (a.bytes.length > TAMANO_MAXIMO) throw new ErrorDocumento("El archivo supera 4 MB. Si es una foto, súbela desde el móvil: se reduce sola");
  const mime = detectarMime(a.bytes);
  if (!mime) throw new ErrorDocumento("Solo se admiten PDF, JPG, PNG o WEBP");
  return mime;
}

const nombreSeguro = (n: string) => (n.replace(/[\\/\u0000-\u001f]/g, "_").trim() || "justificante").slice(0, 150);

interface Contexto { empresaId: string; usuarioId?: string }

/** Guarda el archivo dentro de una transacción ya abierta con el contexto de empresa. */
export async function guardarArchivo(tx: Tx, ctx: Contexto, a: Archivo, destino: { entidad: string; entidadId: string | null; tipo: string }) {
  const mime = validar(a);
  const huella = sha256(a.bytes);
  if (destino.entidadId) await comprobarNoRepetido(tx, huella);
  const [d] = await tx<{ id: string }[]>`
    INSERT INTO documentos (empresa_id, entidad, entidad_id, tipo, nombre, mime, tamano_bytes, sha256, ruta_almacen, subido_por)
    VALUES (${ctx.empresaId}, ${destino.entidad}, ${destino.entidadId}, ${destino.tipo}, ${nombreSeguro(a.nombre)}, ${mime},
            ${a.bytes.length}, ${huella}, 'postgres', ${ctx.usuarioId ?? null})
    RETURNING id`;
  await tx`INSERT INTO documentos_contenido (documento_id, empresa_id, contenido) VALUES (${d.id}, ${ctx.empresaId}, ${Buffer.from(a.bytes)})`;
  return { id: d.id, sha256: huella, mime };
}

/** Un mismo archivo no puede justificar dos gastos activos. `excepto` excluye el gasto que se comprueba. */
export async function comprobarNoRepetido(tx: Tx, huella: string, excepto: string | null = null) {
  await tx`SELECT pg_advisory_xact_lock(hashtext('documento:' || app_empresa_id()::text || ${huella}))`;
  const [otro] = await tx<{ entidad_id: string; numero: string | null }[]>`
    SELECT d.entidad_id, g.numero FROM documentos d JOIN gastos g ON g.id = d.entidad_id
    WHERE d.sha256 = ${huella} AND d.borrado_en IS NULL AND g.borrado_en IS NULL
      AND (${excepto}::uuid IS NULL OR d.entidad_id <> ${excepto}::uuid) LIMIT 1`;
  if (otro) throw new ErrorDocumento(`Este mismo archivo ya justifica un gasto activo${otro.numero ? ` (${otro.numero})` : ""}`);
}

const tipoDocumentoGasto = (tipoGasto: string) => (tipoGasto === "ticket" ? "ticket" : tipoGasto === "otro" ? "otro" : "factura");

/** Adjunta un justificante a un gasto y le quita la marca de pendiente de documentación. */
export async function adjuntarAGasto(sql: Sql, ctx: Contexto, gastoId: string, a: Archivo) {
  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    const [g] = await tx<{ borrado_en: Date | null; tipo_documento: string }[]>`SELECT borrado_en, tipo_documento FROM gastos WHERE id = ${gastoId} FOR UPDATE`;
    if (!g) throw new ErrorDocumento("Gasto no encontrado");
    if (g.borrado_en) throw new ErrorDocumento("El gasto está en la papelera");
    const d = await guardarArchivo(tx, ctx, a, { entidad: "gasto", entidadId: gastoId, tipo: tipoDocumentoGasto(g.tipo_documento) });
    await tx`UPDATE gastos SET pendiente_documentacion = false, actualizado_en = now() WHERE id = ${gastoId}`;
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
      VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, 'adjuntar_justificante', 'gasto', ${gastoId}, ${tx.json({ documento: d.id, sha256: d.sha256 })})`;
    return d;
  });
}

/** Sube un justificante para leerlo antes de crear el gasto. Queda sin asignar hasta que se guarde el gasto. */
export async function subirBorrador(sql: Sql, ctx: Contexto, a: Archivo) {
  return enEmpresa(sql, ctx.empresaId, (tx) => guardarArchivo(tx, ctx, a, { entidad: "gasto", entidadId: null, tipo: "factura" }));
}

export async function guardarLectura(sql: Sql, ctx: Contexto, documentoId: string, extraccion: unknown) {
  await enEmpresa(sql, ctx.empresaId, (tx) => tx`UPDATE documentos SET extraccion = ${tx.json(extraccion as never)} WHERE id = ${documentoId} AND entidad_id IS NULL`);
}

/** Asigna un borrador subido por el mismo usuario al gasto recién creado (dentro de su transacción). */
export async function asignarBorrador(tx: Tx, ctx: Contexto, documentoId: string, gastoId: string) {
  const [d] = await tx<{ sha256: string; subido_por: string | null }[]>`
    SELECT sha256, subido_por FROM documentos WHERE id = ${documentoId} AND entidad_id IS NULL AND borrado_en IS NULL FOR UPDATE`;
  if (!d) throw new ErrorDocumento("El justificante leído ya no está disponible; vuelve a subirlo");
  if (ctx.usuarioId && d.subido_por && d.subido_por !== ctx.usuarioId) throw new ErrorDocumento("Ese justificante lo subió otra persona");
  await comprobarNoRepetido(tx, d.sha256);
  await tx`UPDATE documentos SET entidad_id = ${gastoId} WHERE id = ${documentoId}`;
  await tx`UPDATE gastos SET pendiente_documentacion = false WHERE id = ${gastoId}`;
}

/** Manda un justificante a la papelera; si el gasto se queda sin ninguno, vuelve a quedar pendiente. */
export async function documentoAPapelera(sql: Sql, ctx: Contexto, documentoId: string, motivo: string) {
  if (!motivo.trim()) throw new ErrorDocumento("Indica el motivo");
  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    const [d] = await tx<{ entidad_id: string | null }[]>`
      UPDATE documentos SET borrado_en = now(), motivo_borrado = ${motivo.trim()} WHERE id = ${documentoId} AND borrado_en IS NULL RETURNING entidad_id`;
    if (!d) throw new ErrorDocumento("Documento no encontrado");
    if (d.entidad_id) {
      await tx`UPDATE gastos SET pendiente_documentacion = NOT EXISTS (
          SELECT 1 FROM documentos WHERE entidad = 'gasto' AND entidad_id = ${d.entidad_id} AND borrado_en IS NULL), actualizado_en = now()
        WHERE id = ${d.entidad_id}`;
    }
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
      VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, 'justificante_a_papelera', 'documento', ${documentoId}, ${tx.json({ motivo: motivo.trim() })})`;
    return d;
  });
}

/** Lee un documento y comprueba que su contenido sigue correspondiendo a la huella guardada. */
export async function leerDocumento(tx: Tx, documentoId: string) {
  const [d] = await tx<{ nombre: string; mime: string; sha256: string; entidad_id: string | null; subido_por: string | null; contenido: Buffer }[]>`
    SELECT d.nombre, d.mime, d.sha256, d.entidad_id, d.subido_por, c.contenido
    FROM documentos d JOIN documentos_contenido c ON c.documento_id = d.id WHERE d.id = ${documentoId}`;
  if (!d) return null;
  return { ...d, integro: sha256(d.contenido) === d.sha256 };
}
