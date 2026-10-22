-- Vistas guardadas de Analítica (HU monitor-app/docs/user-stories/20261022/01-hu-analitica.md, criterios 9 a 11).
--
-- Una vista guarda el conjunto de datos, los filtros, la búsqueda, el orden, el período RELATIVO ("últimos 30
-- días", no fechas fijas), la fecha que manda el período, el modo (tabla o tabla dinámica) y las columnas visibles
-- en orden. Personal: la ve y la edita su dueño. Compartida: la ve todo el que tiene analytics.read y la edita su
-- dueño o quien tiene analytics.manage_views. Las sembradas (owner_id NULL) son del sistema: solo manage_views.
--
-- `columns`: las visibles, en orden ([{"id": ..., "hidden": false}], el formato de app.table_preferences).
-- Vacío con view.all_columns = true significa "todas las del catálogo", para no repetir aquí la lista de columnas
-- de services/analytics_columns.py.

BEGIN;

CREATE TABLE IF NOT EXISTS app.saved_views (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    dataset    text NOT NULL CHECK (dataset IN ('trips', 'fleet')),
    name       text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
    scope      text NOT NULL CHECK (scope IN ('personal', 'shared')),
    view       jsonb NOT NULL CHECK (jsonb_typeof(view) = 'object'),
    columns    jsonb NOT NULL CHECK (jsonb_typeof(columns) = 'array'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (scope = 'shared' OR owner_id IS NOT NULL),
    UNIQUE NULLS NOT DISTINCT (owner_id, scope, name)
);

COMMENT ON TABLE app.saved_views IS
  'Vistas guardadas de Analítica: personales o compartidas. La escribe solo la API (routers/analytics_views.py).';

REVOKE ALL ON app.saved_views FROM anon, authenticated;

INSERT INTO app.saved_views (owner_id, dataset, name, scope, view, columns) VALUES
    (NULL, 'trips', 'BDOT completo', 'shared',
     '{"filters": {}, "q": "", "sort": null, "period": {"preset": "last_30d"}, "date_field": "planning", "all_columns": true}',
     '[]'),
    (NULL, 'trips', 'Operación por cliente', 'shared',
     '{"filters": {}, "q": "", "sort": {"column": "client_name", "dir": "asc"}, "period": {"preset": "last_30d"}, "date_field": "planning"}',
     '[{"id": "client_name", "hidden": false}, {"id": "planning_date", "hidden": false},
       {"id": "trip_code", "hidden": false}, {"id": "operation_type", "hidden": false},
       {"id": "operation_type_source", "hidden": false}, {"id": "destination_zone", "hidden": false},
       {"id": "carrier_name", "hidden": false}, {"id": "trip_status", "hidden": false}]'),
    (NULL, 'fleet', 'F30-1', 'shared',
     '{"filters": {"subject_type": ["DRIVER"]}, "q": "", "sort": {"column": "carrier_name", "dir": "asc"}, "period": {"preset": "last_month"}, "date_field": "business"}',
     '[{"id": "year_month", "hidden": false}, {"id": "carrier_name", "hidden": false},
       {"id": "driver_name", "hidden": false}, {"id": "driver_tax_id", "hidden": false},
       {"id": "category", "hidden": false}]')
ON CONFLICT DO NOTHING;

COMMIT;
