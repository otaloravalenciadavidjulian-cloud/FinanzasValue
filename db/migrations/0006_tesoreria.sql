-- Value · migración 0006: cuentas bancarias y movimientos importados de extractos (Norma 43).

CREATE TABLE cuentas_bancarias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  nombre text NOT NULL,
  iban text NOT NULL CHECK (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$'),
  -- Saldo de partida: el del primer extracto importado, o el que indique el usuario.
  saldo_inicial_cent bigint NOT NULL DEFAULT 0,
  fecha_saldo_inicial date,
  activa boolean NOT NULL DEFAULT true,
  creado_por uuid REFERENCES usuarios(id),
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cuentas_bancarias_iban ON cuentas_bancarias (empresa_id, iban);
CREATE TRIGGER cuentas_sin_borrado BEFORE DELETE ON cuentas_bancarias FOR EACH ROW EXECUTE FUNCTION prohibir_cambios();
CREATE TRIGGER cuentas_sin_truncate BEFORE TRUNCATE ON cuentas_bancarias FOR EACH STATEMENT EXECUTE FUNCTION prohibir_cambios();

-- Cada fichero importado. El mismo fichero no se importa dos veces en la misma cuenta.
CREATE TABLE importaciones_bancarias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  cuenta_id uuid NOT NULL REFERENCES cuentas_bancarias(id),
  nombre_archivo text NOT NULL,
  sha256 char(64) NOT NULL,
  formato text NOT NULL CHECK (formato IN ('n43')),
  fecha_desde date NOT NULL,
  fecha_hasta date NOT NULL,
  saldo_inicial_cent bigint NOT NULL,
  saldo_final_cent bigint NOT NULL,
  movimientos_nuevos int NOT NULL,
  movimientos_repetidos int NOT NULL,
  creado_por uuid REFERENCES usuarios(id),
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX importaciones_sin_repetir ON importaciones_bancarias (cuenta_id, sha256);
CREATE TRIGGER importaciones_inalterables BEFORE UPDATE OR DELETE ON importaciones_bancarias FOR EACH ROW EXECUTE FUNCTION prohibir_cambios();
CREATE TRIGGER importaciones_sin_truncate BEFORE TRUNCATE ON importaciones_bancarias FOR EACH STATEMENT EXECUTE FUNCTION prohibir_cambios();

-- Movimientos tal como los da el banco: no se modifican ni se borran.
CREATE TABLE movimientos_bancarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  cuenta_id uuid NOT NULL REFERENCES cuentas_bancarias(id),
  importacion_id uuid NOT NULL REFERENCES importaciones_bancarias(id),
  fecha_operacion date NOT NULL,
  fecha_valor date NOT NULL,
  -- Positivo: abono (entrada). Negativo: cargo (salida).
  importe_cent bigint NOT NULL CHECK (importe_cent <> 0),
  concepto_comun char(2) NOT NULL,
  concepto_propio text,
  documento text,
  referencia1 text,
  referencia2 text,
  descripcion text NOT NULL,
  -- Identifica el movimiento para no duplicarlo si llega en dos extractos que se solapan.
  huella char(64) NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX movimientos_sin_duplicar ON movimientos_bancarios (cuenta_id, huella);
CREATE INDEX movimientos_cuenta_fecha ON movimientos_bancarios (cuenta_id, fecha_operacion);
CREATE TRIGGER movimientos_inalterables BEFORE UPDATE OR DELETE ON movimientos_bancarios FOR EACH ROW EXECUTE FUNCTION prohibir_cambios();
CREATE TRIGGER movimientos_sin_truncate BEFORE TRUNCATE ON movimientos_bancarios FOR EACH STATEMENT EXECUTE FUNCTION prohibir_cambios();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cuentas_bancarias','importaciones_bancarias','movimientos_bancarios']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY aislamiento_empresa ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;
