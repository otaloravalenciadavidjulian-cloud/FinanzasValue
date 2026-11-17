import Link from "next/link";
import { db, enEmpresa } from "@/db/cliente";
import { requerirSesion, ROLES_FACTURACION } from "@/lib/auth/sesion";
import { formatearEuros } from "@/lib/fiscal/dinero";
import { formatearIban } from "@/lib/tesoreria/iban";
import { CONCEPTOS_COMUNES } from "@/lib/tesoreria/norma43";
import { FormularioCuenta, FormularioImportar } from "./formularios";

export const dynamic = "force-dynamic";

interface Cuenta {
  id: string; nombre: string; iban: string; saldo: string; movimientos: number;
  ultimo_hasta: string | null; saldo_banco: string | null;
}

export default async function Tesoreria({ searchParams }: { searchParams: Promise<{ cuenta?: string }> }) {
  const { cuenta: filtro } = await searchParams;
  const s = await requerirSesion(ROLES_FACTURACION);
  const cuentaFiltro = filtro && /^[0-9a-f-]{36}$/.test(filtro) ? filtro : null;
  const { cuentas, movimientos } = await enEmpresa(db(), s.empresaId, async (tx) => {
    const cuentas = await tx<Cuenta[]>`
      SELECT c.id, c.nombre, c.iban,
             c.saldo_inicial_cent + coalesce((SELECT sum(importe_cent) FROM movimientos_bancarios m WHERE m.cuenta_id = c.id), 0) AS saldo,
             (SELECT count(*)::int FROM movimientos_bancarios m WHERE m.cuenta_id = c.id) AS movimientos,
             u.hasta AS ultimo_hasta, u.saldo_final_cent AS saldo_banco
      FROM cuentas_bancarias c
      LEFT JOIN LATERAL (SELECT to_char(fecha_hasta,'DD/MM/YYYY') AS hasta, saldo_final_cent FROM importaciones_bancarias i
                         WHERE i.cuenta_id = c.id ORDER BY fecha_hasta DESC, creado_en DESC LIMIT 1) u ON true
      WHERE c.activa ORDER BY c.nombre`;
    const movimientos = await tx<{ id: string; fecha: string; cuenta: string; concepto_comun: string; descripcion: string; importe_cent: string }[]>`
      SELECT m.id, to_char(m.fecha_operacion,'DD/MM/YYYY') AS fecha, c.nombre AS cuenta, m.concepto_comun, m.descripcion, m.importe_cent
      FROM movimientos_bancarios m JOIN cuentas_bancarias c ON c.id = m.cuenta_id
      WHERE (${cuentaFiltro}::uuid IS NULL OR m.cuenta_id = ${cuentaFiltro}::uuid)
      ORDER BY m.fecha_operacion DESC, m.creado_en DESC LIMIT 200`;
    return { cuentas, movimientos };
  });
  const total = cuentas.reduce((a, c) => a + Number(c.saldo), 0);
  return (
    <>
      <h1>Tesorería</h1>
      <div className="panel">
        <p style={{ margin: "0 0 10px" }}>Saldo en bancos: <b>{formatearEuros(total)}</b></p>
        <table>
          <thead><tr><th>Cuenta</th><th>IBAN</th><th>Último extracto</th><th className="num">Movimientos</th><th className="num">Saldo</th></tr></thead>
          <tbody>
            {cuentas.map((c) => {
              const descuadre = c.saldo_banco !== null && Number(c.saldo_banco) !== Number(c.saldo);
              return (
                <tr key={c.id}>
                  <td><Link href={`/tesoreria?cuenta=${c.id}`}>{c.nombre}</Link></td>
                  <td className="mono">{formatearIban(c.iban)}</td>
                  <td>{c.ultimo_hasta ?? "—"}</td>
                  <td className="num">{c.movimientos}</td>
                  <td className="num">{formatearEuros(Number(c.saldo))}
                    {descuadre && <div className="error" style={{ padding: "2px 6px", fontSize: 11 }}>El banco indica {formatearEuros(Number(c.saldo_banco))}: falta algún extracto</div>}
                  </td>
                </tr>
              );
            })}
            {!cuentas.length && <tr><td colSpan={5} className="muted">Añade tu primera cuenta bancaria para importar sus movimientos.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="panel" style={{ display: "grid", gap: 20 }}>
        {cuentas.length > 0 && <FormularioImportar cuentas={cuentas.map(({ id, nombre }) => ({ id, nombre }))} />}
        <FormularioCuenta />
      </div>
      <div className="panel">
        <b>Movimientos{cuentaFiltro ? ` de ${cuentas.find((c) => c.id === cuentaFiltro)?.nombre ?? "la cuenta"}` : ""}</b>
        {cuentaFiltro && <> · <Link href="/tesoreria">ver todas las cuentas</Link></>}
        <table>
          <thead><tr><th>Fecha</th><th>Cuenta</th><th>Tipo</th><th>Concepto</th><th className="num">Importe</th></tr></thead>
          <tbody>
            {movimientos.map((m) => (
              <tr key={m.id}><td>{m.fecha}</td><td>{m.cuenta}</td><td className="muted">{CONCEPTOS_COMUNES[m.concepto_comun] ?? m.concepto_comun}</td>
                <td>{m.descripcion}</td>
                <td className="num" style={{ color: Number(m.importe_cent) < 0 ? "var(--bad)" : undefined }}>{formatearEuros(Number(m.importe_cent))}</td></tr>
            ))}
            {!movimientos.length && <tr><td colSpan={5} className="muted">Sin movimientos importados.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
