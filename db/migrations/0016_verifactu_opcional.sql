-- Value · migración 0016: VERI*FACTU se activa por empresa.
-- Mientras no es obligatorio, la empresa puede emitir facturas sin el QR tributario ni la leyenda VERI*FACTU.
-- Los registros de facturación con huella encadenada se siguen generando siempre, para que activarlo después
-- no cambie nada por debajo. Cada factura guarda si se emitió con VERI*FACTU, para que su PDF no cambie nunca.
ALTER TABLE empresas ADD COLUMN verifactu_activo boolean NOT NULL DEFAULT false;
ALTER TABLE facturas ADD COLUMN verifactu boolean NOT NULL DEFAULT true;
ALTER TABLE facturas ALTER COLUMN verifactu SET DEFAULT false;
