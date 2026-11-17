import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_CONTABILIDAD, ROLES_EMPRESA_EDICION } from "@/lib/auth/sesion";
import { leerEmpresa } from "@/lib/empresas/datos";
import { formatearIban } from "@/lib/tesoreria/iban";
import { FormularioEmpresa, FormularioLogotipo } from "./formularios";

export const dynamic = "force-dynamic";

export default async function Empresa() {
  const s = await requerirSesion(ROLES_CONTABILIDAD);
  const e = await enEmpresa(db(), s.empresaId, (tx) => leerEmpresa(tx, s.empresaId));
  const editable = ROLES_EMPRESA_EDICION.includes(s.rol);
  return (
    <>
      <h1>Empresa</h1>
      <FormularioEmpresa editable={editable} d={{ ...e, iban: e.iban ? formatearIban(e.iban) : null }} />
      {editable && <FormularioLogotipo tiene={!!e.logotipoId} version={e.logotipoId ?? ""} />}
    </>
  );
}
