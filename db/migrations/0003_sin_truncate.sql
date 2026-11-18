-- Value · migración 0003: TRUNCATE no dispara los triggers por fila, así que se bloquea aparte.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['facturas','lineas_factura','desglose_iva','registros_facturacion','envios_aeat','eventos_auditoria','accesos']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION prohibir_cambios()', t || '_sin_truncate', t);
  END LOOP;
END $$;
