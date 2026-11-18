-- Value · migración 0014: datos opcionales para el diseño de la factura.
-- Empresa: web, BIC, titular de la cuenta de cobro y mensaje de agradecimiento.
ALTER TABLE empresas
  ADD COLUMN web text CHECK (web IS NULL OR length(web) <= 200),
  ADD COLUMN bic text CHECK (bic IS NULL OR bic ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
  ADD COLUMN titular_cuenta text CHECK (titular_cuenta IS NULL OR length(titular_cuenta) <= 200),
  ADD COLUMN agradecimiento text CHECK (agradecimiento IS NULL OR length(agradecimiento) <= 300);
-- Factura: referencia o número de pedido del cliente.
ALTER TABLE facturas ADD COLUMN referencia text CHECK (referencia IS NULL OR length(referencia) <= 100);
