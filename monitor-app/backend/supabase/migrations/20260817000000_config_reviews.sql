-- El registro de revisión de Configuración.
--
-- Hoy 35 de 37 requisitos no tienen condición, y esa columna vacía significa
-- DOS cosas a la vez: "lo revisamos y va para todos" y "nadie lo miró". Es la
-- misma clase de defecto que aparecio cinco veces en el Tramo 3 —un valor con
-- dos significados— y tiene consecuencia medible: 16 remolques tienen exigida
-- Mantención de Cámara de Frío sin poder tenerla, no porque alguien decidiera
-- mal sino porque nadie decidió, y el sistema no tenía cómo mostrarlo.
--
-- Lo que se guarda es el hecho, no un flujo: quién revisó y cuándo. Sin
-- estados intermedios, sin aprobación, SIN CADUCIDAD. Poner vencimiento
-- convierte la portada en una lista de tareas que nadie pidió y enseña a
-- ignorar la insignia.
--
-- NO se deduce de `audit_log`, que ya registra quién cambió qué. Sería gratis,
-- pero "hay una fila en el log" significaría a la vez "alguien lo cambió" y
-- "alguien lo confirmó": otra vez un valor con dos significados, que es
-- exactamente lo que esta tabla viene a separar.

CREATE TABLE IF NOT EXISTS app.config_reviews (
    -- El dominio y la sección son los slugs del frontend (en inglés, como las
    -- rutas). La sección forma parte de la llave y no es decoración: dos
    -- secciones del mismo dominio enumeran tablas distintas, y sin ella un id
    -- de `trip_statuses` ('ASIGNADO') podría chocar con un `cargo_type`.
    domain      text        NOT NULL,
    section     text        NOT NULL,
    -- El id del elemento, como texto: unos son uuid y otros son códigos
    -- propios ('ASIGNADO', 'CONGELADO'). Se guarda como texto porque la tabla
    -- sirve a varias tablas de origen; no hay FK por lo mismo.
    element_id  text        NOT NULL,
    reviewed_by uuid        NOT NULL REFERENCES public.profiles(id),
    reviewed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (domain, section, element_id)
);

COMMENT ON TABLE app.config_reviews IS
    'Quién revisó cada elemento de Configuración y cuándo. Guardar cuenta como '
    'revisar; "Confirmar" existe sólo para el caso invisible ("lo miré y está '
    'bien así"). No vence.';

-- La consulta que manda es "cuántos sin revisar hay en este dominio": se
-- resuelve con la PK, que ya cubre (domain, section, element_id). No hace
-- falta indice adicional.

ALTER TABLE app.config_reviews ENABLE ROW LEVEL SECURITY;

-- Lee cualquiera que este autenticado; escribe el backend con su clave de
-- servicio, igual que el resto del esquema `app`.
DROP POLICY IF EXISTS config_reviews_lectura ON app.config_reviews;
CREATE POLICY config_reviews_lectura ON app.config_reviews
    FOR SELECT TO authenticated USING (true);
