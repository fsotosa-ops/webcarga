-- Auto-link trips to transporter profiles via tractor plate match.
-- Creates a trip_fleet_links record and sets fleet_link_id on the trip.
-- Safe to re-run: skips trips already linked.
DO $$
DECLARE
  r RECORD;
  link_id UUID;
  found_tp_id UUID;
BEGIN
  FOR r IN
    SELECT t.id AS trip_id,
           t.fleet->>'tractor_plate' AS plate
    FROM app.trips t
    WHERE t.fleet_link_id IS NULL
      AND t.fleet->>'tractor_plate' IS NOT NULL
      AND t.fleet->>'tractor_plate' != ''
  LOOP
    -- Find a transporter_profile that has this plate in its vehicles JSONB
    SELECT tp.id INTO found_tp_id
    FROM app.transporter_profiles tp,
         LATERAL jsonb_array_elements(COALESCE(tp.vehicles, '[]'::jsonb)) v
    WHERE UPPER(TRIM(v.value->>'plate')) = UPPER(TRIM(r.plate))
    LIMIT 1;

    IF found_tp_id IS NOT NULL THEN
      INSERT INTO app.trip_fleet_links (trip_id, transporter_id, tractor_plate, link_source)
      VALUES (r.trip_id, found_tp_id, r.plate, 'auto')
      RETURNING id INTO link_id;

      UPDATE app.trips SET fleet_link_id = link_id WHERE id = r.trip_id;
    END IF;
  END LOOP;
END;
$$;
