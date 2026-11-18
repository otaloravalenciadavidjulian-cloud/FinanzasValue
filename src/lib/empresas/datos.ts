import { enEmpresa, type Sql, type Tx } from "@/db/cliente";
import { guardarArchivo } from "@/lib/documentos/almacen";
import { normalizarIban, validarIban } from "@/lib/tesoreria/iban";

export class ErrorEmpresa extends Error {}

export interface DatosEmpresa {
  razonSocial: string; nif: string; nombreComercial: string | null; domicilio: string; codigoPostal: string;
  municipio: string; provincia: string; email: string | null; telefono: string | null; iban: string | null; banco: string | null; textoPie: string | null;
  web: string | null; bic: string | null; titularCuenta: string | null; agradecimiento: string | null;
  datosRegistrales: string | null; logotipoId: string | null;
}

const COLUMNAS = `razon_social, nif, nombre_comercial, domicilio, codigo_postal, municipio, provincia, email, telefono, iban, banco, texto_pie, web, bic, titular_cuenta, agradecimiento, datos_registrales, logotipo_documento_id`;
type Fila = Record<string, string | null>;
const aDatos = (f: Fila): DatosEmpresa => ({
  razonSocial: f.razon_social!, nif: f.nif!, nombreComercial: f.nombre_comercial, domicilio: f.domicilio!, codigoPostal: f.codigo_postal!,
  municipio: f.municipio!, provincia: f.provincia!, email: f.email, telefono: f.telefono, iban: f.iban, banco: f.banco, textoPie: f.texto_pie,
  web: f.web, bic: f.bic, titularCuenta: f.titular_cuenta, agradecimiento: f.agradecimiento,
  datosRegistrales: f.datos_registrales, logotipoId: f.logotipo_documento_id,
});

export async function leerEmpresa(tx: Tx, empresaId: string): Promise<DatosEmpresa> {
  const [f] = await tx<Fila[]>`SELECT ${tx.unsafe(COLUMNAS)} FROM empresas WHERE id = ${empresaId}`;
  return aDatos(f);
}

/** Datos de la empresa vigentes en un momento: los del historial si han cambiado después. */
export async function empresaEn(tx: Tx, empresaId: string, momento: Date | string): Promise<DatosEmpresa> {
  const [h] = await tx<{ datos: DatosEmpresa }[]>`
    SELECT datos FROM empresas_historial WHERE empresa_id = ${empresaId} AND vigente_hasta > ${momento}::timestamptz
    ORDER BY vigente_hasta LIMIT 1`;
  return h ? { ...h.datos, banco: h.datos.banco ?? null, textoPie: h.datos.textoPie ?? null, web: h.datos.web ?? null, bic: h.datos.bic ?? null,
    titularCuenta: h.datos.titularCuenta ?? null, agradecimiento: h.datos.agradecimiento ?? null } : leerEmpresa(tx, empresaId);
}

const texto = (v: string | undefined | null, max: number) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

async function guardarCambio(tx: Tx, ctx: { empresaId: string; usuarioId?: string }, antes: DatosEmpresa, despues: DatosEmpresa) {
  const cambios = (Object.keys(despues) as (keyof DatosEmpresa)[]).filter((k) => antes[k] !== despues[k]);
  if (!cambios.length) return 0;
  await tx`INSERT INTO empresas_historial (empresa_id, datos, cambiado_por) VALUES (${ctx.empresaId}, ${tx.json(antes as never)}, ${ctx.usuarioId ?? null})`;
  await tx`UPDATE empresas SET nombre_comercial = ${despues.nombreComercial}, domicilio = ${despues.domicilio}, codigo_postal = ${despues.codigoPostal},
    municipio = ${despues.municipio}, provincia = ${despues.provincia}, email = ${despues.email}, telefono = ${despues.telefono},
    iban = ${despues.iban}, banco = ${despues.banco}, texto_pie = ${despues.textoPie}, web = ${despues.web}, bic = ${despues.bic},
    titular_cuenta = ${despues.titularCuenta}, agradecimiento = ${despues.agradecimiento}, datos_registrales = ${despues.datosRegistrales}, logotipo_documento_id = ${despues.logotipoId} WHERE id = ${ctx.empresaId}`;
  await tx`INSERT INTO eventos_auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, antes, despues)
    VALUES (${ctx.empresaId}, ${ctx.usuarioId ?? null}, 'editar_empresa', 'empresa', ${ctx.empresaId},
      ${tx.json(Object.fromEntries(cambios.map((k) => [k, antes[k]])) as never)}, ${tx.json(Object.fromEntries(cambios.map((k) => [k, despues[k]])) as never)})`;
  return cambios.length;
}

