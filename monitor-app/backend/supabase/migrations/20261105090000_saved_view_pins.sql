-- Las vistas que cada persona fija como pestañas en Analítica (patrón de HubSpot, decisión del usuario 22/10).
--
-- Sin filas para un conjunto de datos, la persona ve fijadas las compartidas del sistema y las suyas (lo calcula la
-- API). La primera vez que fija o suelta una, la API guarda esa selección por defecto más el cambio, y desde ahí
-- manda lo que eligió.

BEGIN;

CREATE TABLE IF NOT EXISTS app.saved_view_pins (
    user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    view_id    uuid NOT NULL REFERENCES app.saved_views(id) ON DELETE CASCADE,
    dataset    text NOT NULL CHECK (dataset IN ('trips', 'fleet')),
    pinned     boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, view_id)
);

COMMENT ON TABLE app.saved_view_pins IS
  'Qué vistas de Analítica fija cada persona como pestaña. Sin filas de un conjunto de datos, la API usa las compartidas del sistema y las propias. La escribe solo la API.';

REVOKE ALL ON app.saved_view_pins FROM anon, authenticated;

COMMIT;
