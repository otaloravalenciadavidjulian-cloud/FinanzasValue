import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion } from "@/lib/auth/sesion";
import { fechaHoraHusoMadrid } from "@/lib/verifactu/huella";
import { Formulario } from "./formulario";

export const dynamic = "force-dynamic";

export default async function NuevaFactura() {
  const clientes = await enEmpresa(db(), (await requerirSesion()).empresaId, (tx) =>
    tx<{ id: string; razon_social: string }[]>`SELECT id, razon_social FROM terceros WHERE es_cliente AND borrado_en IS NULL ORDER BY razon_social`);
  return (
    <>
      <h1>Nueva factura</h1>
      <Formulario clientes={[...clientes]} hoy={fechaHoraHusoMadrid().slice(0, 10)} />
    </>
  );
}
