-- Expone fleet_service_type_id (Ronda 79 corregida) en las vistas materializadas
-- que ya alimentan la ficha de empresa (VehicleRosterCard/VehicleDetailPanel).
DROP MATERIALIZED VIEW app.carrier_asset_roster;
DROP MATERIALIZED VIEW app.asset_compliance_status;

CREATE MATERIALIZED VIEW app.asset_compliance_status AS
SELECT
    a.id AS asset_id,
    a.license_plate,
    a.asset_type,
    a.operational_status,
    a.fleet_service_type_id,
    st.label      AS fleet_service_type_label,
    st.bg_color   AS fleet_service_type_bg_color,
    st.text_color AS fleet_service_type_text_color,
    count(cr.id) AS total_requirements,
    max(cr.updated_at) AS last_document_update
FROM public.assets a
LEFT JOIN app.status_taxonomies st ON st.id = a.fleet_service_type_id
LEFT JOIN public.compliance_records cr ON a.id = cr.entity_id AND cr.entity_type = 'ASSET' AND cr.is_current = true
GROUP BY a.id, a.license_plate, a.asset_type, a.operational_status, a.fleet_service_type_id,
         st.label, st.bg_color, st.text_color;

CREATE UNIQUE INDEX idx_asset_compliance_view_id ON app.asset_compliance_status(asset_id);

CREATE MATERIALIZED VIEW app.carrier_asset_roster AS
SELECT
    aa.carrier_id,
    a.id AS asset_id,
    a.license_plate,
    a.asset_type,
    a.operational_status,
    a.fleet_service_type_id,
    st.label      AS fleet_service_type_label,
    st.bg_color   AS fleet_service_type_bg_color,
    st.text_color AS fleet_service_type_text_color,
    aa.status AS assignment_status,
    acs.total_requirements,
    acs.last_document_update
FROM public.asset_assignments aa
JOIN public.assets a ON a.id = aa.asset_id
LEFT JOIN app.status_taxonomies st ON st.id = a.fleet_service_type_id
LEFT JOIN app.asset_compliance_status acs ON acs.asset_id = a.id
WHERE aa.status = 'ACTIVE';

CREATE UNIQUE INDEX idx_carrier_asset_roster ON app.carrier_asset_roster(carrier_id, asset_id);

GRANT SELECT ON app.asset_compliance_status TO authenticated;
GRANT SELECT ON app.carrier_asset_roster TO authenticated;
