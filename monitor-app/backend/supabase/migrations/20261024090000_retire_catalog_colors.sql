-- Configuración, Parte 1 (contraer): el color de un estado o un vocabulario sale de
-- su significado (frontend lib/states.ts, boardColumnStyle); nadie elige un color
-- por fila. Desde la expansión (20261024080000 + API sin colores) nadie lee ni
-- escribe estas columnas: tests/test_config_sin_colores.py falla si alguien vuelve.
--
-- Antes de borrar, cada color queda en public.audit_log (field 'retired_colors',
-- source 'migration'). Los estados del tablero tienen id de texto y audit_log.entity_id
-- es uuid: se usa md5('trip_status:' || id)::uuid y el id real va en old_value.
--
-- Las dos vistas materializadas que guardaban el color del subtipo se recrean sin él
-- (definición vigente leída en la real el 2026-10-16 con pg_get_viewdef; sin permisos
-- extra ni dependientes; las refresca app.refresh_carrier_view por nombre).
-- Mage no lee estos colores ni estas vistas (código fuente del proyecto, 2026-10-16).
-- Re-ejecutable.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'app' AND table_name = 'trip_statuses' AND column_name = 'bg_color') THEN
        INSERT INTO public.audit_log (actor, entity_type, entity_id, action, field, old_value, new_value, source)
        SELECT NULL, 'TRIP_STATUS', md5('trip_status:' || s.id)::uuid, 'delete', 'retired_colors',
               jsonb_build_object('id', s.id, 'bg_color', s.bg_color, 'text_color', s.text_color), NULL, 'migration'
          FROM app.trip_statuses s;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'app' AND table_name = 'status_taxonomies' AND column_name = 'bg_color') THEN
        INSERT INTO public.audit_log (actor, entity_type, entity_id, action, field, old_value, new_value, source)
        SELECT NULL, 'TAXONOMY', t.id, 'delete', 'retired_colors',
               jsonb_build_object('domain', t.domain, 'bg_color', t.bg_color, 'text_color', t.text_color), NULL, 'migration'
          FROM app.status_taxonomies t;
    END IF;
END $$;

-- El roster depende de asset_compliance_status: se borra primero y se crea después.
DROP MATERIALIZED VIEW IF EXISTS app.carrier_asset_roster;
DROP MATERIALIZED VIEW IF EXISTS app.asset_compliance_status;

CREATE MATERIALIZED VIEW app.asset_compliance_status AS
SELECT a.id AS asset_id,
       a.license_plate,
       a.asset_type,
       a.operational_status,
       a.fleet_service_type_id,
       st.label AS fleet_service_type_label,
       count(cr.id) AS total_requirements,
       max(cr.updated_at) AS last_document_update
  FROM public.assets a
  LEFT JOIN app.status_taxonomies st ON st.id = a.fleet_service_type_id
  LEFT JOIN public.compliance_records cr
         ON a.id = cr.entity_id AND cr.entity_type::text = 'ASSET'::text AND cr.is_current = true
 GROUP BY a.id, a.license_plate, a.asset_type, a.operational_status, a.fleet_service_type_id, st.label;

CREATE UNIQUE INDEX idx_asset_compliance_view_id ON app.asset_compliance_status USING btree (asset_id);

CREATE MATERIALIZED VIEW app.carrier_asset_roster AS
SELECT aa.carrier_id,
       a.id AS asset_id,
       a.license_plate,
       a.asset_type,
       a.operational_status,
       a.fleet_service_type_id,
       st.label AS fleet_service_type_label,
       aa.status AS assignment_status,
       acs.total_requirements,
       acs.last_document_update
  FROM public.asset_assignments aa
  JOIN public.assets a ON a.id = aa.asset_id
  LEFT JOIN app.status_taxonomies st ON st.id = a.fleet_service_type_id
  LEFT JOIN app.asset_compliance_status acs ON acs.asset_id = a.id
 WHERE aa.status::text = 'ACTIVE'::text;

CREATE UNIQUE INDEX idx_carrier_asset_roster ON app.carrier_asset_roster USING btree (carrier_id, asset_id);

-- Como las dejó 20260818200000_seguridad_matviews_y_funciones: sin acceso desde la API pública.
REVOKE ALL ON app.asset_compliance_status, app.carrier_asset_roster FROM anon, authenticated;

ALTER TABLE app.trip_statuses
    DROP COLUMN IF EXISTS bg_color,
    DROP COLUMN IF EXISTS text_color;
ALTER TABLE app.status_taxonomies
    DROP COLUMN IF EXISTS bg_color,
    DROP COLUMN IF EXISTS text_color;
