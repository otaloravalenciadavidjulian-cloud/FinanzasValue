-- Value · migración 0001: empresas, terceros, facturación emitida y registros VERI*FACTU.
-- Principios:
--   1. Todo dato de negocio lleva empresa_id y está protegido por Row Level Security.
--   2. Las facturas emitidas, sus líneas y los registros de facturación no se modifican ni se borran.
--   3. Los importes se guardan en céntimos (bigint).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION app_empresa_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.empresa_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION prohibir_cambios() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es inalterable: no se permite %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

-- Empresas y usuarios -------------------------------------------------------
CREATE TABLE empresas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  razon_social text NOT NULL,
  nombre_comercial text,
  nif text NOT NULL UNIQUE,
  domicilio text NOT NULL,
  codigo_postal text NOT NULL,
  municipio text NOT NULL,
  provincia text NOT NULL,
  pais char(2) NOT NULL DEFAULT 'ES',
  datos_registrales text,
  iban text,
  email text,
  telefono text,
  logotipo_documento_id uuid,
  actividad text,
  regimen_fiscal text NOT NULL DEFAULT 'general',
  sujeto_impuesto_sociedades boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  nombre text NOT NULL,
  hash_contrasena text NOT NULL,
  mfa_activo boolean NOT NULL DEFAULT false,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE membresias (
  usuario_id uuid NOT NULL REFERENCES usuarios(id),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  rol text NOT NULL CHECK (rol IN ('administrador','direccion','contable','gestoria','empleado')),
  PRIMARY KEY (usuario_id, empresa_id)
);

-- Clientes y proveedores ----------------------------------------------------
CREATE TABLE terceros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  es_cliente boolean NOT NULL DEFAULT false,
  es_proveedor boolean NOT NULL DEFAULT false,
  razon_social text NOT NULL,
  nif text NOT NULL,
  direccion text,
  codigo_postal text,
  municipio text,
  provincia text,
  pais char(2) NOT NULL DEFAULT 'ES',
  contacto text,
  email text,
  telefono text,
  dias_pago integer NOT NULL DEFAULT 30 CHECK (dias_pago >= 0),
  categoria text,
  borrado_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CHECK (es_cliente OR es_proveedor),
  UNIQUE (empresa_id, nif)
);

CREATE TABLE proyectos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  nombre text NOT NULL,
  cliente_id uuid REFERENCES terceros(id),
  activo boolean NOT NULL DEFAULT true,
  UNIQUE (empresa_id, nombre)
);

-- Series y facturas emitidas ------------------------------------------------
CREATE TABLE series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  codigo text NOT NULL CHECK (codigo ~ '^[A-Z0-9]{1,10}$'),
  descripcion text NOT NULL,
  tipo_factura text NOT NULL CHECK (tipo_factura IN ('F1','F2','F3','R1','R2','R3','R4','R5')),
  ejercicio integer NOT NULL,
  ultimo_numero integer NOT NULL DEFAULT 0 CHECK (ultimo_numero >= 0),
  UNIQUE (empresa_id, codigo, ejercicio)
);

CREATE TABLE facturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  serie_id uuid NOT NULL REFERENCES series(id),
  numero integer NOT NULL,
  num_serie text NOT NULL,
  tipo_factura text NOT NULL,
  fecha_expedicion date NOT NULL,
  fecha_operacion date,
  cliente_id uuid REFERENCES terceros(id),
  -- Copia de los datos del destinatario en el momento de emitir: si luego cambia la ficha, la factura no cambia.
  destinatario jsonb,
  proyecto_id uuid REFERENCES proyectos(id),
  base_cent bigint NOT NULL,
  cuota_iva_cent bigint NOT NULL,
  retencion_pct numeric(5,2) NOT NULL DEFAULT 0,
  retencion_cent bigint NOT NULL DEFAULT 0,
  total_cent bigint NOT NULL,
  vencimiento date,
  metodo_cobro text,
  cuenta_destino text,
  condiciones_pago text,
  observaciones text,
  rectifica_id uuid REFERENCES facturas(id),
  tipo_rectificacion char(1) CHECK (tipo_rectificacion IN ('S','I')),
  motivo_rectificacion text,
  documento text NOT NULL DEFAULT 'generado' CHECK (documento IN ('generado','adjunto','pendiente')),
  anulada boolean NOT NULL DEFAULT false,
  emitida_en timestamptz NOT NULL DEFAULT now(),
  emitida_por uuid REFERENCES usuarios(id),
  UNIQUE (empresa_id, num_serie),
  UNIQUE (serie_id, numero),
  CHECK (total_cent = base_cent + cuota_iva_cent - retencion_cent),
  CHECK ((tipo_factura LIKE 'R%') = (rectifica_id IS NOT NULL))
);
CREATE INDEX facturas_empresa_fecha ON facturas (empresa_id, fecha_expedicion);

