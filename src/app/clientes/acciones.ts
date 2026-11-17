"use server";
import { revalidatePath } from "next/cache";
import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_FACTURACION } from "@/lib/auth/sesion";
import { normalizarNif, validarNif } from "@/lib/fiscal/nif";

export type EstadoCliente = { error?: string; ok?: string; valores?: Record<string, string> };

export async function crearCliente(_p: EstadoCliente, f: FormData): Promise<EstadoCliente> {
  const s = await requerirSesion(ROLES_FACTURACION);
  const g = (k: string) => String(f.get(k) ?? "").trim();
  const valores = Object.fromEntries(["razon", "nif", "direccion", "cp", "municipio", "provincia", "email", "telefono", "dias"].map((k) => [k, g(k)]));
  const nif = normalizarNif(g("nif"));
  if (!g("razon")) return { error: "Indica la razón social.", valores };
  if (!validarNif(nif)) return { error: "El CIF/NIF no es válido: revisa la letra o el dígito de control.", valores };
  try {
    await enEmpresa(db(), s.empresaId, async (tx) => {
      const [c] = await tx`INSERT INTO terceros (empresa_id, es_cliente, razon_social, nif, direccion, codigo_postal, municipio, provincia, email, telefono, dias_pago)
        VALUES (${s.empresaId}, true, ${g("razon")}, ${nif}, ${g("direccion") || null}, ${g("cp") || null}, ${g("municipio") || null}, ${g("provincia") || null},
                ${g("email") || null}, ${g("telefono") || null}, ${Number(g("dias") || 30)})
        RETURNING id`;
      await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id) VALUES (${s.empresaId}, ${s.usuarioId}, 'alta_cliente', 'tercero', ${c.id})`;
    });
  } catch (e) {
    if (e instanceof Error && /terceros_empresa_id_nif_key/.test(e.message)) return { error: "Ya existe un cliente o proveedor con ese NIF.", valores };
    throw e;
  }
  revalidatePath("/clientes");
  return { ok: `Cliente ${g("razon")} guardado.` };
}
