-- Value · migración 0012: nombre del banco de la cuenta de cobro, que se muestra en las facturas.
ALTER TABLE empresas ADD COLUMN banco text CHECK (banco IS NULL OR length(banco) <= 100);
