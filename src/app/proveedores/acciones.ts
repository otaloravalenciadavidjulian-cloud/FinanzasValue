"use server";
import { guardarTercero, type EstadoTercero } from "../clientes/acciones";

export async function crearProveedor(_p: EstadoTercero, f: FormData): Promise<EstadoTercero> {
  return guardarTercero("proveedor", f);
}
