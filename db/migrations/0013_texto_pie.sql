-- Value · migración 0013: texto libre al pie de las facturas (marcas, webs, avisos de la empresa).
ALTER TABLE empresas ADD COLUMN texto_pie text CHECK (texto_pie IS NULL OR length(texto_pie) <= 600);
