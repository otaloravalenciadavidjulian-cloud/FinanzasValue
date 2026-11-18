"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { db } from "@/db/cliente";
import { requerirSesion, ROLES_FACTURACION } from "@/lib/auth/sesion";
import { aCentimos } from "@/lib/fiscal/dinero";
import { hoyMadrid } from "@/lib/cobros/estado";
import { altaSocio, borrarOperacion, ErrorSocio, registrarOperacion, type TipoOperacion } from "@/lib/socios/socios";

export type EstadoSocios = { error?: string; ok?: string; valores?: Record<string, string> };

async function intentar(f: FormData, fn: () => Promise<string>): Promise<EstadoSocios> {
  const valores = Object.fromEntries([...f.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)]));
  try {
    const ok = await fn();
    revalidatePath("/socios");
    revalidatePath("/tesoreria");
    return { ok };
  } catch (e) {
    if (e instanceof ErrorSocio) return { error: e.message, valores };
    if (e instanceof ZodError) return { error: e.issues.map((i) => i.message).join(". "), valores };
    if (e instanceof Error && /^Importe no válido/.test(e.message)) return { error: e.message, valores };
    throw e;
  }
}

const opcional = (v: FormDataEntryValue | null) => String(v ?? "").trim() || undefined;
const numero = (v: FormDataEntryValue | null) => { const t = opcional(v); return t === undefined ? undefined : Number(t.replace(",", ".")); };

export async function crearSocio(_p: EstadoSocios, f: FormData): Promise<EstadoSocios> {
  const s = await requerirSesion(ROLES_FACTURACION);
  return intentar(f, async () => {
    await altaSocio(db(), s, { nombre: String(f.get("nombre") ?? ""), nif: opcional(f.get("nif")), participacionPct: numero(f.get("participacion")), email: opcional(f.get("email")) });
    return "Socio guardado.";
  });
}

export async function crearOperacion(_p: EstadoSocios, f: FormData): Promise<EstadoSocios> {
  const s = await requerirSesion(ROLES_FACTURACION);
  return intentar(f, async () => {
    const tipo = String(f.get("tipo")) as TipoOperacion;
    await registrarOperacion(db(), { ...s, hoy: hoyMadrid() }, {
      socioId: String(f.get("socio") ?? ""), tipo, fecha: String(f.get("fecha") ?? ""), importeCent: aCentimos(String(f.get("importe") ?? "")),
      plazo: tipo === "prestamo" ? (opcional(f.get("plazo")) as "corto" | "largo" | undefined) : undefined,
      vencimiento: tipo === "prestamo" ? opcional(f.get("vencimiento")) : undefined,
      interesPct: tipo === "prestamo" ? numero(f.get("interes")) : undefined,
      prestamoId: tipo === "devolucion" ? opcional(f.get("prestamo")) : undefined,
      concepto: opcional(f.get("concepto")),
      cuentaId: opcional(f.get("cuenta")),
    });
    return "Operación registrada. No cuenta como ingreso ni lleva IVA.";
  });
}

export async function quitarOperacion(id: string, _p: EstadoSocios, f: FormData): Promise<EstadoSocios> {
  const s = await requerirSesion(ROLES_FACTURACION);
  return intentar(f, async () => { await borrarOperacion(db(), s, id); return "Operación borrada."; });
}
