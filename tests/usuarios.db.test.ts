import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { execSync } from "node:child_process";
import { enEmpresa } from "@/db/cliente";
import { verificarContrasena } from "@/lib/auth/contrasena";
import { codigo, pasoActual } from "@/lib/auth/totp";
import { altaEmpresa } from "@/lib/empresas/alta";
import {
  activarDobleFactor, altaUsuario, cambiarAcceso, cambiarContrasena, desactivarDobleFactor, ErrorUsuario,
  listarUsuarios, prepararDobleFactor, quitarDobleFactor, restablecerContrasena,
} from "@/lib/usuarios/gestion";

const URL_TEST = process.env.DATABASE_URL_TEST;
const d = URL_TEST ? describe : describe.skip;

d("usuarios y doble factor en PostgreSQL", () => {
  const sql = postgres(URL_TEST ?? "", { max: 8, onnotice: () => {} });
  let ctx = { empresaId: "", usuarioId: "" };
  const n = () => Math.floor(Math.random() * 1e8);
  const cif = () => {
    const d = String(Math.floor(Math.random() * 1e7)).padStart(7, "0").split("").map(Number);
    const suma = d.reduce((s, x, i) => s + (i % 2 === 0 ? Math.floor((x * 2) / 10) + ((x * 2) % 10) : x), 0);
    return `B${d.join("")}${(10 - (suma % 10)) % 10}`;
  };

  beforeAll(async () => {
    await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    execSync("npx tsx scripts/migrate.ts", { env: { ...process.env, DATABASE_URL: URL_TEST }, stdio: "pipe" });
  });
  afterAll(async () => { await sql.end(); });
  beforeEach(async () => {
    const r = await altaEmpresa(sql, { razonSocial: "Empresa", nif: cif(), domicilio: "C/ Mayor 1", codigoPostal: "28013", municipio: "Madrid", provincia: "Madrid",
      adminNombre: "Admin", adminEmail: `admin${n()}@x.es`, adminContrasena: "contraseña-larga-1" }, 2026);
    ctx = { empresaId: r.empresaId, usuarioId: r.usuarioId };
  });

  it("alta con contraseña temporal, cambio de rol y nunca sin administrador", async () => {
    const email = `ana${n()}@x.es`;
    const a = await altaUsuario(sql, ctx, { nombre: "Ana", email: email.toUpperCase(), rol: "contable" });
    expect(a.temporal).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    const [u] = await sql`SELECT hash_contrasena, debe_cambiar_contrasena FROM usuarios WHERE id = ${a.id}`;
    expect(u.debe_cambiar_contrasena).toBe(true);
    expect(await verificarContrasena(a.temporal!, u.hash_contrasena)).toBe(true);
    await expect(altaUsuario(sql, ctx, { nombre: "Ana", email, rol: "contable" })).rejects.toThrow(/ya tiene acceso/);
    await expect(altaUsuario(sql, ctx, { nombre: "X", email: "no-es-email", rol: "contable" })).rejects.toBeInstanceOf(ErrorUsuario);

    await expect(cambiarAcceso(sql, ctx, ctx.usuarioId, { activa: false })).rejects.toThrow(/propio/);
    await cambiarAcceso(sql, ctx, a.id, { rol: "administrador" });
    // Ana (admin) quita el rol al primero; luego no puede quitárselo a sí misma ni dejar la empresa sin admin.
    const ctxAna = { empresaId: ctx.empresaId, usuarioId: a.id };
    await cambiarAcceso(sql, ctxAna, ctx.usuarioId, { rol: "direccion" });
    await expect(cambiarAcceso(sql, ctx, a.id, { activa: false })).rejects.toThrow(/al menos un administrador/);
    const lista = await listarUsuarios(sql, ctx.empresaId);
    expect(lista.map((x) => [x.nombre, x.rol, x.activa])).toEqual([["Admin", "direccion", true], ["Ana", "administrador", true]]);
    await expect(sql`DELETE FROM membresias WHERE usuario_id = ${a.id}`).rejects.toThrow();
  });

  it("una persona de otra empresa solo recibe acceso, y no se le puede restablecer", async () => {
    const email = `luis${n()}@x.es`;
    const otra = await altaEmpresa(sql, { razonSocial: "Otra", nif: cif(), domicilio: "C/ Sol 1", codigoPostal: "28013", municipio: "Madrid", provincia: "Madrid",
      adminNombre: "Luis", adminEmail: email, adminContrasena: "contraseña-larga-2" }, 2026);
    expect(otra.empresaId).toBeTruthy();
    const r = await altaUsuario(sql, ctx, { nombre: "Luis", email, rol: "gestoria" });
    expect(r.temporal).toBeNull();
    await expect(restablecerContrasena(sql, ctx, r.id)).rejects.toThrow(/otra empresa/);
  });

  it("activa, usa y desactiva el doble factor", async () => {
    const secreto = await prepararDobleFactor(sql, ctx);
    expect(await prepararDobleFactor(sql, ctx)).toBe(secreto);
    await expect(activarDobleFactor(sql, ctx, "000000")).rejects.toBeInstanceOf(ErrorUsuario);
    const codigos = await activarDobleFactor(sql, ctx, codigo(secreto, pasoActual()));
    expect(codigos).toHaveLength(10);
    const [u] = await sql`SELECT mfa_activo, cardinality(mfa_recuperacion) AS n FROM usuarios WHERE id = ${ctx.usuarioId}`;
    expect(u).toMatchObject({ mfa_activo: true, n: 10 });
    await expect(desactivarDobleFactor(sql, ctx, "mala")).rejects.toThrow(/contraseña/);
    await desactivarDobleFactor(sql, ctx, "contraseña-larga-1");
    const [v] = await sql`SELECT mfa_activo, mfa_secreto FROM usuarios WHERE id = ${ctx.usuarioId}`;
    expect(v).toEqual({ mfa_activo: false, mfa_secreto: null });
  });

  it("restablece contraseña y doble factor de otro y cambia la propia", async () => {
    const a = await altaUsuario(sql, ctx, { nombre: "Eva", email: `eva${n()}@x.es`, rol: "empleado" });
    await sql`UPDATE usuarios SET mfa_secreto = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', mfa_activo = true WHERE id = ${a.id}`;
    await quitarDobleFactor(sql, ctx, a.id);
    const t = await restablecerContrasena(sql, ctx, a.id);
    const [u] = await sql`SELECT mfa_activo, hash_contrasena FROM usuarios WHERE id = ${a.id}`;
    expect(u.mfa_activo).toBe(false);
    expect(await verificarContrasena(t, u.hash_contrasena)).toBe(true);

    const ctxEva = { empresaId: ctx.empresaId, usuarioId: a.id };
    await expect(cambiarContrasena(sql, ctxEva, t, "corta", null)).rejects.toThrow(/12 caracteres/);
    await cambiarContrasena(sql, ctxEva, t, "una-nueva-contraseña", null);
    const [v] = await sql`SELECT debe_cambiar_contrasena FROM usuarios WHERE id = ${a.id}`;
    expect(v.debe_cambiar_contrasena).toBe(false);
    const aud = await enEmpresa(sql, ctx.empresaId, (tx) => tx`SELECT accion FROM eventos_auditoria WHERE entidad = 'usuario' ORDER BY id`);
    expect(aud.map((x) => x.accion)).toEqual(["alta_usuario", "quitar_doble_factor", "restablecer_contrasena", "cambiar_contrasena"]);
  });
});
