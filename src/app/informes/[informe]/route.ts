import { db, enEmpresa, type Tx } from "@/db/cliente";
import { requerirSesion, ROLES_CONTABILIDAD } from "@/lib/auth/sesion";
import { nombreCategoria } from "@/lib/gastos/categorias";
import { aCsv, fechaValida, importeCsv, respuestaCsv } from "@/lib/informes/csv";
import { CABECERA_EXPEDIDAS, CABECERA_RECIBIDAS, libroExpedidas, libroRecibidas } from "@/lib/informes/libros";
import { leerPresupuesto, PARTIDAS, realPorPartida } from "@/lib/presupuestos/presupuesto";
import { rentabilidad } from "@/lib/rentabilidad/informe";

export const dynamic = "force-dynamic";

type Generador = (tx: Tx, p: { desde: string; hasta: string }) => Promise<{ cabecera: string[]; filas: (string | number)[][] }>;

const INFORMES: Record<string, Generador> = {
  "libro-expedidas": async (tx, p) => ({ cabecera: CABECERA_EXPEDIDAS, filas: await libroExpedidas(tx, p.desde, p.hasta) }),
  "libro-recibidas": async (tx, p) => ({ cabecera: CABECERA_RECIBIDAS, filas: await libroRecibidas(tx, p.desde, p.hasta) }),
  rentabilidad: async (tx, p) => {
    const r = await rentabilidad(tx, p.desde, p.hasta);
    const linea = (dim: string, f: { nombre: string; ingresosCent: number; gastosCent: number; margenCent: number; margenPct: number | null }) =>
      [dim, f.nombre, importeCsv(f.ingresosCent), importeCsv(f.gastosCent), importeCsv(f.margenCent), f.margenPct === null ? "" : String(f.margenPct).replace(".", ",")];
    return {
      cabecera: ["Vista", "Nombre", "Ingresos", "Costes", "Margen", "Margen %"],
      filas: [linea("Total", r.total), ...r.porMes.map((m) => linea("Mes", m)), ...r.porCliente.map((c) => linea("Cliente", c)),
        ...r.porProyecto.map((x) => linea("Proyecto", x)),
        ...r.gastosPorCategoria.map((c) => ["Categoría", nombreCategoria(c.categoria), "", importeCsv(c.gastosCent), "", ""])],
    };
  },
  presupuesto: async (tx, p) => {
    const ejercicio = Number(p.desde.slice(0, 4));
    const [pres, real] = [await leerPresupuesto(tx, ejercicio), await realPorPartida(tx, ejercicio)];
    return {
      cabecera: ["Partida", "Mes", "Presupuesto", "Real", "Desviación"],
      filas: PARTIDAS.flatMap((x) => pres[x.codigo].map((v, i) => [x.nombre, `${ejercicio}-${String(i + 1).padStart(2, "0")}`,
        importeCsv(v), importeCsv(real[x.codigo][i]), importeCsv(real[x.codigo][i] - v)]))
        .filter((f) => f[2] !== "0,00" || f[3] !== "0,00"),
    };
  },
};

export async function GET(req: Request, { params }: { params: Promise<{ informe: string }> }) {
  const { informe } = await params;
  const nombre = informe.replace(/\.csv$/, "");
  const generar = INFORMES[nombre];
  if (!generar) return new Response("Informe no encontrado", { status: 404 });
  const u = new URL(req.url);
  const desde = fechaValida(u.searchParams.get("desde")), hasta = fechaValida(u.searchParams.get("hasta"));
  if (!desde || !hasta || desde > hasta) return new Response("Periodo no válido", { status: 400 });
  const s = await requerirSesion(ROLES_CONTABILIDAD);
  const { cabecera, filas } = await enEmpresa(db(), s.empresaId, async (tx) => {
    const r = await generar(tx, { desde, hasta });
    await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, despues)
      VALUES (${s.empresaId}, ${s.usuarioId}, 'exportar_informe', 'informe', ${tx.json({ informe: nombre, desde, hasta, filas: r.filas.length })})`;
    return r;
  });
  return respuestaCsv(`${nombre}-${desde}-${hasta}.csv`, aCsv(cabecera, filas));
}
