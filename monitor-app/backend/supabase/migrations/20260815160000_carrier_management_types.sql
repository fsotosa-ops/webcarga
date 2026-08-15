-- Tramo 2 del rediseño de Certificación (D7/D9): el tipo de gestión que se
-- elige al dar de alta una empresa.
--
-- POR QUÉ UNA COLUMNA Y NO UNA TABLA PUENTE
-- La marca de gestión se DERIVA de la flota (assets.webcarga_operation_type_id)
-- y así se sigue mostrando: 37 de las 39 empresas activas la responden desde
-- sus vehículos. Esta columna sólo cubre el hueco de las 2 que todavía no
-- tienen flota — un valor de arranque cuya vida útil termina al registrar el
-- primer vehículo, no un hecho permanente.
--
-- Se evaluó una tabla puente y se descartó con datos: las tres que ya existen
-- (carrier_shippers, driver_assignments, asset_assignments) cargan cada una
-- status + start_date + end_date, y entre 241 filas reales hay 3 no-ACTIVE y
-- CERO end_date. Nueve columnas de ciclo de vida que nunca se usaron. Sumar la
-- tabla nº 25 del esquema para servir 2 filas no se sostiene. (Tampoco se
-- resucita carrier_fleet_service_types, eliminada en 20260803030000: aquella
-- murió porque el dato no existía a nivel empresa en la fuente real; ésta sí
-- tiene fuente — una persona la declara en el alta.)
--
-- POR QUÉ UN CONJUNTO Y NO UN ESCALAR CON VALOR 'AMBAS'
-- 'AMBAS' colapsaría un conjunto en un escalar compuesto y obligaría a que
-- toda consulta futura recuerde IN ('TRACTOREO','AMBAS'). Olvidarlo no da
-- error: deja afuera a la empresa mixta EN SILENCIO. Con conjunto,
-- 'TRACTOREO' = ANY(management_types) toma sola a la pura y a la mixta.
-- Además el lado observado ya es un conjunto (array_agg en la CTE
-- carrier_operation_types de compliance.py), así que declarado y observado
-- quedan con la misma forma y se comparan directo.
--
-- POR QUÉ CÓDIGOS Y NO LAS ETIQUETAS DEL CATÁLOGO
-- Las etiquetas de app.status_taxonomies se renombraron dos veces en dos días
-- (20260803060000, 20260804000000). Guardar códigos propios las deja inmunes.
--
-- Nullable a propósito: las 248 empresas existentes quedan en NULL y siguen
-- derivando de su flota. NULL = "no declarado"; el arreglo vacío se rechaza
-- para que no existan dos maneras de decir lo mismo.
ALTER TABLE public.carriers
    ADD COLUMN IF NOT EXISTS management_types TEXT[];

-- CHECK verificado contra Postgres real como constraint (no como expresión),
-- los 9 casos: acepta {TRACTOREO}, {EQUIPO_COMPLETO}, las dos en cualquier
-- orden y NULL; rechaza el arreglo vacío, los duplicados, los valores fuera
-- del dominio y las etiquetas ({'Tractoreo'}).
--
-- Dos gotchas que sólo aparecieron al probarlo:
--  1. array_length(ARRAY[]::text[], 1) devuelve NULL, no 0, así que el arreglo
--     vacío PASABA la condición. Se usa cardinality(), que sí devuelve 0.
--  2. Un CHECK no admite subconsultas, así que la unicidad no puede salir de
--     (SELECT count(DISTINCT ...) FROM unnest(...)). Con el dominio acotado a
--     2 valores y cardinalidad <= 2, un duplicado sólo puede ser {X,X}, y eso
--     se comprueba comparando las dos posiciones.
ALTER TABLE public.carriers
    ADD CONSTRAINT carriers_management_types_check CHECK (
        management_types <@ ARRAY['TRACTOREO','EQUIPO_COMPLETO']
        AND cardinality(management_types) BETWEEN 1 AND 2
        AND (cardinality(management_types) = 1
             OR management_types[1] <> management_types[2])
    );

COMMENT ON COLUMN public.carriers.management_types IS
    'Tipo de gestión DECLARADO en el alta (TRACTOREO / EQUIPO_COMPLETO, uno o '
    'ambos). NULL = no declarado. Lo OBSERVADO manda cuando la empresa tiene '
    'flota: se deriva de assets.webcarga_operation_type_id. Esta columna cubre '
    'a la empresa que todavía no registró vehículos. Escribir siempre con el '
    'orden normalizado (TRACTOREO antes que EQUIPO_COMPLETO) y leer con @> o '
    '= ANY, nunca con igualdad de arreglos.';
