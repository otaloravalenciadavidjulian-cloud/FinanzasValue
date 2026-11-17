-- Value · migración 0010: causa de las operaciones al 0 % (exención o no sujeción), que exigen el
-- art. 6.1.j del RD 1619/2012 en la factura y la Orden HAC/1177/2024 en el registro VERI*FACTU.
--   E1–E6: exentas (arts. 20, 21, 22, 23 y 24, 25 de la Ley del IVA y otros)
--   N1: no sujeta (arts. 7, 14 y otros) · N2: no sujeta por reglas de localización
--   S2: sujeta con inversión del sujeto pasivo (la cuota la declara el destinatario)

ALTER TABLE lineas_factura ADD COLUMN causa_iva text CHECK (causa_iva IN ('E1','E2','E3','E4','E5','E6','N1','N2','S2'));
ALTER TABLE desglose_iva ADD COLUMN causa_iva text CHECK (causa_iva IN ('E1','E2','E3','E4','E5','E6','N1','N2','S2'));
-- Solo para facturas nuevas: las anteriores al 0 % no la tenían.
ALTER TABLE lineas_factura ADD CONSTRAINT causa_si_cero CHECK ((tipo_iva = 0) = (causa_iva IS NOT NULL)) NOT VALID;
ALTER TABLE desglose_iva ADD CONSTRAINT causa_si_cero CHECK ((tipo_iva = 0) = (causa_iva IS NOT NULL)) NOT VALID;

-- Una factura puede tener varias líneas al 0 % con causas distintas.
ALTER TABLE desglose_iva DROP CONSTRAINT desglose_iva_pkey;
CREATE UNIQUE INDEX desglose_iva_unico ON desglose_iva (factura_id, tipo_iva, coalesce(causa_iva, ''));
