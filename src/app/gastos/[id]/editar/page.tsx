import Link from "next/link";
import { notFound } from "next/navigation";
import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_GASTOS } from "@/lib/auth/sesion";
import { hoyMadrid } from "@/lib/cobros/estado";
import { CATEGORIAS_GASTO } from "@/lib/gastos/categorias";
import { actualizarGasto } from "../../acciones";
import { FormularioGasto } from "../../nuevo/formulario";

export const dynamic = "force-dynamic";

const decimal = (c: string | number) => (Number(c) / 100).toFixed(2).replace(".", ",");
const pct = (n: string | number) => String(Number(n)).replace(".", ",");

export default async function EditarGasto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await requerirSesion(ROLES_GASTOS);
  const datos = await enEmpresa(db(), s.empresaId, async (tx) => {
    const [g] = await tx`SELECT *, to_char(fecha_expedicion,'YYYY-MM-DD') AS fecha, to_char(vencimiento,'YYYY-MM-DD') AS venc FROM gastos WHERE id = ${id}`;
    if (!g || (s.rol === "empleado" && g.creado_por !== s.usuarioId)) return null;
    const desglose = await tx`SELECT * FROM desglose_gasto WHERE gasto_id = ${id} ORDER BY tipo_iva DESC`;
    const proveedores = await tx<{ id: string; razon_social: string; nif: string }[]>`
      SELECT id, razon_social, nif FROM terceros WHERE (es_proveedor AND borrado_en IS NULL) OR id = ${g.proveedor_id} ORDER BY razon_social`;
    const proyectos = await tx<{ id: string; nombre: string }[]>`SELECT id, nombre FROM proyectos WHERE activo OR id = ${g.proyecto_id} ORDER BY nombre`;
    return { g, desglose, proveedores, proyectos };
  });
  if (!datos) notFound();
  const { g, desglose, proveedores, proyectos } = datos;
  if (g.borrado_en) {
    return <><h1>Editar gasto</h1><div className="aviso">El gasto está en la papelera: restáuralo antes de editarlo. <Link href={`/gastos/${id}`}>Volver</Link></div></>;
  }
  if (desglose.length > 3) {
    return <><h1>Editar gasto</h1><div className="aviso">Este gasto tiene más de tres tipos de IVA y aún no se puede editar desde aquí. <Link href={`/gastos/${id}`}>Volver</Link></div></>;
  }
  const inicial: Record<string, string> = {
    tipo: g.tipo_documento, proveedor: g.proveedor_id ?? "", numero: g.numero ?? "", fecha: g.fecha, categoria: g.categoria,
    subcategoria: g.subcategoria ?? "", proyecto: g.proyecto_id ?? "", descripcion: g.descripcion, retencion: pct(g.retencion_pct), vencimiento: g.venc ?? "",
    metodo: g.metodo_pago ?? "", notas: g.notas ?? "",
  };
  desglose.slice(0, 3).forEach((d, i) => {
    inicial[`base${i}`] = decimal(d.base_cent);
    inicial[`iva${i}`] = String(Number(d.tipo_iva));
    inicial[`cuota${i}`] = decimal(d.cuota_cent);
    inicial[`deducible${i}`] = pct(d.deducible_pct);
  });
  return (
    <>
      <h1>Editar gasto {g.numero ?? ""}</h1>
      <p className="muted">Los cambios quedan en la auditoría con el valor anterior y el nuevo. <Link href={`/gastos/${id}`}>Cancelar</Link></p>
      <FormularioGasto proveedores={proveedores} proyectos={proyectos} categorias={CATEGORIAS_GASTO.map(({ codigo, nombre }) => ({ codigo, nombre }))} hoy={hoyMadrid()}
        puedeAltaProveedor={false} guardar={actualizarGasto.bind(null, id)} inicial={inicial} boton="Guardar cambios" />
    </>
  );
}
