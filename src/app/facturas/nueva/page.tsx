import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion } from "@/lib/auth/sesion";
import { fechaHoraHusoMadrid } from "@/lib/verifactu/huella";
import { Formulario } from "./formulario";

export const dynamic = "force-dynamic";

export default async function NuevaFactura() {
  const { clientes, proyectos } = await enEmpresa(db(), (await requerirSesion()).empresaId, async (tx) => ({
    clientes: await tx<{ id: string; razon_social: string }[]>`SELECT id, razon_social FROM terceros WHERE es_cliente AND borrado_en IS NULL ORDER BY razon_social`,
    proyectos: await tx<{ id: string; nombre: string }[]>`SELECT id, nombre FROM proyectos WHERE activo ORDER BY nombre`,
  }));
  return (
    <>
      <h1>Nueva factura</h1>
      <Formulario clientes={[...clientes]} proyectos={[...proyectos]} hoy={fechaHoraHusoMadrid().slice(0, 10)} />
    </>
  );
}
