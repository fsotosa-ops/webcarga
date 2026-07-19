-- Ciclo de vida real para notas tipo 'incidente' — nulo = abierto, con
-- timestamp = resuelto. Solo tiene sentido para note_type='incidente', pero
-- no se restringe con un CHECK (otros tipos de nota simplemente no lo usan
-- nunca, igual que pinned ya convive con todos los tipos sin problema).
ALTER TABLE app.trip_notes ADD COLUMN resolved_at timestamptz NULL;
