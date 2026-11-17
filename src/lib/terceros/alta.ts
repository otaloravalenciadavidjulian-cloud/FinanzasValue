import { enEmpresa, type Sql } from "@/db/cliente";
import { normalizarNif, validarNif } from "@/lib/fiscal/nif";

export class ErrorTercero extends Error {}

export interface DatosTercero {
  razonSocial: string; nif: string; direccion?: string; codigoPostal?: string; municipio?: string; provincia?: string;
  email?: string; telefono?: string; diasPago?: number; categoria?: string;
}

/**
 * Da de alta un cliente o un proveedor. Si ya existe un tercero con ese NIF (por ejemplo, un cliente
 * que también es proveedor), se marca con el nuevo papel en lugar de duplicarlo.
 */
export async function altaTercero(sql: Sql, ctx: { empresaId: string; usuarioId?: string }, papel: "cliente" | "proveedor", d: DatosTercero) {
  const nif = normalizarNif(d.nif);
  if (!d.razonSocial.trim()) throw new ErrorTercero("Indica la razón social.");
  if (!validarNif(nif)) throw new ErrorTercero("El CIF/NIF no es válido: revisa la letra o el dígito de control.");
  const esCliente = papel === "cliente";
  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    const [existente] = await tx<{ id: string; es_cliente: boolean; es_proveedor: boolean; borrado_en: Date | null }[]>`
      SELECT id, es_cliente, es_proveedor, borrado_en FROM terceros WHERE nif = ${nif} FOR UPDATE`;
    if (existente) {
      const ya = esCliente ? existente.es_cliente : existente.es_proveedor;
      if (ya && !existente.borrado_en) throw new ErrorTercero(`Ya existe un ${papel} con ese NIF.`);
      await tx`UPDATE terceros SET es_cliente = es_cliente OR ${esCliente}, es_proveedor = es_proveedor OR ${!esCliente}, borrado_en = NULL WHERE id = ${existente.id}`;
      await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
        VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, ${`marcar_${papel}`}, 'tercero', ${existente.id}, ${tx.json({ nif })})`;
      return { id: existente.id, nuevo: false };
    }
    const [t] = await tx<{ id: string }[]>`
      INSERT INTO terceros (empresa_id, es_cliente, es_proveedor, razon_social, nif, direccion, codigo_postal, municipio, provincia, email, telefono, dias_pago, categoria)
      VALUES (${ctx.empresaId}, ${esCliente}, ${!esCliente}, ${d.razonSocial.trim()}, ${nif}, ${d.direccion || null}, ${d.codigoPostal || null},
              ${d.municipio || null}, ${d.provincia || null}, ${d.email || null}, ${d.telefono || null}, ${d.diasPago ?? 30}, ${d.categoria || null})
      RETURNING id`;
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id)
      VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, ${`alta_${papel}`}, 'tercero', ${t.id})`;
    return { id: t.id, nuevo: true };
  });
}
