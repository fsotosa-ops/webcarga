-- H1.1: vistas de compliance para DRIVER/ASSET (mismo patrón que carrier_compliance_status vigente)
CREATE MATERIALIZED VIEW app.driver_compliance_status AS
SELECT
    d.id AS driver_id,
    d.tax_id,
    d.country_code,
    d.full_name,
    d.operational_status,
    count(cr.id) AS total_requirements,
    max(cr.updated_at) AS last_document_update
FROM public.drivers d
LEFT JOIN public.compliance_records cr ON d.id = cr.entity_id AND cr.entity_type = 'DRIVER' AND cr.is_current = true
GROUP BY d.id, d.tax_id, d.country_code, d.full_name, d.operational_status;

CREATE UNIQUE INDEX idx_driver_compliance_view_id ON app.driver_compliance_status(driver_id);

CREATE MATERIALIZED VIEW app.asset_compliance_status AS
SELECT
    a.id AS asset_id,
    a.license_plate,
    a.asset_type,
    a.operational_status,
    count(cr.id) AS total_requirements,
    max(cr.updated_at) AS last_document_update
FROM public.assets a
LEFT JOIN public.compliance_records cr ON a.id = cr.entity_id AND cr.entity_type = 'ASSET' AND cr.is_current = true
GROUP BY a.id, a.license_plate, a.asset_type, a.operational_status;

CREATE UNIQUE INDEX idx_asset_compliance_view_id ON app.asset_compliance_status(asset_id);

GRANT SELECT ON app.driver_compliance_status TO authenticated;
GRANT SELECT ON app.asset_compliance_status TO authenticated;

-- H1.2: roster de conductores/vehículos ACTIVE por carrier con su compliance individual
CREATE MATERIALIZED VIEW app.carrier_driver_roster AS
SELECT
    da.carrier_id,
    d.id AS driver_id,
    d.tax_id,
    d.full_name,
    d.operational_status,
    da.status AS assignment_status,
    dcs.total_requirements,
    dcs.last_document_update
FROM public.driver_assignments da
JOIN public.drivers d ON d.id = da.driver_id
LEFT JOIN app.driver_compliance_status dcs ON dcs.driver_id = d.id
WHERE da.status = 'ACTIVE';

CREATE UNIQUE INDEX idx_carrier_driver_roster ON app.carrier_driver_roster(carrier_id, driver_id);

CREATE MATERIALIZED VIEW app.carrier_asset_roster AS
SELECT
    aa.carrier_id,
    a.id AS asset_id,
    a.license_plate,
    a.asset_type,
    a.operational_status,
    aa.status AS assignment_status,
    acs.total_requirements,
    acs.last_document_update
FROM public.asset_assignments aa
JOIN public.assets a ON a.id = aa.asset_id
LEFT JOIN app.asset_compliance_status acs ON acs.asset_id = a.id
WHERE aa.status = 'ACTIVE';

CREATE UNIQUE INDEX idx_carrier_asset_roster ON app.carrier_asset_roster(carrier_id, asset_id);

GRANT SELECT ON app.carrier_driver_roster TO authenticated;
GRANT SELECT ON app.carrier_asset_roster TO authenticated;

-- H1.5: extender el refresh reactivo para cubrir las 5 vistas (antes solo carrier_compliance_status)
-- y dispararlo también sobre driver_assignments/asset_assignments y UPDATE de carriers (antes
-- solo compliance_records/insurance_* disparaban refresh).
CREATE OR REPLACE FUNCTION public.refresh_carrier_view()
RETURNS TRIGGER AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY app.carrier_compliance_status;
    REFRESH MATERIALIZED VIEW CONCURRENTLY app.driver_compliance_status;
    REFRESH MATERIALIZED VIEW CONCURRENTLY app.asset_compliance_status;
    REFRESH MATERIALIZED VIEW CONCURRENTLY app.carrier_driver_roster;
    REFRESH MATERIALIZED VIEW CONCURRENTLY app.carrier_asset_roster;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

CREATE TRIGGER trg_refresh_compliance_on_driver_assignments
AFTER INSERT OR UPDATE OR DELETE ON public.driver_assignments
FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_carrier_view();

CREATE TRIGGER trg_refresh_compliance_on_asset_assignments
AFTER INSERT OR UPDATE OR DELETE ON public.asset_assignments
FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_carrier_view();

CREATE TRIGGER trg_refresh_compliance_on_carriers_update
AFTER UPDATE ON public.carriers
FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_carrier_view();
