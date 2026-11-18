import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_ADMINISTRACION, ROLES_CONTABILIDAD, ROLES_EMPRESA_EDICION } from "@/lib/auth/sesion";
import { entornoAEAT } from "@/lib/facturacion/documento";
import { leerEmpresa } from "@/lib/empresas/datos";
import { formatearIban } from "@/lib/tesoreria/iban";
import { BorrarFacturasPrueba, FormularioEmpresa, FormularioLogotipo, InterruptorVerifactu } from "./formularios";

export const dynamic = "force-dynamic";

export default async function Empresa() {
  const s = await requerirSesion(ROLES_CONTABILIDAD);
  const [e, facturas, verifactu] = await enEmpresa(db(), s.empresaId, async (tx) => [
    await leerEmpresa(tx, s.empresaId),
    Number((await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM facturas`)[0].n),
    (await tx<{ v: boolean }[]>`SELECT verifactu_activo AS v FROM empresas WHERE id = ${s.empresaId}`)[0].v,
  ] as const);
  const admin = ROLES_ADMINISTRACION.includes(s.rol);
  const pruebas = entornoAEAT() === "pruebas" && ROLES_ADMINISTRACION.includes(s.rol);
  const editable = ROLES_EMPRESA_EDICION.includes(s.rol);
  return (
    <>
      <h1>Empresa</h1>
      <FormularioEmpresa editable={editable} d={{ ...e, iban: e.iban ? formatearIban(e.iban) : null }} />
      {editable && <FormularioLogotipo tiene={!!e.logotipoId} version={e.logotipoId ?? ""} />}
      {admin && <InterruptorVerifactu activo={verifactu} />}
      {pruebas && <BorrarFacturasPrueba facturas={facturas} />}
    </>
  );
}
