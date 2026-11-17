import { requerirSesion, ROLES_CONTABILIDAD } from "@/lib/auth/sesion";
import { hoyMadrid } from "@/lib/cobros/estado";
import { fechaValida } from "@/lib/informes/csv";

export const dynamic = "force-dynamic";

const INFORMES = [
  { ruta: "/informes/libro-expedidas.csv", titulo: "Libro registro de facturas expedidas", texto: "Una línea por factura y tipo de IVA, con rectificativas y anuladas. Para la gestoría y para cuadrar el 303." },
  { ruta: "/informes/libro-recibidas.csv", titulo: "Libro registro de facturas recibidas", texto: "Gastos con su número de orden, IVA soportado, % deducible y si tienen justificante. No incluye la papelera." },
  { ruta: "/contabilidad/diario.csv", titulo: "Libro diario", texto: "Asientos del PGC generados desde facturas, gastos, cobros, pagos y banco." },
  { ruta: "/informes/rentabilidad.csv", titulo: "Rentabilidad", texto: "Ingresos, costes y margen en total, por mes, cliente, proyecto y categoría." },
  { ruta: "/informes/presupuesto.csv", titulo: "Presupuesto frente a real", texto: "Por partida y mes del ejercicio de la fecha inicial." },
];

export default async function Informes({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; periodo?: string }> }) {
  const q = await searchParams;
  await requerirSesion(ROLES_CONTABILIDAD);
  const hoy = hoyMadrid(), anio = Number(hoy.slice(0, 4)), trim = Math.ceil(Number(hoy.slice(5, 7)) / 3);
  const periodos = [
    { id: "anio", nombre: `Año ${anio}`, desde: `${anio}-01-01`, hasta: `${anio}-12-31` },
    ...[1, 2, 3, 4].filter((t) => t <= trim).map((t) => ({ id: `t${t}`, nombre: `${t}T ${anio}`, desde: `${anio}-${String(t * 3 - 2).padStart(2, "0")}-01`,
      hasta: `${anio}-${String(t * 3).padStart(2, "0")}-${t === 1 || t === 4 ? "31" : "30"}` })),
    { id: "anterior", nombre: `Año ${anio - 1}`, desde: `${anio - 1}-01-01`, hasta: `${anio - 1}-12-31` },
  ];
  const elegido = periodos.find((p) => p.id === q.periodo);
  const desde = elegido?.desde ?? fechaValida(q.desde ?? null) ?? `${anio}-01-01`;
  const hasta = elegido?.hasta ?? fechaValida(q.hasta ?? null) ?? `${anio}-12-31`;
  const invalido = desde > hasta;
  return (
    <>
      <h1>Informes</h1>
      <p className="muted">Descargas en CSV que se abren directamente en Excel (separador «;» y coma decimal). Cada descarga queda en la auditoría.</p>
      <div className="panel" style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {periodos.map((p) => <a key={p.id} className={p.desde === desde && p.hasta === hasta ? "btn" : "btn btn-sec"} href={`?periodo=${p.id}`}>{p.nombre}</a>)}
        </div>
        <form style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <label>Desde<input type="date" name="desde" defaultValue={desde} /></label>
          <label>Hasta<input type="date" name="hasta" defaultValue={hasta} /></label>
          <button className="btn btn-sec">Aplicar</button>
        </form>
        {invalido && <div className="error">La fecha inicial es posterior a la final.</div>}
      </div>
      <div className="panel">
        <table>
          <thead><tr><th>Informe</th><th>Contenido</th><th /></tr></thead>
          <tbody>
            {INFORMES.map((i) => (
              <tr key={i.ruta}>
                <td><b>{i.titulo}</b></td>
                <td className="muted" style={{ fontSize: 13 }}>{i.texto}</td>
                <td className="num">{!invalido && <a className="btn btn-sec" href={`${i.ruta}?desde=${desde}&hasta=${hasta}`} download>Descargar CSV</a>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12 }}>Value prepara estos libros para revisarlos y entregarlos a la gestoría; no se envían a la AEAT.</p>
      </div>
    </>
  );
}
