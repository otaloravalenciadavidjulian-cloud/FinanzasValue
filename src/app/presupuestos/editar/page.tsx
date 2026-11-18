import Link from "next/link";
import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_FACTURACION } from "@/lib/auth/sesion";
import { hoyMadrid } from "@/lib/cobros/estado";
import { leerPresupuesto, PARTIDAS, proponerDesdeReal, realPorPartida } from "@/lib/presupuestos/presupuesto";
import { FormularioPresupuesto } from "./formulario";

export const dynamic = "force-dynamic";

export default async function EditarPresupuesto({ searchParams }: { searchParams: Promise<{ ejercicio?: string; base?: string; ajuste?: string }> }) {
  const q = await searchParams;
  const s = await requerirSesion(ROLES_FACTURACION);
  const ejercicio = /^\d{4}$/.test(q.ejercicio ?? "") ? Number(q.ejercicio) : Number(hoyMadrid().slice(0, 4));
  const base = /^\d{4}$/.test(q.base ?? "") ? Number(q.base) : null;
  const ajuste = Number.isFinite(Number(q.ajuste)) ? Math.max(-90, Math.min(500, Number(q.ajuste ?? 0))) : 0;
  const valores = await enEmpresa(db(), s.empresaId, async (tx) =>
    base ? proponerDesdeReal(await realPorPartida(tx, base), ajuste) : leerPresupuesto(tx, ejercicio));
  return (
    <>
      <h1>Presupuesto {ejercicio}</h1>
      <p className="muted"><Link href={`/presupuestos?ejercicio=${ejercicio}`}>← Volver a la comparación</Link></p>
      <form className="panel" style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
        <input type="hidden" name="ejercicio" value={ejercicio} />
        <label>Partir de lo real de<input name="base" type="number" min={2000} max={2100} defaultValue={base ?? ejercicio - 1} style={{ width: 100 }} /></label>
        <label>con un ajuste de (%)<input name="ajuste" type="number" step="0.1" defaultValue={ajuste} style={{ width: 100 }} /></label>
        <button className="btn btn-sec">Rellenar</button>
        <span className="muted" style={{ fontSize: 13 }}>Solo rellena la tabla: no se guarda nada hasta que pulses «Guardar presupuesto».</span>
      </form>
      {base && <div className="aviso panel">Propuesta a partir de lo real de {base}{ajuste ? ` con un ajuste del ${ajuste.toLocaleString("es-ES")} %` : ""}. Revísala y guárdala.</div>}
      <FormularioPresupuesto key={`${base}-${ajuste}`} ejercicio={ejercicio} partidas={PARTIDAS} valores={valores} />
    </>
  );
}
