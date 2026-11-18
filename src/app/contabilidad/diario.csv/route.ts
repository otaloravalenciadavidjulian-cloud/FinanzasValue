import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_CONTABILIDAD } from "@/lib/auth/sesion";
import { CUENTAS, generarAsientos } from "@/lib/contabilidad/asientos";
import { aCsv, fechaCsv, fechaValida, importeOVacio, respuestaCsv } from "@/lib/informes/csv";

export const dynamic = "force-dynamic";

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
  const filas = asientos.flatMap((a, i) => a.apuntes.map((p) =>
    [i + 1, fechaCsv(a.fecha), p.cuenta, CUENTAS[p.cuenta] ?? "", p.concepto, importeOVacio(p.debeCent), importeOVacio(p.haberCent)]));
  return respuestaCsv(`diario-${desde}-${hasta}.csv`, aCsv(["Asiento", "Fecha", "Cuenta", "Nombre de la cuenta", "Concepto", "Debe", "Haber"], filas));
}
