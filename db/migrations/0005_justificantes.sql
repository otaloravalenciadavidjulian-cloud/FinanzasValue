-- Value · migración 0005: justificantes adjuntos (contenido en la propia base) y lectura automática.

-- Un justificante subido para leerlo antes de crear el gasto aún no tiene entidad: se asigna al guardar.
ALTER TABLE documentos ALTER COLUMN entidad_id DROP NOT NULL;
ALTER TABLE documentos ADD COLUMN extraccion jsonb;
ALTER TABLE documentos ADD COLUMN motivo_borrado text;
CREATE INDEX documentos_entidad ON documentos (empresa_id, entidad, entidad_id);
-- Búsqueda de archivos repetidos. La regla (un archivo no justifica dos gastos activos) se comprueba
-- en la aplicación con un bloqueo por huella, porque depende de si el gasto está en la papelera.
CREATE INDEX documentos_huella ON documentos (empresa_id, sha256) WHERE borrado_en IS NULL;

-- Solo se permite asignar un borrador a su gasto, mandarlo a la papelera o guardar su lectura.
CREATE OR REPLACE FUNCTION proteger_documento() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los documentos no se pueden borrar' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.entidad_id IS NOT NULL AND NEW.entidad_id IS DISTINCT FROM OLD.entidad_id THEN
    RAISE EXCEPTION 'Un documento asignado no puede cambiar de dueño' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (to_jsonb(NEW) - 'entidad_id' - 'borrado_en' - 'motivo_borrado' - 'extraccion')
     IS DISTINCT FROM (to_jsonb(OLD) - 'entidad_id' - 'borrado_en' - 'motivo_borrado' - 'extraccion') THEN
    RAISE EXCEPTION 'El archivo y su huella no se pueden modificar' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER documentos_protegidos BEFORE UPDATE OR DELETE ON documentos FOR EACH ROW EXECUTE FUNCTION proteger_documento();
CREATE TRIGGER documentos_sin_truncate BEFORE TRUNCATE ON documentos FOR EACH STATEMENT EXECUTE FUNCTION prohibir_cambios();

-- Contenido del archivo. Separado para que los listados no lo lean.
CREATE TABLE documentos_contenido (
  documento_id uuid PRIMARY KEY REFERENCES documentos(id),
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  contenido bytea NOT NULL
);
CREATE TRIGGER contenido_inalterable BEFORE UPDATE OR DELETE ON documentos_contenido FOR EACH ROW EXECUTE FUNCTION prohibir_cambios();
CREATE TRIGGER contenido_sin_truncate BEFORE TRUNCATE ON documentos_contenido FOR EACH STATEMENT EXECUTE FUNCTION prohibir_cambios();
ALTER TABLE documentos_contenido ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos_contenido FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON documentos_contenido USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id());
