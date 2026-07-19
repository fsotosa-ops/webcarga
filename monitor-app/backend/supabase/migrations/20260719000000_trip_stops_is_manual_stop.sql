-- Marca las filas de app.trip_stops insertadas directo por el backend
-- (_insert_trip_stops, viajes manuales) vs. las que genera el pipeline dbt.
-- Necesaria para el post_hook de reconciliación de app/trip_stops.sql — sin
-- esto no hay forma de distinguir "esta fila hay que limpiarla cuando el
-- viaje deja de ser manual" de "esta fila la generó la TMS, no tocar".
ALTER TABLE app.trip_stops ADD COLUMN is_manual_stop boolean NOT NULL DEFAULT false;
