import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_GASTOS } from "@/lib/auth/sesion";
import { hoyMadrid } from "@/lib/cobros/estado";
import { CATEGORIAS_GASTO } from "@/lib/gastos/categorias";
import { FormularioGasto } from "./formulario";

export const dynamic = "force-dynamic";

export default async function NuevoGasto() {
  const { empresaId } = await requerirSesion(ROLES_GASTOS);
  const proveedores = await enEmpresa(db(), empresaId, (tx) => tx<{ id: string; razon_social: string; nif: string }[]>`
    SELECT id, razon_social, nif FROM terceros WHERE es_proveedor AND borrado_en IS NULL ORDER BY razon_social`);
  return (
    <>
      <h1>Nuevo gasto</h1>
      <FormularioGasto proveedores={proveedores} categorias={CATEGORIAS_GASTO.map(({ codigo, nombre }) => ({ codigo, nombre }))} hoy={hoyMadrid()} />
    </>
  );
}
