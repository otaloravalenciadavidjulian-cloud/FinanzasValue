import QRCode from "qrcode";
import { db } from "@/db/cliente";
import { requerirSesion } from "@/lib/auth/sesion";
import { uriOtpauth } from "@/lib/auth/totp";
import { empezarDobleFactor } from "./acciones";
import { CambioContrasena, ConfirmarDobleFactor, DesactivarDobleFactor } from "./formularios";

export const dynamic = "force-dynamic";

export default async function Cuenta({ searchParams }: { searchParams: Promise<{ activar?: string }> }) {
  const q = await searchParams;
  const s = await requerirSesion(undefined, { permitirCambioPendiente: true });
  const [u] = await db()<{ mfa_secreto: string | null; restantes: number }[]>`
    SELECT mfa_secreto, cardinality(mfa_recuperacion) AS restantes FROM usuarios WHERE id = ${s.usuarioId}`;
  const activando = !s.mfaActivo && q.activar && u.mfa_secreto;
  const qr = activando ? await QRCode.toDataURL(uriOtpauth(u.mfa_secreto!, s.email), { margin: 1, width: 200 }) : null;
  return (
    <>
      <h1>Mi cuenta</h1>
      <p className="muted">{s.nombre} · {s.email}</p>
      {s.debeCambiarContrasena && <div className="aviso panel">Estás usando una contraseña temporal. Cámbiala para seguir.</div>}
      <div className="panel">
        <b>Contraseña</b>
        <CambioContrasena />
      </div>
      {!s.debeCambiarContrasena && (
        <div className="panel" style={{ display: "grid", gap: 10 }}>
          <b>Verificación en dos pasos</b>
          {s.mfaActivo ? (
            <>
              <p style={{ margin: 0 }}>✓ Activada. Al entrar se pide un código de tu aplicación de autenticación. Te quedan {u.restantes} códigos de recuperación.</p>
              <DesactivarDobleFactor />
            </>
          ) : activando ? (
            <ConfirmarDobleFactor qr={qr!} secreto={u.mfa_secreto!} />
          ) : (
            <>
              <p style={{ margin: 0 }}>Protege tu cuenta aunque alguien conozca tu contraseña: al entrar se pedirá también un código del móvil. Es gratis y funciona con cualquier aplicación de autenticación.</p>
              <form action={empezarDobleFactor}><button className="btn">Activar doble factor</button></form>
            </>
          )}
        </div>
      )}
    </>
  );
}
