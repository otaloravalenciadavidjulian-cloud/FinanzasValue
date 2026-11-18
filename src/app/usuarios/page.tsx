import { db } from "@/db/cliente";
import { requerirSesion, ROLES_ADMINISTRACION } from "@/lib/auth/sesion";
import { listarUsuarios, ROLES } from "@/lib/usuarios/gestion";
import { AccionesUsuario, NuevoUsuario } from "./formularios";

export const dynamic = "force-dynamic";

export default async function Usuarios() {
  const s = await requerirSesion(ROLES_ADMINISTRACION);
  const usuarios = await listarUsuarios(db(), s.empresaId);
  const nombreRol = (c: string) => ROLES.find((r) => r.codigo === c)?.nombre ?? c;
  const sinMfa = usuarios.filter((u) => u.activa && !u.mfa_activo).length;
  return (
    <>
      <h1>Usuarios</h1>
      <p className="muted">Quién puede entrar en esta empresa y con qué permisos. Los accesos no se borran: se desactivan y quedan en la auditoría.</p>
      {sinMfa > 0 && <div className="aviso panel">{sinMfa === 1 ? "Una persona no tiene" : `${sinMfa} personas no tienen`} activado el doble factor. Se activa desde Mi cuenta con una aplicación como Google Authenticator o Microsoft Authenticator.</div>}
      <NuevoUsuario roles={ROLES} />
      <div className="panel">
        <table>
          <thead><tr><th>Persona</th><th>Rol</th><th>Seguridad</th><th>Último acceso</th><th>Acciones</th></tr></thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id} style={{ opacity: u.activa ? 1 : 0.6 }}>
                <td><b>{u.nombre}</b><div className="muted" style={{ fontSize: 13 }}>{u.email}</div></td>
                <td>{u.activa ? nombreRol(u.rol) : <span className="muted">Sin acceso</span>}</td>
                <td style={{ fontSize: 13 }}>
                  {u.mfa_activo ? "✓ Doble factor" : <span className="muted">Sin doble factor</span>}
                  {u.debe_cambiar_contrasena && <div className="muted">Contraseña temporal</div>}
                </td>
                <td className="muted" style={{ fontSize: 13 }}>{u.ultimo_acceso ?? "Nunca"}</td>
                <td><AccionesUsuario id={u.id} rol={u.rol} activa={u.activa} mfa={u.mfa_activo} propio={u.id === s.usuarioId} roles={ROLES} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
