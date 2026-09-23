-- Auditoría inmutable: se bloquea UPDATE, DELETE y TRUNCATE
CREATE OR REPLACE FUNCTION auditoria_inmutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La tabla auditoria es inmutable: % no permitido', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auditoria_inmutable
  BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION auditoria_inmutable();

CREATE TRIGGER trg_auditoria_no_truncate
  BEFORE TRUNCATE ON auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria_inmutable();

-- Escala 1 a 5
ALTER TABLE usuario   ADD CONSTRAINT chk_usuario_nivel   CHECK (nivel_seguridad BETWEEN 1 AND 5);
ALTER TABLE documento ADD CONSTRAINT chk_documento_nivel CHECK (nivel_confidencialidad BETWEEN 1 AND 5);
