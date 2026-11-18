-- Value · migración 0015: borrar las facturas de prueba antes de empezar a facturar de verdad.
-- Solo se permite mientras el sistema está en el entorno de pruebas de VERI*FACTU (nada se ha remitido a la AEAT)
-- y solo dentro de la transacción que activa expresamente el borrado. En producción las facturas siguen siendo
-- inalterables como siempre, y el paso de producción a pruebas está prohibido.

CREATE TABLE entorno_sistema (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  entorno text NOT NULL CHECK (entorno IN ('pruebas', 'produccion')),
  cambiado_en timestamptz NOT NULL DEFAULT now()
);
INSERT INTO entorno_sistema (entorno) VALUES ('pruebas');

CREATE FUNCTION entorno_sin_retorno() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (OLD.entorno = 'produccion' AND NEW.entorno <> 'produccion') THEN
    RAISE EXCEPTION 'Un sistema en producción no vuelve al entorno de pruebas' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entorno_sistema_sin_retorno BEFORE UPDATE OR DELETE ON entorno_sistema FOR EACH ROW EXECUTE FUNCTION entorno_sin_retorno();

CREATE FUNCTION borrado_pruebas_permitido() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.borrado_pruebas', true), '') = 'on'
     AND (SELECT entorno FROM entorno_sistema) = 'pruebas'
$$;

CREATE OR REPLACE FUNCTION prohibir_cambios() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME IN ('cobros', 'desglose_iva', 'lineas_factura', 'registros_facturacion', 'envios_aeat')
     AND borrado_pruebas_permitido() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'La tabla % es inalterable: no se permite %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE OR REPLACE FUNCTION proteger_factura() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF borrado_pruebas_permitido() THEN RETURN OLD; END IF;
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

CREATE OR REPLACE FUNCTION proteger_conciliacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF borrado_pruebas_permitido() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Las conciliaciones no se borran: se deshacen' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.deshecha_en IS NOT NULL
     OR (to_jsonb(NEW) - 'deshecha_en' - 'deshecha_por' - 'motivo_deshacer') IS DISTINCT FROM (to_jsonb(OLD) - 'deshecha_en' - 'deshecha_por' - 'motivo_deshacer') THEN
    RAISE EXCEPTION 'Una conciliación solo se puede deshacer una vez y no se modifica' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
