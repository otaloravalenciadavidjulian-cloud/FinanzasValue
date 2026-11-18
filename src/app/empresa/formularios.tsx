"use client";
import { useActionState } from "react";
import { guardarDatos, subirLogotipo } from "./acciones";

type Datos = Record<string, string | null>;
const Estado = ({ e }: { e: { error?: string; ok?: string } }) => (e.error ? <div className="error">{e.error}</div> : e.ok ? <div className="aviso">{e.ok}</div> : null);

export function FormularioEmpresa({ d, editable }: { d: Datos; editable: boolean }) {
  const [e, accion, enviando] = useActionState(guardarDatos, {});
  const campo = (name: string, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label>{label}<input name={name} defaultValue={d[name] ?? ""} disabled={!editable} {...extra} /></label>
  );
  return (
    <form action={accion} className="panel" style={{ display: "grid", gap: 10 }}>
      <b>Datos que aparecen en las facturas</b>
      <Estado e={e} />
      <div className="grid">
        <label>Razón social<input value={d.razonSocial ?? ""} disabled readOnly /></label>
        <label>NIF<input value={d.nif ?? ""} disabled readOnly /></label>
        {campo("nombreComercial", "Nombre comercial (opcional)")}
      </div>
      <div className="grid">
        {campo("domicilio", "Domicilio", { required: true })}
        {campo("codigoPostal", "Código postal", { required: true, pattern: "\\d{5}", inputMode: "numeric" })}
        {campo("municipio", "Municipio", { required: true })}
        {campo("provincia", "Provincia", { required: true })}
      </div>
      <div className="grid">
        {campo("email", "Email", { type: "email" })}
        {campo("telefono", "Teléfono")}
      </div>
      <div className="grid">
        {campo("iban", "Cuenta para cobros (IBAN)")}
        {campo("banco", "Banco (opcional)")}
      </div>
      <label>Texto al pie de las facturas (opcional, hasta 600 caracteres)
        <textarea name="textoPie" rows={3} maxLength={600} defaultValue={d.textoPie ?? ""} disabled={!editable}
          placeholder="Por ejemplo, las marcas o webs de la empresa" />
      </label>
      {campo("datosRegistrales", "Datos del Registro Mercantil (pie de las facturas)")}
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>La razón social y el NIF identifican a la empresa ante la AEAT en VERI*FACTU y no se cambian desde aquí.</p>
      {editable && <div><button className="btn" disabled={enviando}>{enviando ? "Guardando…" : "Guardar"}</button></div>}
    </form>
  );
}

export function FormularioLogotipo({ tiene, version }: { tiene: boolean; version: string }) {
  const [e, accion, enviando] = useActionState(subirLogotipo, {});
  return (
    <form action={accion} className="panel" style={{ display: "grid", gap: 10 }}>
      <b>Logotipo</b>
      <Estado e={e} />
      {tiene
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={`/empresa/logotipo?v=${version}`} alt="Logotipo actual" style={{ maxWidth: 240, maxHeight: 72, objectFit: "contain", background: "#fff", padding: 6, borderRadius: 6, border: "1px solid var(--line)" }} />
        : <p className="muted" style={{ margin: 0 }}>Sin logotipo: las facturas muestran solo el nombre.</p>}
      <label>Imagen PNG o JPG, hasta 1 MB (mejor con fondo blanco o transparente)<input type="file" name="logo" accept="image/png,image/jpeg" /></label>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" disabled={enviando}>{enviando ? "Subiendo…" : "Guardar logotipo"}</button>
        {tiene && <button className="btn btn-sec" name="quitar" value="1" disabled={enviando}>Quitar</button>}
      </div>
    </form>
  );
}