CREATE TABLE lineas_factura (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  factura_id uuid NOT NULL REFERENCES facturas(id),
  orden integer NOT NULL,
  concepto text NOT NULL,
  categoria text,
  cantidad numeric(14,4) NOT NULL,
  precio_unitario_cent bigint NOT NULL,
  descuento_pct numeric(5,2) NOT NULL DEFAULT 0,
  tipo_iva numeric(5,2) NOT NULL,
  base_cent bigint NOT NULL,
  UNIQUE (factura_id, orden)
);

CREATE TABLE desglose_iva (
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  factura_id uuid NOT NULL REFERENCES facturas(id),
  tipo_iva numeric(5,2) NOT NULL,
  base_cent bigint NOT NULL,
  cuota_cent bigint NOT NULL,
  PRIMARY KEY (factura_id, tipo_iva)
);

-- Una factura emitida solo admite marcarse como anulada (nunca al revés) o cambiar el estado de su documento.
CREATE OR REPLACE FUNCTION proteger_factura() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Una factura emitida no se puede borrar; usa una rectificativa o una anulación'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.anulada AND NOT NEW.anulada THEN
    RAISE EXCEPTION 'Una factura anulada no puede volver a estar vigente' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (to_jsonb(NEW) - 'anulada' - 'documento') IS DISTINCT FROM (to_jsonb(OLD) - 'anulada' - 'documento') THEN
    RAISE EXCEPTION 'Una factura emitida no se puede modificar; usa una factura rectificativa'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER facturas_inalterables BEFORE UPDATE OR DELETE ON facturas FOR EACH ROW EXECUTE FUNCTION proteger_factura();
CREATE TRIGGER lineas_inalterables BEFORE UPDATE OR DELETE ON lineas_factura FOR EACH ROW EXECUTE FUNCTION prohibir_cambios();
CREATE TRIGGER desglose_inalterable BEFORE UPDATE OR DELETE ON desglose_iva FOR EACH ROW EXECUTE FUNCTION prohibir_cambios();

CREATE TABLE cobros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  factura_id uuid NOT NULL REFERENCES facturas(id),
  fecha date NOT NULL,
  importe_cent bigint NOT NULL CHECK (importe_cent <> 0),
  metodo text NOT NULL,
  cuenta text,
  creado_en timestamptz NOT NULL DEFAULT now()
);

-- Registros de facturación VERI*FACTU (RD 1007/2023) -----------------------
-- Cabeza de la cadena por empresa: se bloquea con FOR UPDATE para encadenar sin carreras.
CREATE TABLE cadena_registros (
  empresa_id uuid PRIMARY KEY REFERENCES empresas(id),
  ultima_secuencia bigint NOT NULL DEFAULT 0,
  ultima_huella char(64)
);

CREATE TABLE registros_facturacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  secuencia bigint NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('alta','anulacion')),
  factura_id uuid NOT NULL REFERENCES facturas(id),
  num_serie text NOT NULL,
  fecha_expedicion date NOT NULL,
  fecha_hora_huso text NOT NULL,
  cadena text NOT NULL,
  huella char(64) NOT NULL,
  huella_anterior char(64),
  xml text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, secuencia),
  UNIQUE (empresa_id, huella)
);
CREATE TRIGGER registros_inalterables BEFORE UPDATE OR DELETE ON registros_facturacion FOR EACH ROW EXECUTE FUNCTION prohibir_cambios();

-- Cada intento de envío a la AEAT y su respuesta se guardan aparte, también solo inserción.
CREATE TABLE envios_aeat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  registro_id uuid NOT NULL REFERENCES registros_facturacion(id),
  intento integer NOT NULL,
  estado text NOT NULL CHECK (estado IN ('pendiente','enviado','correcto','aceptado_con_errores','incorrecto','error_conexion')),
  csv text,
  respuesta jsonb,
  creado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registro_id, intento)
);
CREATE TRIGGER envios_inalterables BEFORE UPDATE OR DELETE ON envios_aeat FOR EACH ROW EXECUTE FUNCTION prohibir_cambios();

-- Documentos y auditoría ----------------------------------------------------
CREATE TABLE documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  entidad text NOT NULL,
  entidad_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('factura','ticket','justificante_pago','contrato','presupuesto','otro')),
  nombre text NOT NULL,
  mime text NOT NULL,
  tamano_bytes bigint NOT NULL,
  sha256 char(64) NOT NULL,
  ruta_almacen text NOT NULL,
  subido_por uuid REFERENCES usuarios(id),
  borrado_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE eventos_auditoria (
  id bigserial PRIMARY KEY,
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  usuario_id uuid REFERENCES usuarios(id),
  accion text NOT NULL,
  entidad text NOT NULL,
  entidad_id uuid,
  antes jsonb,
  despues jsonb,
  ip inet,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER auditoria_inalterable BEFORE UPDATE OR DELETE ON eventos_auditoria FOR EACH ROW EXECUTE FUNCTION prohibir_cambios();

-- Aislamiento por empresa ---------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['terceros','proyectos','series','facturas','lineas_factura','desglose_iva','cobros',
                           'cadena_registros','registros_facturacion','envios_aeat','documentos','eventos_auditoria']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY aislamiento_empresa ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;
