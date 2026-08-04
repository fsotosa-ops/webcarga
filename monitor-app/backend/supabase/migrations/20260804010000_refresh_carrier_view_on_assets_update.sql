-- Bug real encontrado en vivo (2026-08-04): las vistas materializadas
-- app.asset_compliance_status/app.carrier_asset_roster (H1.5,
-- 20260716214630) se refrescan por trigger en driver_assignments/
-- asset_assignments/carriers, pero NUNCA en public.assets directo. Mage
-- actualiza asset_type/fleet_service_type_id/webcarga_operation_type_id
-- con UPDATE directo sobre public.assets (load_assets_04.sql) — ese cambio
-- nunca disparaba el refresh, así que la ficha de empresa seguía mostrando
-- la etiqueta vieja hasta el próximo refresh manual o el próximo cambio de
-- asignación. Confirmado en vivo: el rename "Tractoreo"→"TRACTOCAMION" de
-- esta misma sesión no se reflejó en la UI hasta refrescar a mano.
CREATE TRIGGER trg_refresh_compliance_on_assets_update
AFTER UPDATE ON public.assets
FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_carrier_view();
