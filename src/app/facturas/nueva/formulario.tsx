"use client";
import { useActionState, useState } from "react";
import { CAUSAS_IVA } from "@/lib/fiscal/exenciones";
import { aCentimos, formatearEuros } from "@/lib/fiscal/dinero";
import { baseDesdeConIva, conIva } from "@/lib/fiscal/precio";
import { calcularTotales } from "@/lib/fiscal/totales";
import { emitir } from "./acciones";

export function Formulario({ clientes, proyectos, hoy }: { clientes: { id: string; razon_social: string }[]; proyectos: { id: string; nombre: string }[]; hoy: string }) {
  const [estado, accion, enviando] = useActionState(emitir, {});
  const v = (k: string, i = 0, def = "") => estado.valores?.[k]?.[i] ?? def;
  const [retencion, setRetencion] = useState(Number(v("retencion", 0, "0")));
  return (
    <form key={JSON.stringify(estado.valores ?? {})} action={accion} className="panel" style={{ display: "grid", gap: 14 }}>
      {estado.error && <div className="error">{estado.error}</div>}
      <div className="grid">
        <label>Serie<select name="serie" defaultValue="A"><option value="A">A · Ordinarias</option></select></label>
        <label>Cliente<select name="cliente" required defaultValue={v("cliente")}><option value="" disabled>Selecciona…</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}</select></label>
        <label>Fecha de expedición<input type="date" name="fecha" defaultValue={v("fecha", 0, hoy)} max={hoy} required /></label>
        <label>Vencimiento<input type="date" name="vencimiento" defaultValue={v("vencimiento")} /></label>
        {proyectos.length > 0 && <label>Proyecto<select name="proyecto" defaultValue={v("proyecto")}><option value="">— Ninguno —</option>{proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>}
        <label>Retención IRPF<select name="retencion" defaultValue={v("retencion", 0, "0")} onChange={(e) => setRetencion(Number(e.target.value))}>{[0, 7, 15, 19].map((x) => <option key={x} value={x}>{x} %</option>)}</select></label>
        <label>Referencia o nº de pedido<input name="referencia" maxLength={100} defaultValue={v("referencia")} /></label>
        <label>Forma de pago<input name="metodoCobro" list="formas-pago" maxLength={100} defaultValue={v("metodoCobro")} /></label>
        <datalist id="formas-pago">{["Transferencia bancaria", "Domiciliación bancaria", "Tarjeta", "Efectivo", "Bizum"].map((x) => <option key={x} value={x} />)}</datalist>
      </div>
      <Lineas key={JSON.stringify(estado.valores ?? {})} valores={estado.valores} retencion={retencion} />
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        <label>Condiciones de pago (opcional)<textarea name="condicionesPago" rows={2} maxLength={500} defaultValue={v("condicionesPago")} /></label>
        <label>Observaciones (opcional)<textarea name="observaciones" rows={2} maxLength={1000} defaultValue={v("observaciones")} /></label>
      </div>
      <p className="muted">Al emitir se asigna el número correlativo, se genera el registro con huella encadenada y la factura queda bloqueada.</p>
      <div><button className="btn" disabled={enviando}>{enviando ? "Emitiendo…" : "Emitir factura"}</button></div>
    </form>
  );
}

type Fila = { cantidad: string; precio: string; precioIva: string; descuento: string; iva: string };

const centimos = (t: string) => { try { return aCentimos(t || "0"); } catch { return null; } };
const numero = (t: string) => { const n = Number(String(t).replace(",", ".")); return Number.isFinite(n) ? n : null; };
const texto = (c: number) => (c / 100).toFixed(2).replace(".", ",");
const tipo = (iva: string) => Number(iva.split(":")[0]);

