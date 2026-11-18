import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { execSync } from "node:child_process";
import { enEmpresa } from "@/db/cliente";
import { adjuntarAGasto, asignarBorrador, documentoAPapelera, guardarLectura, leerDocumento, subirBorrador } from "@/lib/documentos/almacen";
import { moverGastoAPapelera, registrarGasto, restaurarGasto, type BorradorGasto } from "@/lib/gastos/registrar";
import { altaTercero } from "@/lib/terceros/alta";

const URL_TEST = process.env.DATABASE_URL_TEST;
const d = URL_TEST ? describe : describe.skip;

const pdf = (texto: string) => ({ nombre: "factura.pdf", bytes: new TextEncoder().encode(`%PDF-1.7\n${texto}`) });

d("justificantes en PostgreSQL", () => {
  const sql = postgres(URL_TEST ?? "", { max: 8, onnotice: () => {} });
  let empA = "", empB = "", provA = "", usu1 = "", usu2 = "";
  const ctx = (usuarioId = usu1) => ({ empresaId: empA, usuarioId, hoy: "2026-11-17" });
  let n = 0;
  const gasto = (extra: Partial<BorradorGasto> = {}): BorradorGasto => ({
    proveedorId: provA, numero: `F-${++n}`, fechaExpedicion: "2026-11-10", categoria: "suministros", descripcion: "Luz",
    desglose: [{ baseCent: 10000, tipoIva: 21 }], confirmarPosibleDuplicado: true, ...extra,
  });
  const nuevoGasto = async (extra: Partial<BorradorGasto> = {}) => {
    const r = await registrarGasto(sql, ctx(), gasto(extra));
    if (!r.guardado) throw new Error("no guardado");
    return r.id;
  };
  const pendiente = async (id: string) =>
    (await enEmpresa(sql, empA, (tx) => tx`SELECT pendiente_documentacion FROM gastos WHERE id = ${id}`))[0].pendiente_documentacion;

  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    execSync("npx tsx scripts/migrate.ts", { env: { ...process.env, DATABASE_URL: URL_TEST }, stdio: "pipe" });
    const u = async (e: string) => (await sql`INSERT INTO usuarios (email, nombre, hash_contrasena) VALUES (${e}, ${e}, 'x') RETURNING id`)[0].id as string;
    usu1 = await u("uno@value.test");
    usu2 = await u("dos@value.test");
  });
  afterAll(async () => { await sql.end(); });

  beforeEach(async () => {
    const nueva = async (nombre: string) => {
      const [{ id }] = await sql`INSERT INTO empresas (razon_social, nif, domicilio, codigo_postal, municipio, provincia)
        VALUES (${nombre}, ${"B" + Math.floor(Math.random() * 1e8)}, 'C/ Mayor 1', '28013', 'Madrid', 'Madrid') RETURNING id`;
      return id as string;
    };
    empA = await nueva("Empresa A");
    empB = await nueva("Empresa B");
    provA = (await altaTercero(sql, { empresaId: empA }, "proveedor", { razonSocial: "Eléctrica S.A.", nif: "A58818501" })).id;
  });

  it("adjunta un justificante, quita la marca de pendiente y comprueba la huella al leerlo", async () => {
    const g = await nuevoGasto();
    expect(await pendiente(g)).toBe(true);
    const doc = await adjuntarAGasto(sql, ctx(), g, pdf("uno"));
    expect(await pendiente(g)).toBe(false);
    const leido = await enEmpresa(sql, empA, (tx) => leerDocumento(tx, doc.id));
    expect(leido).toMatchObject({ mime: "application/pdf", integro: true, entidad_id: g });
    const [ev] = await enEmpresa(sql, empA, (tx) => tx`SELECT accion FROM eventos_auditoria WHERE entidad_id = ${g} AND accion = 'adjuntar_justificante'`);
    expect(ev).toBeTruthy();
  });

  it("rechaza archivos que no son justificantes", async () => {
    const g = await nuevoGasto();
    await expect(adjuntarAGasto(sql, ctx(), g, { nombre: "x.html", bytes: new TextEncoder().encode("<html>") })).rejects.toThrow(/Solo se admiten/);
    await expect(adjuntarAGasto(sql, ctx(), g, { nombre: "x.pdf", bytes: new Uint8Array(4 * 1024 * 1024 + 1).fill(0x25) })).rejects.toThrow(/4 MB/);
  });

  it("el mismo archivo no justifica dos gastos activos, salvo que el primero esté en la papelera", async () => {
    const g1 = await nuevoGasto();
    const g2 = await nuevoGasto();
    await adjuntarAGasto(sql, ctx(), g1, pdf("mismo"));
    await expect(adjuntarAGasto(sql, ctx(), g2, pdf("mismo"))).rejects.toThrow(/ya justifica un gasto activo/);
    await moverGastoAPapelera(sql, ctx(), g1, "Registrado por error");
    await adjuntarAGasto(sql, ctx(), g2, pdf("mismo"));
    await expect(restaurarGasto(sql, ctx(), g1)).rejects.toThrow(/No se puede restaurar/);
  });

  it("dos subidas simultáneas del mismo archivo a gastos distintos: solo una entra", async () => {
    const ids = await Promise.all([nuevoGasto(), nuevoGasto(), nuevoGasto()]);
    const res = await Promise.allSettled(ids.map((id) => adjuntarAGasto(sql, ctx(), id, pdf("carrera"))));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("un borrador leído se asigna al gasto al guardarlo", async () => {
    const b = await subirBorrador(sql, ctx(), pdf("borrador"));
    await guardarLectura(sql, ctx(), b.id, { numero: "F-9" });
    const g = await nuevoGasto({ documentoId: b.id });
    expect(await pendiente(g)).toBe(false);
    const [doc] = await enEmpresa(sql, empA, (tx) => tx`SELECT entidad_id, extraccion FROM documentos WHERE id = ${b.id}`);
    expect(doc).toMatchObject({ entidad_id: g, extraccion: { numero: "F-9" } });
    // Ya asignado: no se puede usar para otro gasto ni cambiar de dueño.
    await expect(nuevoGasto({ documentoId: b.id })).rejects.toThrow(/ya no está disponible/);
    await expect(enEmpresa(sql, empA, (tx) => tx`UPDATE documentos SET entidad_id = gen_random_uuid() WHERE id = ${b.id}`)).rejects.toThrow(/cambiar de dueño/);
  });

  it("si falla el gasto, el borrador sigue libre; y no vale el borrador de otra persona", async () => {
    const b = await subirBorrador(sql, ctx(), pdf("ajeno"));
    await expect(registrarGasto(sql, ctx(usu2), gasto({ documentoId: b.id }))).rejects.toThrow(/otra persona/);
    const [doc] = await enEmpresa(sql, empA, (tx) => tx`SELECT entidad_id FROM documentos WHERE id = ${b.id}`);
    expect(doc.entidad_id).toBeNull();
    expect(await enEmpresa(sql, empA, (tx) => tx`SELECT count(*)::int AS n FROM gastos WHERE creado_por = ${usu2}`)).toEqual([{ n: 0 }]);
  });

  it("al mandar el único justificante a la papelera, el gasto vuelve a quedar pendiente", async () => {
    const g = await nuevoGasto();
    const a = await adjuntarAGasto(sql, ctx(), g, pdf("a"));
    const b = await adjuntarAGasto(sql, ctx(), g, pdf("b"));
    await expect(documentoAPapelera(sql, ctx(), a.id, " ")).rejects.toThrow(/motivo/);
    await documentoAPapelera(sql, ctx(), a.id, "Duplicado");
    expect(await pendiente(g)).toBe(false);
    await documentoAPapelera(sql, ctx(), b.id, "Ilegible");
    expect(await pendiente(g)).toBe(true);
  });

  it("el archivo y su huella no se pueden modificar ni borrar", async () => {
    const g = await nuevoGasto();
    const doc = await adjuntarAGasto(sql, ctx(), g, pdf("intocable"));
    const intento = (q: string) => enEmpresa(sql, empA, (tx) => tx.unsafe(q, [doc.id]));
    await expect(intento("UPDATE documentos SET sha256 = repeat('0', 64) WHERE id = $1")).rejects.toThrow(/no se pueden modificar/);
    await expect(intento("UPDATE documentos SET nombre = 'otro' WHERE id = $1")).rejects.toThrow(/no se pueden modificar/);
    await expect(intento("DELETE FROM documentos WHERE id = $1")).rejects.toThrow(/no se pueden borrar/);
    await expect(intento("UPDATE documentos_contenido SET contenido = '\\x00' WHERE documento_id = $1")).rejects.toThrow();
    await expect(intento("DELETE FROM documentos_contenido WHERE documento_id = $1")).rejects.toThrow();
  });

  it("otra empresa no ve los justificantes ni su contenido", async () => {
    const g = await nuevoGasto();
    const doc = await adjuntarAGasto(sql, ctx(), g, pdf("privado"));
    expect(await enEmpresa(sql, empB, (tx) => leerDocumento(tx, doc.id))).toBeNull();
    expect(await enEmpresa(sql, empB, (tx) => tx`SELECT * FROM documentos_contenido`)).toHaveLength(0);
    await expect(enEmpresa(sql, empB, (tx) => asignarBorrador(tx, { empresaId: empB }, doc.id, g))).rejects.toThrow(/ya no está disponible/);
  });
});
