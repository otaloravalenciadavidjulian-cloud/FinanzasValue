import { enEmpresa, type Sql } from "@/db/cliente";

export class ErrorProyecto extends Error {}

export async function altaProyecto(sql: Sql, ctx: { empresaId: string; usuarioId?: string }, d: { nombre: string; clienteId?: string }) {
  const nombre = d.nombre.trim();
  if (!nombre) throw new ErrorProyecto("Pon un nombre al proyecto");
  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    if (d.clienteId) {
      const [c] = await tx`SELECT 1 FROM terceros WHERE id = ${d.clienteId} AND es_cliente AND borrado_en IS NULL`;
      if (!c) throw new ErrorProyecto("Cliente no encontrado");
    }
    const [ya] = await tx`SELECT 1 FROM proyectos WHERE lower(nombre) = lower(${nombre})`;
    if (ya) throw new ErrorProyecto("Ya hay un proyecto con ese nombre");
    const [p] = await tx<{ id: string }[]>`INSERT INTO proyectos (empresa_id, nombre, cliente_id) VALUES (${ctx.empresaId}, ${nombre}, ${d.clienteId ?? null}) RETURNING id`;
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
      VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, 'alta_proyecto', 'proyecto', ${p.id}, ${tx.json({ nombre })})`;
    return p;
  });
}

export async function cambiarEstadoProyecto(sql: Sql, ctx: { empresaId: string; usuarioId?: string }, id: string, activo: boolean) {
  await enEmpresa(sql, ctx.empresaId, async (tx) => {
    const r = await tx`UPDATE proyectos SET activo = ${activo} WHERE id = ${id} RETURNING id`;
    if (!r.length) throw new ErrorProyecto("Proyecto no encontrado");
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, despues)
      VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, ${activo ? "reabrir_proyecto" : "cerrar_proyecto"}, 'proyecto', ${id}, null)`;
  });
}
