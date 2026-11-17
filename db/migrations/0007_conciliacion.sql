-- Value · migración 0007: conciliación de movimientos bancarios con cobros, pagos u otros conceptos.

CREATE TABLE conciliaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  movimiento_id uuid NOT NULL REFERENCES movimientos_bancarios(id),
  tipo text NOT NULL CHECK (tipo IN ('cobro','pago','otro')),
  cobro_id uuid REFERENCES cobros(id),
  pago_id uuid REFERENCES pagos(id),
  -- Para 'otro': comisiones, impuestos, nóminas, traspasos… (sin factura ni gasto asociado).
  categoria text,
  nota text,
  creado_por uuid REFERENCES usuarios(id),
  creado_en timestamptz NOT NULL DEFAULT now(),
  -- Una conciliación equivocada no se borra: se deshace con motivo.
  deshecha_en timestamptz,
  deshecha_por uuid REFERENCES usuarios(id),
  motivo_deshacer text,
  CHECK ((tipo = 'cobro') = (cobro_id IS NOT NULL)),
  CHECK ((tipo = 'pago') = (pago_id IS NOT NULL)),
  CHECK ((tipo = 'otro') = (categoria IS NOT NULL)),
  CHECK ((deshecha_en IS NULL) = (motivo_deshacer IS NULL))
);
CREATE UNIQUE INDEX conciliacion_movimiento ON conciliaciones (movimiento_id) WHERE deshecha_en IS NULL;
CREATE UNIQUE INDEX conciliacion_cobro ON conciliaciones (cobro_id) WHERE deshecha_en IS NULL AND cobro_id IS NOT NULL;
CREATE UNIQUE INDEX conciliacion_pago ON conciliaciones (pago_id) WHERE deshecha_en IS NULL AND pago_id IS NOT NULL;

CREATE OR REPLACE FUNCTION proteger_conciliacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las conciliaciones no se borran: se deshacen' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.deshecha_en IS NOT NULL
     OR (to_jsonb(NEW) - 'deshecha_en' - 'deshecha_por' - 'motivo_deshacer') IS DISTINCT FROM (to_jsonb(OLD) - 'deshecha_en' - 'deshecha_por' - 'motivo_deshacer') THEN
    RAISE EXCEPTION 'Una conciliación solo se puede deshacer una vez y no se modifica' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER conciliaciones_protegidas BEFORE UPDATE OR DELETE ON conciliaciones FOR EACH ROW EXECUTE FUNCTION proteger_conciliacion();
CREATE TRIGGER conciliaciones_sin_truncate BEFORE TRUNCATE ON conciliaciones FOR EACH STATEMENT EXECUTE FUNCTION prohibir_cambios();

ALTER TABLE conciliaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE conciliaciones FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON conciliaciones USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id());
