import { enEmpresa, type Sql } from "@/db/cliente";
import { entornoAEAT } from "./documento";

export class ErrorBorradoPruebas extends Error {}

/**
 * Borra todas las facturas emitidas en el entorno de pruebas, con sus líneas, cobros y registros VERI*FACTU,
 * y devuelve la numeración de las series a cero. Solo funciona en pruebas (nada se ha remitido a la AEAT):
 * la base de datos lo impide en producción. Queda constancia en la auditoría.
 */
export async function borrarFacturasDePrueba(sql: Sql, ctx: { empresaId: string; usuarioId?: string }) {
  if (entornoAEAT() !== "pruebas") throw new ErrorBorradoPruebas("Solo se pueden borrar facturas en el entorno de pruebas.");
  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    const [{ entorno }] = await tx<{ entorno: string }[]>`SELECT entorno FROM entorno_sistema`;
    if (entorno !== "pruebas") throw new ErrorBorradoPruebas("El sistema ya está en producción: las facturas no se pueden borrar.");
    await tx`SELECT set_config('app.borrado_pruebas', 'on', true)`;
    const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM facturas`;
    await tx`DELETE FROM conciliaciones WHERE cobro_id IN (SELECT id FROM cobros WHERE factura_id IS NOT NULL)`;
    await tx`DELETE FROM cobros WHERE factura_id IS NOT NULL`;
    await tx`DELETE FROM envios_aeat`;
    await tx`DELETE FROM registros_facturacion`;
    await tx`DELETE FROM desglose_iva`;
    await tx`DELETE FROM lineas_factura`;
    await tx`DELETE FROM facturas`;
    await tx`UPDATE series SET ultimo_numero = 0`;
    await tx`UPDATE cadena_registros SET ultima_secuencia = 0, ultima_huella = NULL`;
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
      VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, 'borrar_facturas_prueba', 'empresa', ${ctx.empresaId}, ${tx.json({ facturas: n })})`;
    return { facturas: n };
  });
}
