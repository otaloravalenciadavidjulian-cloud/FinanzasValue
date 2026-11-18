"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db/cliente";
import { requerirSesion, ROLES_FACTURACION } from "@/lib/auth/sesion";
import {
  cobrarYConciliar, conciliarConCobro, conciliarConPago, conciliarConSocio, conciliarOtro, deshacerConciliacion, ErrorConciliacion, pagarYConciliar, type Sugerencia,
} from "@/lib/tesoreria/conciliar";

type Estado = { error?: string };

async function ejecutar(f: () => Promise<unknown>): Promise<Estado> {
  try {
    await f();
  } catch (e) {
    if (e instanceof ErrorConciliacion) return { error: e.message };
    throw e;
  }
  revalidatePath("/tesoreria");
  revalidatePath("/tesoreria/conciliar");
  revalidatePath("/facturas");
  revalidatePath("/gastos");
  revalidatePath("/socios");
  return {};
}

export async function aplicarSugerencia(movId: string, tipo: Sugerencia["tipo"], id: string, _p: Estado): Promise<Estado> {
  const s = await requerirSesion(ROLES_FACTURACION);
  return ejecutar(() => {
    switch (tipo) {
      case "cobro": return conciliarConCobro(db(), s, movId, id);
      case "pago": return conciliarConPago(db(), s, movId, id);
      case "factura": return cobrarYConciliar(db(), s, movId, id);
      case "gasto": return pagarYConciliar(db(), s, movId, id);
      case "socio": return conciliarConSocio(db(), s, movId, id);
    }
  });
}

export async function marcarOtro(movId: string, _p: Estado, f: FormData): Promise<Estado> {
  const s = await requerirSesion(ROLES_FACTURACION);
  return ejecutar(() => conciliarOtro(db(), s, movId, String(f.get("categoria") ?? ""), String(f.get("nota") ?? "")));
}

export async function deshacer(movId: string, _p: Estado, f: FormData): Promise<Estado> {
  const s = await requerirSesion(ROLES_FACTURACION);
  return ejecutar(() => deshacerConciliacion(db(), s, movId, String(f.get("motivo") ?? "")));
}
