"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db/cliente";
import { requerirSesion, ROLES_FACTURACION } from "@/lib/auth/sesion";
import { aCentimos } from "@/lib/fiscal/dinero";
import { ErrorPresupuesto, guardarPresupuesto, PARTIDAS, type Valores } from "@/lib/presupuestos/presupuesto";

export async function guardar(ejercicio: number, _p: { error?: string }, f: FormData): Promise<{ error?: string }> {
  const s = await requerirSesion(ROLES_FACTURACION);
  const valores: Valores = {};
  try {
    for (const p of PARTIDAS) {
      valores[p.codigo] = Array.from({ length: 12 }, (_, i) => {
        const t = String(f.get(`${p.codigo}.${i + 1}`) ?? "").trim();
        if (!t) return 0;
        try { return aCentimos(t); } catch { throw new ErrorPresupuesto(`Importe no válido en ${p.nombre}, mes ${i + 1}: «${t}»`); }
      });
    }
    await guardarPresupuesto(db(), s, ejercicio, valores);
  } catch (e) {
    if (e instanceof ErrorPresupuesto) return { error: e.message };
    throw e;
  }
  revalidatePath("/presupuestos");
  redirect(`/presupuestos?ejercicio=${ejercicio}&guardado=1`);
}
