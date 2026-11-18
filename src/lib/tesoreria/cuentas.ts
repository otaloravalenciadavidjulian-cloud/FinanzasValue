import { createHash } from "node:crypto";
import { enEmpresa, type Sql } from "@/db/cliente";
import { cuentaDeIban, normalizarIban, validarIban } from "./iban";
import { decodificar, ErrorNorma43, leerNorma43 } from "./norma43";

export class ErrorTesoreria extends Error {}

interface Contexto { empresaId: string; usuarioId?: string }

export async function altaCuenta(sql: Sql, ctx: Contexto, d: { nombre: string; iban: string }) {
  const iban = normalizarIban(d.iban);
  if (!d.nombre.trim()) throw new ErrorTesoreria("Pon un nombre a la cuenta, p. ej. «BBVA principal»");
  if (!validarIban(iban)) throw new ErrorTesoreria("El IBAN no es válido: revisa los dígitos");
  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    const [ya] = await tx`SELECT id FROM cuentas_bancarias WHERE iban = ${iban}`;
    if (ya) throw new ErrorTesoreria("Esa cuenta ya está dada de alta");
    const [c] = await tx<{ id: string }[]>`
      INSERT INTO cuentas_bancarias (empresa_id, nombre, iban, creado_por) VALUES (${ctx.empresaId}, ${d.nombre.trim()}, ${iban}, ${ctx.usuarioId ?? null})
      RETURNING id`;
    // Las operaciones de socios registradas antes de tener cuenta pasan a la primera cuenta.
    await tx`UPDATE operaciones_socios SET cuenta_id = ${c.id} WHERE cuenta_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM cuentas_bancarias WHERE id <> ${c.id})`;
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
      VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, 'alta_cuenta_bancaria', 'cuenta_bancaria', ${c.id}, ${tx.json({ iban })})`;
    return c;
  });
}

export const TAMANO_MAXIMO_EXTRACTO = 4 * 1024 * 1024;

/**
 * Importa un extracto en Norma 43 a una cuenta. Solo se toman los movimientos de esa cuenta; los
 * que ya estaban (extractos solapados) se ignoran. El mismo fichero no se puede importar dos veces.
 */
export async function importarExtracto(sql: Sql, ctx: Contexto, cuentaId: string, archivo: { nombre: string; bytes: Uint8Array }) {
  if (archivo.bytes.length === 0) throw new ErrorTesoreria("El archivo está vacío");
  if (archivo.bytes.length > TAMANO_MAXIMO_EXTRACTO) throw new ErrorTesoreria("El archivo supera 4 MB: importa un periodo más corto");
  let cuentasFichero;
  try {
    cuentasFichero = leerNorma43(decodificar(archivo.bytes));
  } catch (e) {
    if (e instanceof ErrorNorma43) throw new ErrorTesoreria(e.message);
    throw e;
  }
  const huellaArchivo = createHash("sha256").update(archivo.bytes).digest("hex");

  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    const [cuenta] = await tx<{ iban: string; fecha_saldo_inicial: string | null; activa: boolean }[]>`
      SELECT iban, to_char(fecha_saldo_inicial,'YYYY-MM-DD') AS fecha_saldo_inicial, activa FROM cuentas_bancarias WHERE id = ${cuentaId} FOR UPDATE`;
    if (!cuenta) throw new ErrorTesoreria("Cuenta no encontrada");
    if (!cuenta.activa) throw new ErrorTesoreria("La cuenta está desactivada");
    const id = cuentaDeIban(cuenta.iban);
    const datos = cuentasFichero.find((c) => id && c.entidad === id.entidad && c.oficina === id.oficina && c.cuenta === id.cuenta);
    if (!datos) {
      const otras = cuentasFichero.map((c) => `${c.entidad} ${c.oficina} ·· ${c.cuenta.slice(-4)}`).join(", ");
      throw new ErrorTesoreria(`El extracto no es de esta cuenta (trae: ${otras})`);
    }
    const [repetido] = await tx`SELECT to_char(creado_en,'DD/MM/YYYY') AS fecha FROM importaciones_bancarias WHERE cuenta_id = ${cuentaId} AND sha256 = ${huellaArchivo}`;
    if (repetido) throw new ErrorTesoreria(`Este fichero ya se importó el ${repetido.fecha}`);

    // La cuenta está bloqueada (FOR UPDATE): nadie más importa en ella mientras tanto.
    const existentes = new Set((await tx<{ huella: string }[]>`
      SELECT huella FROM movimientos_bancarios WHERE cuenta_id = ${cuentaId} AND huella = ANY(${datos.movimientos.map((m) => m.huella)}::text[])`).map((r) => r.huella));
    const nuevosMovs = datos.movimientos.filter((m) => !existentes.has(m.huella));
    const nuevos = nuevosMovs.length, repetidos = datos.movimientos.length - nuevos;
    const [imp] = await tx<{ id: string }[]>`
      INSERT INTO importaciones_bancarias (empresa_id, cuenta_id, nombre_archivo, sha256, formato, fecha_desde, fecha_hasta,
        saldo_inicial_cent, saldo_final_cent, movimientos_nuevos, movimientos_repetidos, creado_por)
      VALUES (${ctx.empresaId}, ${cuentaId}, ${archivo.nombre.slice(0, 150) || "extracto"}, ${huellaArchivo}, 'n43', ${datos.fechaDesde}, ${datos.fechaHasta},
        ${datos.saldoInicialCent}, ${datos.saldoFinalCent}, ${nuevos}, ${repetidos}, ${ctx.usuarioId ?? null})
      RETURNING id`;
    for (const m of nuevosMovs) {
      await tx`
        INSERT INTO movimientos_bancarios (empresa_id, cuenta_id, importacion_id, fecha_operacion, fecha_valor, importe_cent, concepto_comun,
          concepto_propio, documento, referencia1, referencia2, descripcion, huella)
        VALUES (${ctx.empresaId}, ${cuentaId}, ${imp.id}, ${m.fechaOperacion}, ${m.fechaValor}, ${m.importeCent}, ${m.conceptoComun},
          ${m.conceptoPropio || null}, ${m.documento || null}, ${m.referencia1 || null}, ${m.referencia2 || null}, ${m.descripcion}, ${m.huella})`;
    }
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
      VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, 'importar_extracto', 'cuenta_bancaria', ${cuentaId},
        ${tx.json({ importacion: imp.id, desde: datos.fechaDesde, hasta: datos.fechaHasta, nuevos, repetidos })})`;
    if (!cuenta.fecha_saldo_inicial || datos.fechaDesde < cuenta.fecha_saldo_inicial) {
      await tx`UPDATE cuentas_bancarias SET saldo_inicial_cent = ${datos.saldoInicialCent}, fecha_saldo_inicial = ${datos.fechaDesde} WHERE id = ${cuentaId}`;
    }
    return { importacionId: imp.id, nuevos, repetidos, desde: datos.fechaDesde, hasta: datos.fechaHasta, saldoFinalCent: datos.saldoFinalCent };
  });
}
