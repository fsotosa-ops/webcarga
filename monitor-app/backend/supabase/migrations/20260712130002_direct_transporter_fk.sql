ALTER TABLE app.drivers ADD COLUMN transporter_id uuid REFERENCES app.transporters(id);
ALTER TABLE app.vehicles ADD COLUMN transporter_id uuid REFERENCES app.transporters(id);

UPDATE app.drivers d
SET transporter_id = da.transporter_id
FROM app.driver_assignments da
WHERE da.driver_id = d.id AND da.valid_to IS NULL;

UPDATE app.vehicles v
SET transporter_id = va.transporter_id
FROM app.vehicle_assignments va
WHERE va.vehicle_id = v.id AND va.valid_to IS NULL;

CREATE INDEX idx_drivers_transporter_id ON app.drivers(transporter_id);
CREATE INDEX idx_vehicles_transporter_id ON app.vehicles(transporter_id);
