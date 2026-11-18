import Link from "next/link";
import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_FACTURACION } from "@/lib/auth/sesion";
import { formatearEuros } from "@/lib/fiscal/dinero";
import { CATEGORIAS_OTRO, sugerencias, type Sugerencia } from "@/lib/tesoreria/conciliar";
import { aplicarSugerencia, marcarOtro } from "./acciones";
import { BotonSugerencia, FormularioOtro } from "./botones";

export const dynamic = "force-dynamic";

export default async function Conciliar() {
  const s = await requerirSesion(ROLES_FACTURACION);
  const { pendientes, total } = await enEmpresa(db(), s.empresaId, async (tx) => {
    const filas = await tx<{ id: string; fecha: string; cuenta: string; descripcion: string; importe_cent: string }[]>`
      SELECT m.id, to_char(m.fecha_operacion,'DD/MM/YYYY') AS fecha, c.nombre AS cuenta, m.descripcion, m.importe_cent
      FROM movimientos_bancarios m JOIN cuentas_bancarias c ON c.id = m.cuenta_id
      WHERE NOT EXISTS (SELECT 1 FROM conciliaciones k WHERE k.movimiento_id = m.id AND k.deshecha_en IS NULL)
      ORDER BY m.fecha_operacion, m.creado_en LIMIT 30`;
    const [{ n }] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM movimientos_bancarios m
      WHERE NOT EXISTS (SELECT 1 FROM conciliaciones k WHERE k.movimiento_id = m.id AND k.deshecha_en IS NULL)`;
    const pendientes: (typeof filas[number] & { sugerencias: Sugerencia[] })[] = [];
    for (const f of filas) pendientes.push({ ...f, sugerencias: await sugerencias(tx, f.id) });
    return { pendientes, total: n };
  });
  const categorias = Object.entries(CATEGORIAS_OTRO);
  return (
    <>
      <h1>Conciliación bancaria</h1>
      <p className="muted">
        {total === 0 ? "No queda ningún movimiento por conciliar." : `${total} ${total === 1 ? "movimiento" : "movimientos"} por conciliar${total > pendientes.length ? `; se muestran los ${pendientes.length} más antiguos` : ""}.`}
        {" "}Cada movimiento se explica con un cobro, un pago o un concepto sin factura. <Link href="/tesoreria">Volver a tesorería</Link>
      </p>
      {pendientes.map((m) => (
        <div className="panel" key={m.id} style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <span><b>{m.fecha}</b> · {m.cuenta} · {m.descripcion}</span>
            <b className="num" style={{ color: Number(m.importe_cent) < 0 ? "var(--bad)" : undefined }}>{formatearEuros(Number(m.importe_cent))}</b>
          </div>
          {m.sugerencias.length > 0
            ? m.sugerencias.map((sg) => <BotonSugerencia key={sg.tipo + sg.id} accion={aplicarSugerencia.bind(null, m.id, sg.tipo, sg.id)} texto={sg.etiqueta} />)
            : <span className="muted" style={{ fontSize: 13 }}>No hay ninguna factura, gasto, cobro, pago ni operación de socios que encaje.</span>}
          <FormularioOtro accion={marcarOtro.bind(null, m.id)} categorias={categorias} />
        </div>
      ))}
    </>
  );
}
