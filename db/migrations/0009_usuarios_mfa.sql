-- Value · migración 0009: gestión de usuarios y doble factor (TOTP, RFC 6238).

-- Las membresías no se borran: se desactivan, para conservar quién tuvo acceso.
ALTER TABLE membresias ADD COLUMN activa boolean NOT NULL DEFAULT true;
ALTER TABLE membresias ADD COLUMN creado_en timestamptz NOT NULL DEFAULT now();
CREATE TRIGGER membresias_sin_borrado BEFORE DELETE ON membresias FOR EACH ROW EXECUTE FUNCTION prohibir_cambios();

-- Secreto TOTP en base32. mfa_ultimo_paso evita reutilizar un código ya aceptado.
ALTER TABLE usuarios ADD COLUMN mfa_secreto text;
ALTER TABLE usuarios ADD COLUMN mfa_ultimo_paso bigint;
-- Códigos de recuperación de un solo uso, guardados como SHA-256.
ALTER TABLE usuarios ADD COLUMN mfa_recuperacion text[] NOT NULL DEFAULT '{}';
-- La contraseña que pone un administrador es temporal: hay que cambiarla al entrar.
ALTER TABLE usuarios ADD COLUMN debe_cambiar_contrasena boolean NOT NULL DEFAULT false;
ALTER TABLE usuarios ADD CONSTRAINT mfa_coherente CHECK (NOT mfa_activo OR mfa_secreto IS NOT NULL);

-- Tras la contraseña, una sesión con doble factor queda pendiente unos minutos hasta que se da el código.
ALTER TABLE sesiones ADD COLUMN mfa_pendiente boolean NOT NULL DEFAULT false;
