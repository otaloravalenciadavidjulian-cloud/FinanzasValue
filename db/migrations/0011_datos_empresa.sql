-- Value · migración 0011: historial de los datos de la empresa.
-- Una factura emitida no cambia: si la empresa cambia de domicilio o de logotipo, las facturas
-- anteriores se siguen mostrando con los datos que tenía al emitirlas.

CREATE TABLE empresas_historial (
  id bigserial PRIMARY KEY,
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  -- Datos tal como estaban hasta este momento.
  datos jsonb NOT NULL,
  vigente_hasta timestamptz NOT NULL DEFAULT now(),
  cambiado_por uuid REFERENCES usuarios(id)
);
CREATE INDEX empresas_historial_empresa ON empresas_historial (empresa_id, vigente_hasta);
CREATE TRIGGER empresas_historial_inalterable BEFORE UPDATE OR DELETE ON empresas_historial FOR EACH ROW EXECUTE FUNCTION prohibir_cambios();
CREATE TRIGGER empresas_historial_sin_truncate BEFORE TRUNCATE ON empresas_historial FOR EACH STATEMENT EXECUTE FUNCTION prohibir_cambios();
ALTER TABLE empresas_historial ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresas_historial FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON empresas_historial USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id());

-- La razón social y el NIF identifican al obligado en VERI*FACTU: no se cambian desde la aplicación.
CREATE OR REPLACE FUNCTION proteger_empresa() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.nif IS DISTINCT FROM OLD.nif OR NEW.razon_social IS DISTINCT FROM OLD.razon_social THEN
    RAISE EXCEPTION 'La razón social y el NIF no se pueden cambiar' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER empresas_identidad BEFORE UPDATE ON empresas FOR EACH ROW EXECUTE FUNCTION proteger_empresa();
CREATE TRIGGER empresas_sin_borrado BEFORE DELETE ON empresas FOR EACH ROW EXECUTE FUNCTION prohibir_cambios();
