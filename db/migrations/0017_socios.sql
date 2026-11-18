-- Value · migración 0017: socios y financiación de los socios.
-- Las aportaciones de capital (100), las aportaciones sin ampliar capital (118) y los préstamos de socios
-- (163 a largo plazo, 5133 a corto) son entradas de dinero, pero no ingresos: no van a facturación,
-- rentabilidad ni IVA. Las devoluciones de préstamo son salidas que reducen la deuda con el socio.

CREATE TABLE socios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  nombre text NOT NULL CHECK (length(trim(nombre)) > 0),
  nif text,
  participacion_pct numeric(5,2) CHECK (participacion_pct IS NULL OR (participacion_pct > 0 AND participacion_pct <= 100)),
  email text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  borrado_en timestamptz
);

CREATE TABLE operaciones_socios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  socio_id uuid NOT NULL REFERENCES socios(id),
  tipo text NOT NULL CHECK (tipo IN ('capital', 'aportacion', 'prestamo', 'devolucion')),
  fecha date NOT NULL,
  importe_cent bigint NOT NULL CHECK (importe_cent > 0),
  -- Préstamos: plazo (corto, hasta 12 meses; largo, más), vencimiento y tipo de interés pactado.
  plazo text CHECK (plazo IN ('corto', 'largo')),
  vencimiento date,
  interes_pct numeric(6,3) CHECK (interes_pct IS NULL OR interes_pct >= 0),
  -- Devoluciones: préstamo que se devuelve.
  prestamo_id uuid REFERENCES operaciones_socios(id),
  concepto text,
  creado_por uuid REFERENCES usuarios(id),
  creado_en timestamptz NOT NULL DEFAULT now(),
  borrado_en timestamptz,
  CHECK ((tipo = 'prestamo') = (plazo IS NOT NULL)),
  CHECK ((tipo = 'devolucion') = (prestamo_id IS NOT NULL)),
  CHECK (tipo = 'prestamo' OR (vencimiento IS NULL AND interes_pct IS NULL))
);
CREATE INDEX operaciones_socios_empresa ON operaciones_socios (empresa_id, fecha);

ALTER TABLE socios ENABLE ROW LEVEL SECURITY;
ALTER TABLE socios FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON socios USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id());
ALTER TABLE operaciones_socios ENABLE ROW LEVEL SECURITY;
ALTER TABLE operaciones_socios FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON operaciones_socios USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id());

-- Conciliación de un movimiento del banco con una operación de un socio.
ALTER TABLE conciliaciones ADD COLUMN operacion_socio_id uuid REFERENCES operaciones_socios(id);
ALTER TABLE conciliaciones DROP CONSTRAINT conciliaciones_tipo_check;
ALTER TABLE conciliaciones ADD CONSTRAINT conciliaciones_tipo_check CHECK (tipo IN ('cobro', 'pago', 'otro', 'socio'));
ALTER TABLE conciliaciones ADD CONSTRAINT conciliaciones_socio_check CHECK ((tipo = 'socio') = (operacion_socio_id IS NOT NULL));
CREATE UNIQUE INDEX conciliacion_socio ON conciliaciones (operacion_socio_id) WHERE deshecha_en IS NULL AND operacion_socio_id IS NOT NULL;
