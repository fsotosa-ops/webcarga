-- name_tokens(): la puntuación del TMS dejaba de ser ruido y pasaba a ser un apellido
--
-- El TMS manda nombres sucios y son muchos: en los últimos 60 días, 135 viajes con
-- nombres como 'CARLOS PEREZ /', 'SIVA CARRILLO ENRIQUE ALBERTO .' o
-- 'HERNANDEZ CONTRERAS EULICES ALFREDO .'. La función partía por espacios y no
-- descartaba nada, así que el '/' y el '.' quedaban como PALABRAS:
--
--     name_tokens('CARLOS PEREZ /')        -> {/, carlos, perez}
--     name_tokens('Carlos Perez Santiago') -> {carlos, perez, santiago}
--     -> el `@>` da FALSE, y por un '/'.
--
-- Consecuencia real, y es el bug crítico #1 de la minuta del 25/08: el conductor
-- QUE SÍ EXISTE deja de ofrecerse como candidato en el Diario, el coordinador
-- aprieta "Crear y asignar", el backend responde 409 porque ya existe, y el
-- frontend se lo traga. En pantalla no pasa nada. Y de rebote explica el otro
-- reclamo ("sugiere gente que sólo comparte el nombre de pila"): al perderse la
-- contención, el popover cae a la lista de PARECIDOS, ordenada por similitud.
--
-- El arreglo: reemplazar todo lo que no sea letra o dígito por un espacio ANTES
-- de partir —así 'SEPULVEDA-ROJAS' da dos palabras y no una— y después descartar
-- las palabras que no tengan ninguna letra, que es lo que saca el '.', el '/' y
-- el '1' de 'JORGE OLAVE / 1'.
--
-- MEDIDO CONTRA PRODUCCIÓN ANTES DE APLICAR, porque esta función la usa
-- app.resolve_trip_fleet() y no es sólo cosmética:
--
--   * 23 de 94 nombres distintos del TMS cambian de tokens.
--   * 15 nombres pasan de 0 a 1 coincidencia EXACTA con el directorio, o sea
--     empiezan a resolver por `by_name` (entre ellos 'HUERAMAN CASTRO DANIEL
--     ANDRES .', el del viaje de Colún que la minuta manda revisar).
--   * 323 viajes quedan alcanzados por esos nombres, y en los 323 el conductor
--     que la regla de nombre elegiría es EL MISMO que ya está vinculado hoy por
--     RUT o por patente: 323 coinciden, 0 discrepan. La corrección no le cambia
--     el conductor a ningún viaje; sólo hace que la regla de nombre esté de
--     acuerdo con lo que las otras ya sabían, y destraba la sugerencia.
--
-- `by_partial` sigue exigiendo >= 3 palabras en común y un único candidato, así
-- que 'CARLOS PEREZ /' (2 palabras, y encima 2 Carlos Pérez en el directorio)
-- NO se auto-resuelve: sigue siendo una decisión humana, que es lo correcto.
--
-- Sin índices ni columnas generadas que dependan de la función (verificado en
-- pg_indexes); el único consumidor en la base es app.resolve_trip_fleet().
--
-- Nota sobre acentos: `translate` ya normaliza el set español (áéíóúñü). Otros
-- diacríticos (ã, ê) los parte el regexp, pero de forma SIMÉTRICA en los dos
-- lados de la comparación, así que la igualdad y la contención se conservan.

CREATE OR REPLACE FUNCTION public.name_tokens(input text)
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $function$
    SELECT array_agg(w ORDER BY w)
    FROM unnest(regexp_split_to_array(
        regexp_replace(
            translate(lower(btrim(coalesce(input, ''))), 'áéíóúñü', 'aeiounu'),
            '[^a-z0-9]+', ' ', 'g'),
        '\s+')) w
    WHERE w ~ '[a-z]';
$function$;

COMMENT ON FUNCTION public.name_tokens(text) IS
    'Palabras de un nombre, normalizadas y ORDENADAS alfabéticamente, sin acentos '
    'ni puntuación. Descarta las palabras sin ninguna letra (el "." y el "/" que '
    'manda el TMS). Comparar por conjunto y no por orden es lo que hace que '
    '"APELLIDO NOMBRE" y "Nombre Apellido" sean la misma persona.';