/** Líneas de la factura: se puede escribir el precio sin IVA o con IVA, y el otro se calcula. Se guarda siempre la base. */
function Lineas({ valores, retencion }: { valores?: Record<string, string[]>; retencion: number }) {
  const v = (k: string, i: number, def = "") => valores?.[k]?.[i] ?? def;
  const inicial = (i: number): Fila => {
    const precio = v("precio", i);
    const iva = v("iva", i, "21");
    const c = precio ? centimos(precio) : null;
    return { cantidad: v("cantidad", i, "1"), precio, precioIva: c === null ? "" : texto(conIva(c, tipo(iva))), descuento: v("descuento", i, "0"), iva };
  };
  const [filas, setFilas] = useState<Fila[]>(() => Array.from({ length: Math.max(3, valores?.concepto?.length ?? 0) }, (_, i) => inicial(i)));
  const cambiar = (i: number, cambio: Partial<Fila>) => setFilas((fs) => fs.map((f, j) => {
    if (j !== i) return f;
    const n = { ...f, ...cambio };
    if ("precioIva" in cambio) { const c = centimos(n.precioIva); n.precio = n.precioIva.trim() === "" ? "" : c === null ? n.precio : texto(baseDesdeConIva(c, tipo(n.iva))); }
    else if ("precio" in cambio || "iva" in cambio) { const c = centimos(n.precio); n.precioIva = n.precio.trim() === "" ? "" : c === null ? n.precioIva : texto(conIva(c, tipo(n.iva))); }
    return n;
  }));

  const validas = filas.map((f) => ({ f, cantidad: numero(f.cantidad), precio: centimos(f.precio), dto: numero(f.descuento) }))
    .filter((x) => x.f.precio.trim() && x.cantidad !== null && x.precio !== null && x.dto !== null);
  let totales: ReturnType<typeof calcularTotales> | null = null;
  try {
    if (validas.length) totales = calcularTotales(validas.map((x) => ({ concepto: "-", cantidad: x.cantidad!, precioUnitarioCent: x.precio!, descuentoPct: x.dto!, tipoIva: tipo(x.f.iva), causaIva: x.f.iva.split(":")[1] || null })), retencion);
  } catch { totales = null; }
  const importe = (f: Fila) => {
    const q = numero(f.cantidad), p = centimos(f.precio), d = numero(f.descuento);
    if (!f.precio.trim() || q === null || p === null || d === null) return "";
    const base = Math.round(q * p * (1 - d / 100));
    return formatearEuros(conIva(base, tipo(f.iva)));
  };

  return (
    <>
      <table className="lineas-factura">
        <colgroup><col style={{ width: "28%" }} /><col style={{ width: "8%" }} /><col style={{ width: "12%" }} /><col style={{ width: "12%" }} /><col style={{ width: "8%" }} /><col style={{ width: "18%" }} /><col style={{ width: "14%" }} /></colgroup>
        <thead><tr><th>Concepto</th><th>Cantidad</th><th>Precio sin IVA (€)</th><th>Precio con IVA (€)</th><th>Dto. %</th><th>IVA</th><th style={{ textAlign: "right" }}>Importe con IVA</th></tr></thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i}>
              <td><input name="concepto" defaultValue={v("concepto", i)} required={i === 0} style={{ width: "100%" }} /></td>
              <td><input name="cantidad" value={f.cantidad} onChange={(e) => cambiar(i, { cantidad: e.target.value })} inputMode="decimal" /></td>
              <td><input name="precio" value={f.precio} onChange={(e) => cambiar(i, { precio: e.target.value })} inputMode="decimal" placeholder="0,00" aria-label="Precio unitario sin IVA" /></td>
              <td><input value={f.precioIva} onChange={(e) => cambiar(i, { precioIva: e.target.value })} inputMode="decimal" placeholder="0,00" aria-label="Precio unitario con IVA" /></td>
              <td><input name="descuento" value={f.descuento} onChange={(e) => cambiar(i, { descuento: e.target.value })} inputMode="decimal" /></td>
              <td><select name="iva" value={f.iva} onChange={(e) => cambiar(i, { iva: e.target.value })} aria-label="IVA">
                {[21, 10, 4].map((x) => <option key={x} value={x}>{x} %</option>)}
                <optgroup label="Sin IVA (la factura llevará la mención legal)">
                  {CAUSAS_IVA.map((c) => <option key={c.codigo} value={`0:${c.codigo}`}>0 % · {c.nombre}</option>)}
                </optgroup>
              </select></td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{importe(f)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <button type="button" className="btn secundario" onClick={() => setFilas((fs) => [...fs, { cantidad: "1", precio: "", precioIva: "", descuento: "0", iva: "21" }])}>+ Añadir línea</button>
        <table className="totales-factura" aria-label="Totales">
          <tbody>
            <tr><td>Base imponible (sin IVA)</td><td>{formatearEuros(totales?.baseCent ?? 0)}</td></tr>
            {totales?.desglose.filter((d) => d.tipoIva > 0).map((d) => <tr key={d.tipoIva}><td>IVA {d.tipoIva} %</td><td>{formatearEuros(d.cuotaCent)}</td></tr>)}
            {!!totales?.retencionCent && <tr><td>Retención IRPF {retencion} %</td><td>−{formatearEuros(totales.retencionCent)}</td></tr>}
            <tr className="total"><td>Total a cobrar</td><td>{formatearEuros(totales?.totalCent ?? 0)}</td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