export async function editarEmpresa(sql: Sql, ctx: { empresaId: string; usuarioId?: string }, d: Partial<Record<keyof DatosEmpresa, string>>) {
  const domicilio = texto(d.domicilio, 200), municipio = texto(d.municipio, 100), provincia = texto(d.provincia, 100);
  const codigoPostal = (d.codigoPostal ?? "").trim();
  if (!domicilio || !municipio || !provincia) throw new ErrorEmpresa("El domicilio, el municipio y la provincia son obligatorios");
  if (!/^\d{5}$/.test(codigoPostal)) throw new ErrorEmpresa("El código postal debe tener 5 dígitos");
  const email = texto(d.email, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErrorEmpresa("El email no es válido");
  const ibanTexto = texto(d.iban, 50);
  if (ibanTexto && !validarIban(ibanTexto)) throw new ErrorEmpresa("El IBAN no es válido");
  const bic = (d.bic ?? "").replace(/\s+/g, "").toUpperCase() || null;
  if (bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) throw new ErrorEmpresa("El BIC/SWIFT debe tener 8 u 11 caracteres");
  const web = texto(d.web, 200)?.replace(/^https?:\/\//i, "").replace(/\/$/, "") ?? null;
  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    await tx`SELECT 1 FROM empresas WHERE id = ${ctx.empresaId} FOR UPDATE`;
    const antes = await leerEmpresa(tx, ctx.empresaId);
    return guardarCambio(tx, ctx, antes, {
      ...antes, nombreComercial: texto(d.nombreComercial, 200), domicilio, codigoPostal, municipio, provincia, email,
      telefono: texto(d.telefono, 30), iban: ibanTexto ? normalizarIban(ibanTexto) : null, banco: texto(d.banco, 100), textoPie: texto(d.textoPie, 600), web, bic,
      titularCuenta: texto(d.titularCuenta, 200), agradecimiento: texto(d.agradecimiento, 300), datosRegistrales: texto(d.datosRegistrales, 300),
    });
  });
}

export const TAMANO_LOGO = 1024 * 1024;

/** Logotipo para las facturas: PNG o JPG de hasta 1 MB. Sin archivo, lo quita. */
export async function cambiarLogotipo(sql: Sql, ctx: { empresaId: string; usuarioId?: string }, archivo: { nombre: string; bytes: Uint8Array } | null) {
  return enEmpresa(sql, ctx.empresaId, async (tx) => {
    await tx`SELECT 1 FROM empresas WHERE id = ${ctx.empresaId} FOR UPDATE`;
    const antes = await leerEmpresa(tx, ctx.empresaId);
    let logotipoId: string | null = null;
    if (archivo) {
      if (archivo.bytes.length > TAMANO_LOGO) throw new ErrorEmpresa("El logotipo no puede superar 1 MB");
      const b = archivo.bytes;
      const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
      const jpg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
      if (!png && !jpg) throw new ErrorEmpresa("El logotipo debe ser PNG o JPG");
      logotipoId = (await guardarArchivo(tx, ctx, archivo, { entidad: "empresa", entidadId: ctx.empresaId, tipo: "otro" })).id;
    }
    return guardarCambio(tx, ctx, antes, { ...antes, logotipoId });
  });
}

/** Contenido del logotipo, comprobando que sigue siendo de la empresa. */
export async function contenidoLogotipo(tx: Tx, documentoId: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const [d] = await tx<{ mime: string; contenido: Buffer }[]>`
    SELECT d.mime, c.contenido FROM documentos d JOIN documentos_contenido c ON c.documento_id = d.id WHERE d.id = ${documentoId}`;
  return d ? { bytes: new Uint8Array(d.contenido), mime: d.mime } : null;
}
