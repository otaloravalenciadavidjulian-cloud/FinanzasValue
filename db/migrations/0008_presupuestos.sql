-- Value · migración 0008: presupuesto anual por partida y mes.
-- Un presupuesto es un plan, no un registro fiscal: se puede corregir, pero no borrar, y cada cambio
-- queda en la auditoría.

CREATE TABLE presupuestos (
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  ejercicio smallint NOT NULL CHECK (ejercicio BETWEEN 2000 AND 2100),
  -- 'ingresos' o el código de una categoría de gasto.
  partida text NOT NULL CHECK (partida ~ '^[a-z_]{1,40}$'),
  mes smallint NOT NULL CHECK (mes BETWEEN 1 AND 12),
  importe_cent bigint NOT NULL CHECK (importe_cent >= 0),
  actualizado_por uuid REFERENCES usuarios(id),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, ejercicio, partida, mes)
);
CREATE TRIGGER presupuestos_sin_borrado BEFORE DELETE ON presupuestos FOR EACH ROW EXECUTE FUNCTION prohibir_cambios();
CREATE TRIGGER presupuestos_sin_truncate BEFORE TRUNCATE ON presupuestos FOR EACH STATEMENT EXECUTE FUNCTION prohibir_cambios();
ALTER TABLE presupuestos ENABLE ROW LEVEL SECURITY;
ALTER TABLE presupuestos FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON presupuestos USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id());
