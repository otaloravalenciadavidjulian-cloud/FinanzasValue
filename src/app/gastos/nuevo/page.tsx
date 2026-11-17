import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_GASTOS } from "@/lib/auth/sesion";
import { hoyMadrid } from "@/lib/cobros/estado";
import { CATEGORIAS_GASTO } from "@/lib/gastos/categorias";
import { iaDisponible } from "@/lib/documentos/lectura";
import { AltaGasto } from "./formulario";

export const dynamic = "force-dynamic";

export default async function NuevoGasto() {
  const { empresaId, rol } = await requerirSesion(ROLES_GASTOS);
  const { proveedores, proyectos } = await enEmpresa(db(), empresaId, async (tx) => ({
    proveedores: await tx<{ id: string; razon_social: string; nif: string }[]>`
      SELECT id, razon_social, nif FROM terceros WHERE es_proveedor AND borrado_en IS NULL ORDER BY razon_social`,
    proyectos: await tx<{ id: string; nombre: string }[]>`SELECT id, nombre FROM proyectos WHERE activo ORDER BY nombre`,
  }));
  return (
    <>
      <h1>Nuevo gasto</h1>
      <AltaGasto proveedores={proveedores} proyectos={proyectos} categorias={CATEGORIAS_GASTO.map(({ codigo, nombre }) => ({ codigo, nombre }))} hoy={hoyMadrid()}
        puedeAltaProveedor={rol !== "empleado"} iaActiva={iaDisponible()} />
    </>
  );
}
