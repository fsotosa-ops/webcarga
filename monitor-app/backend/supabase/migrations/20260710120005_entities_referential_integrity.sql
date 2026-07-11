-- ==============================================================================
-- AUDITORÍA 2026-07-10 — FASE 5: integridad referencial de la asociación
-- polimórfica (transporter/driver/vehicle).
--
-- Antes: compliance_documents.entity_id / notifications.entity_id eran uuid
-- sueltos con solo un CHECK sobre el string discriminador (entity_type), sin
-- FK a la fila real. Un bug de pipeline o una migración mal escrita podía
-- dejar documentos huérfanos apuntando a una entidad inexistente/borrada.
--
-- app.entities: supertype liviano (id, entity_type) poblado por trigger
-- AFTER INSERT en transporters/drivers/vehicles. compliance_documents y
-- notifications ganan FK compuesta (entity_type, entity_id) contra
-- app.entities(entity_type, id) — valida existencia Y que el tipo coincida.
--
-- Fuera de alcance deliberado:
-- - audit_log: vocabulario de entity_type heterogéneo (incluye
--   'insurance_installment', que no es una entidad de este supertype) — un
--   log append-only con tipos mixtos necesita su propio diseño, no se fuerza
--   acá.
-- - stored_files.owner_id: discriminador distinto (compliance_document /
--   insurance_policy, no transporter/driver/vehicle) — no aplica a
--   app.entities.
-- ==============================================================================

CREATE TABLE app.entities (
  id          uuid not null,
  entity_type text not null CHECK (entity_type IN ('transporter', 'driver', 'vehicle')),
  PRIMARY KEY (id),
  UNIQUE (entity_type, id)
);

COMMENT ON TABLE app.entities IS
  'Supertype liviano de la asociación polimórfica transporter/driver/vehicle. Permite FK compuesta (entity_type, entity_id) desde compliance_documents/notifications en vez de un uuid suelto sin integridad referencial.';

INSERT INTO app.entities (id, entity_type) SELECT id, 'transporter' FROM app.transporters;
INSERT INTO app.entities (id, entity_type) SELECT id, 'driver' FROM app.drivers;
INSERT INTO app.entities (id, entity_type) SELECT id, 'vehicle' FROM app.vehicles;

CREATE OR REPLACE FUNCTION app.register_entity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO app.entities (id, entity_type) VALUES (NEW.id, TG_ARGV[0])
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transporters_register_entity
  AFTER INSERT ON app.transporters
  FOR EACH ROW EXECUTE FUNCTION app.register_entity('transporter');

CREATE TRIGGER drivers_register_entity
  AFTER INSERT ON app.drivers
  FOR EACH ROW EXECUTE FUNCTION app.register_entity('driver');

CREATE TRIGGER vehicles_register_entity
  AFTER INSERT ON app.vehicles
  FOR EACH ROW EXECUTE FUNCTION app.register_entity('vehicle');

ALTER TABLE app.compliance_documents
  ADD CONSTRAINT compliance_documents_entity_fkey
  FOREIGN KEY (entity_type, entity_id) REFERENCES app.entities (entity_type, id);

ALTER TABLE app.notifications
  ADD CONSTRAINT notifications_entity_fkey
  FOREIGN KEY (entity_type, entity_id) REFERENCES app.entities (entity_type, id);

ALTER TABLE app.entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "entities_read" ON app.entities FOR SELECT TO authenticated USING (true);
