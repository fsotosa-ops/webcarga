-- raw_admin_customers / raw_admin_companies: datos de autenticación (contraseñas
-- encriptadas, tokens de reset) de una plataforma legacy sin ningún uso en esta
-- app (confirmado: 0 referencias en el código). RLS habilitado sin ninguna
-- política -> bloqueado por completo, ni siquiera para authenticated.
ALTER TABLE bronze.raw_admin_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bronze.raw_admin_companies ENABLE ROW LEVEL SECURITY;

-- Resto de tablas bronze sin RLS: datos de negocio (conductores/vehiculos/OTs/
-- transportistas/seguros) legibles por cualquier usuario autenticado, mismo
-- patron ya usado en bronze.tms_trips (policy tms_trips_read). Bloquea el
-- acceso anonimo, que era el hallazgo critico real.
ALTER TABLE bronze.raw_info_contacto ENABLE ROW LEVEL SECURITY;
CREATE POLICY raw_info_contacto_read ON bronze.raw_info_contacto FOR SELECT TO authenticated USING (true);

ALTER TABLE bronze.raw_info_conductores ENABLE ROW LEVEL SECURITY;
CREATE POLICY raw_info_conductores_read ON bronze.raw_info_conductores FOR SELECT TO authenticated USING (true);

ALTER TABLE bronze.raw_info_equipos ENABLE ROW LEVEL SECURITY;
CREATE POLICY raw_info_equipos_read ON bronze.raw_info_equipos FOR SELECT TO authenticated USING (true);

ALTER TABLE bronze.raw_bd_ot ENABLE ROW LEVEL SECURITY;
CREATE POLICY raw_bd_ot_read ON bronze.raw_bd_ot FOR SELECT TO authenticated USING (true);

ALTER TABLE bronze.raw_bd_ot_tmp ENABLE ROW LEVEL SECURITY;
CREATE POLICY raw_bd_ot_tmp_read ON bronze.raw_bd_ot_tmp FOR SELECT TO authenticated USING (true);

ALTER TABLE bronze.raw_tms_sap_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY raw_tms_sap_snapshot_read ON bronze.raw_tms_sap_snapshot FOR SELECT TO authenticated USING (true);

ALTER TABLE bronze.tms_trips_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY tms_trips_snapshot_read ON bronze.tms_trips_snapshot FOR SELECT TO authenticated USING (true);

ALTER TABLE bronze.tms_sap_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY tms_sap_snapshot_read ON bronze.tms_sap_snapshot FOR SELECT TO authenticated USING (true);

ALTER TABLE bronze.raw_centralizer_drivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY raw_centralizer_drivers_read ON bronze.raw_centralizer_drivers FOR SELECT TO authenticated USING (true);

ALTER TABLE bronze.raw_centralizer_vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY raw_centralizer_vehicles_read ON bronze.raw_centralizer_vehicles FOR SELECT TO authenticated USING (true);

ALTER TABLE bronze.raw_centralizer_transporter ENABLE ROW LEVEL SECURITY;
CREATE POLICY raw_centralizer_transporter_read ON bronze.raw_centralizer_transporter FOR SELECT TO authenticated USING (true);

ALTER TABLE bronze.raw_insurance_vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY raw_insurance_vehicles_read ON bronze.raw_insurance_vehicles FOR SELECT TO authenticated USING (true);
