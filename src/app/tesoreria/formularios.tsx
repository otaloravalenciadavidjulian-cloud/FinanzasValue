"use client";
import { useActionState } from "react";
import { crearCuenta, importar } from "./acciones";

export function FormularioCuenta() {
  const [estado, accion, enviando] = useActionState(crearCuenta, {});
  return (
    <form key={JSON.stringify(estado)} action={accion} style={{ display: "grid", gap: 10 }}>
      <b>Nueva cuenta bancaria</b>
      {estado.error && <div className="error">{estado.error}</div>}
      {estado.ok && <div className="muted">{estado.ok}</div>}
      <div className="grid">
        <label>Nombre<input name="nombre" required placeholder="p. ej. BBVA principal" defaultValue={estado.valores?.nombre} /></label>
        <label>IBAN<input name="iban" required placeholder="ES00 0000 0000 0000 0000 0000" defaultValue={estado.valores?.iban} /></label>
      </div>
      <div><button className="btn" disabled={enviando}>{enviando ? "Guardando…" : "Añadir cuenta"}</button></div>
    </form>
  );
}

export function FormularioImportar({ cuentas }: { cuentas: { id: string; nombre: string }[] }) {
  const [estado, accion, enviando] = useActionState(importar, {});
  return (
    <form key={JSON.stringify(estado)} action={accion} style={{ display: "grid", gap: 10 }}>
      <b>Importar extracto</b>
      <p className="muted" style={{ margin: 0 }}>
        Descarga el extracto de tu banca online en formato <b>Norma 43</b> (también llamado «cuaderno 43», AEB 43 o CSB 43).
        Si se solapa con uno anterior, los movimientos repetidos se ignoran.
      </p>
      {estado.error && <div className="error">{estado.error}</div>}
      {estado.ok && <div className="aviso">{estado.ok}</div>}
      <div className="grid">
        <label>Cuenta
          <select name="cuenta" required defaultValue={estado.valores?.cuenta ?? (cuentas.length === 1 ? cuentas[0].id : "")}>
            <option value="">— Elige —</option>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label>Fichero<input type="file" name="archivo" required accept=".n43,.txt,.aeb,.csb,.q43,text/plain" /></label>
      </div>
      <div><button className="btn" disabled={enviando}>{enviando ? "Importando…" : "Importar"}</button></div>
    </form>
  );
}
