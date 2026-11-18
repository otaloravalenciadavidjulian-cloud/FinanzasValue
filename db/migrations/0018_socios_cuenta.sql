-- Value · migración 0018: las operaciones con socios entran en una cuenta bancaria.
-- Mientras el extracto del banco no la trae, la operación cuenta como apunte pendiente en el saldo de
-- esa cuenta. Al conciliarla con el movimiento del banco deja de contar aparte (ya lo cuenta el banco),
-- y si es anterior al saldo de partida de la cuenta ya está incluida en él: así nunca se cuenta dos veces.
ALTER TABLE operaciones_socios ADD COLUMN cuenta_id uuid REFERENCES cuentas_bancarias(id);

CREATE VIEW apuntes_pendientes WITH (security_invoker = true) AS
  SELECT o.id, o.empresa_id, o.cuenta_id, o.fecha,
         CASE WHEN o.tipo = 'devolucion' THEN -o.importe_cent ELSE o.importe_cent END AS importe_cent,
         o.tipo, o.socio_id
  FROM operaciones_socios o JOIN cuentas_bancarias c ON c.id = o.cuenta_id
  WHERE o.borrado_en IS NULL
    AND (c.fecha_saldo_inicial IS NULL OR o.fecha >= c.fecha_saldo_inicial)
    AND NOT EXISTS (SELECT 1 FROM conciliaciones k WHERE k.operacion_socio_id = o.id AND k.deshecha_en IS NULL);

-- Operaciones ya registradas: van a la primera cuenta de la empresa o, si no tiene ninguna, a una cuenta
-- principal creada con el IBAN que figura en los datos de la empresa. Se recorre empresa a empresa con su
-- contexto para respetar la seguridad por filas.
DO $$
DECLARE emp record; cuenta uuid;
BEGIN
  FOR emp IN SELECT id, iban, banco FROM empresas LOOP
    PERFORM set_config('app.empresa_id', emp.id::text, true);
    IF NOT EXISTS (SELECT 1 FROM operaciones_socios WHERE cuenta_id IS NULL) THEN CONTINUE; END IF;
    SELECT id INTO cuenta FROM cuentas_bancarias WHERE activa ORDER BY creado_en LIMIT 1;
    IF cuenta IS NULL AND emp.iban IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cuentas_bancarias) THEN
      INSERT INTO cuentas_bancarias (empresa_id, nombre, iban) VALUES (emp.id, coalesce(emp.banco || ' (principal)', 'Cuenta principal'), emp.iban)
        RETURNING id INTO cuenta;
    END IF;
    IF cuenta IS NOT NULL THEN UPDATE operaciones_socios SET cuenta_id = cuenta WHERE cuenta_id IS NULL; END IF;
  END LOOP;
  PERFORM set_config('app.empresa_id', '', true);
END $$;
