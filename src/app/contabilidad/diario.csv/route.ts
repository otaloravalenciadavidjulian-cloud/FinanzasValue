import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_CONTABILIDAD } from "@/lib/auth/sesion";
import { CUENTAS, generarAsientos } from "@/lib/contabilidad/asientos";

export const dynamic = "force-dynamic";

const fechaValida = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
/** CSV con punto y coma y coma decimal, como lo abre Excel en España. */
const celda = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const importe = (c: number) => (c ? (c / 100).toFixed(2).replace(".", ",") : "");

export async function GET(req: Request) {
  const u = new URL(req.url);
  const desde = fechaValida(u.searchParams.get("desde")), hasta = fechaValida(u.searchParams.get("hasta"));
  if (!desde || !hasta || desde > hasta) return new Response("Periodo no válido", { status: 400 });
  const s = await requerirSesion(ROLES_CONTABILIDAD);
  const asientos = await enEmpresa(db(), s.empresaId, async (tx) => {
    const a = await generarAsientos(tx, desde, hasta);
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, despues)
      VALUES (${s.empresaId}, ${s.usuarioId}, 'exportar_diario', 'contabilidad', ${tx.json({ desde, hasta })})`;
    return a;
  });
  const filas = ["Asiento;Fecha;Cuenta;Nombre de la cuenta;Concepto;Debe;Haber"];
  asientos.forEach((a, i) => a.apuntes.forEach((p) => filas.push(
    [String(i + 1), a.fecha.split("-").reverse().join("/"), p.cuenta, CUENTAS[p.cuenta] ?? "", p.concepto, importe(p.debeCent), importe(p.haberCent)].map(celda).join(";"))));
  return new Response("﻿" + filas.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="diario-${desde}-${hasta}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
