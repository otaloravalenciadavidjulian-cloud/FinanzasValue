-- Value · migración 0002: sesiones y registro de accesos.
-- Estas tablas no son de una empresa concreta, así que no llevan Row Level Security.

CREATE TABLE sesiones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_sha256 char(64) NOT NULL UNIQUE,
  usuario_id uuid NOT NULL REFERENCES usuarios(id),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  expira_en timestamptz NOT NULL,
  ip inet,
  agente text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  cerrada_en timestamptz
);
CREATE INDEX sesiones_usuario ON sesiones (usuario_id);

CREATE TABLE accesos (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  usuario_id uuid REFERENCES usuarios(id),
  correcto boolean NOT NULL,
  ip inet,
  agente text,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX accesos_email_fecha ON accesos (email, creado_en);
CREATE TRIGGER accesos_inalterables BEFORE UPDATE OR DELETE ON accesos FOR EACH ROW EXECUTE FUNCTION prohibir_cambios();
