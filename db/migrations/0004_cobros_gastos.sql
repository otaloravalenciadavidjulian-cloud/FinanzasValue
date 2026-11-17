-- Value · migración 0004: cobros de facturas emitidas, facturas recibidas (gastos) y sus pagos.

-- Cobros: solo inserción. Un cobro registrado por error se corrige con un cobro de signo contrario.
ALTER TABLE cobros ADD COLUMN notas text;
ALTER TABLE cobros ADD COLUMN registrado_por uuid REFERENCES usuarios(id);
CREATE INDEX cobros_factura ON cobros (factura_id);
CREATE TRIGGER cobros_inalterables BEFORE UPDATE OR DELETE ON cobros FOR EACH ROW EXECUTE FUNCTION prohibir_cambios();
CREATE TRIGGER cobros_sin_truncate BEFORE TRUNCATE ON cobros FOR EACH STATEMENT EXECUTE FUNCTION prohibir_cambios();

-- Facturas recibidas y tickets ------------------------------------------------
CREATE TABLE gastos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  proveedor_id uuid REFERENCES terceros(id),
  -- Número de la factura del proveedor; vacío en tickets sin número.
  numero text,
  tipo_documento text NOT NULL DEFAULT 'factura' CHECK (tipo_documento IN ('factura','factura_simplificada','ticket','otro')),
  fecha_expedicion date NOT NULL,
  fecha_registro date NOT NULL DEFAULT current_date,
  categoria text NOT NULL,
  subcategoria text,
  proyecto_id uuid REFERENCES proyectos(id),
  descripcion text NOT NULL,
  base_cent bigint NOT NULL,
  cuota_iva_cent bigint NOT NULL,
  cuota_deducible_cent bigint NOT NULL,
  retencion_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (retencion_pct BETWEEN 0 AND 47),
  retencion_cent bigint NOT NULL DEFAULT 0,
  total_cent bigint NOT NULL,
  vencimiento date,
  metodo_pago text,
  -- Regla de documentación: sin documento adjunto, el gasto queda marcado como pendiente.
  pendiente_documentacion boolean NOT NULL DEFAULT true,
  notas text,
  creado_por uuid REFERENCES usuarios(id),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  -- Papelera: nunca se borra físicamente.
  borrado_en timestamptz,
  borrado_por uuid REFERENCES usuarios(id),
  motivo_borrado text,
  CHECK (total_cent = base_cent + cuota_iva_cent - retencion_cent),
  CHECK (abs(cuota_deducible_cent) <= abs(cuota_iva_cent)),
  CHECK ((borrado_en IS NULL) = (motivo_borrado IS NULL))
);
-- La misma factura de un proveedor no puede registrarse dos veces (salvo que la primera esté en la papelera).
CREATE UNIQUE INDEX gastos_sin_duplicados ON gastos (empresa_id, proveedor_id, upper(numero))
  WHERE borrado_en IS NULL AND numero IS NOT NULL AND proveedor_id IS NOT NULL;
CREATE INDEX gastos_empresa_fecha ON gastos (empresa_id, fecha_expedicion);
CREATE TRIGGER gastos_sin_borrado BEFORE DELETE ON gastos FOR EACH ROW EXECUTE FUNCTION prohibir_cambios();
CREATE TRIGGER gastos_sin_truncate BEFORE TRUNCATE ON gastos FOR EACH STATEMENT EXECUTE FUNCTION prohibir_cambios();

CREATE TABLE desglose_gasto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  gasto_id uuid NOT NULL REFERENCES gastos(id),
  tipo_iva numeric(5,2) NOT NULL,
  base_cent bigint NOT NULL,
  cuota_cent bigint NOT NULL,
  deducible_pct numeric(5,2) NOT NULL DEFAULT 100 CHECK (deducible_pct BETWEEN 0 AND 100),
  cuota_deducible_cent bigint NOT NULL
);
CREATE INDEX desglose_gasto_gasto ON desglose_gasto (gasto_id);
CREATE TRIGGER desglose_gasto_sin_truncate BEFORE TRUNCATE ON desglose_gasto FOR EACH STATEMENT EXECUTE FUNCTION prohibir_cambios();

-- Pagos a proveedores: solo inserción, como los cobros.
CREATE TABLE pagos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  gasto_id uuid NOT NULL REFERENCES gastos(id),
  fecha date NOT NULL,
  importe_cent bigint NOT NULL CHECK (importe_cent <> 0),
  metodo text NOT NULL,
  notas text,
  registrado_por uuid REFERENCES usuarios(id),
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pagos_gasto ON pagos (gasto_id);
CREATE TRIGGER pagos_inalterables BEFORE UPDATE OR DELETE ON pagos FOR EACH ROW EXECUTE FUNCTION prohibir_cambios();
CREATE TRIGGER pagos_sin_truncate BEFORE TRUNCATE ON pagos FOR EACH STATEMENT EXECUTE FUNCTION prohibir_cambios();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gastos','desglose_gasto','pagos']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY aislamiento_empresa ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;
