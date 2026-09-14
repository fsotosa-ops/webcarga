-- Destraba los viajes que el TMS ya cerró y el override manual mantenía vivos
--
-- Reportado por el usuario el 14/09: los viajes 2048268 y 30159194, del 07-09
-- y con estado "CERRADO FINALIZADO", seguían apareciendo en la pestaña
-- "En Curso" del Monitor una semana después.
--
-- LA CAUSA, y por qué esta migración no alcanza sola:
--
-- 1. `IndicatorSwitches` deja encender Activo/Trabajando/Asignado en el
--    detalle del viaje. `PATCH /trips/{id}` guarda el valor Y agrega el
--    nombre del campo a `manually_edited_fields`.
-- 2. El trigger `app.protect_manual_overrides()` congela esa columna. Hasta
--    hoy lo hacía SIN condición de salida: el pipeline nunca más podía
--    tocarla.
-- 3. El TMS cerraba el viaje, el pipeline intentaba apagar `is_active`, y el
--    trigger lo revertía.
-- 4. La pestaña "En Curso" es literalmente `is_active = true`, así que el
--    viaje no se iba nunca.
--
-- La causa raíz se arregló en el post_hook de `dbt/tms/models/app/trips.sql`
-- (Mage), que es quien crea esa función con CREATE OR REPLACE en cada
-- corrida: una migración que la reemplace acá quedaría revertida en la
-- siguiente pasada. Desde ahora, si el estado entrante pertenece al grupo
-- `cerrado`, `is_active`/`is_working` dejan de estar protegidos y la marca se
-- retira del array.
--
-- PERO esa liberación ocurre en un UPDATE, y estos viajes ya no vienen en el
-- feed del TMS —están cerrados hace una semana—, así que nadie los va a
-- volver a actualizar. Sin esta migración quedarían trabados para siempre.
--
-- Medido contra producción el 14/09 antes de escribirla: 10 filas, de las
-- cuales 4 visibles en "En Curso" (2047773, 2048098, 2048268, 30159194) y las
-- 10 marcadas como "trabajando" sobre viajes que el TMS dio por terminados.
--
-- `is_assigned` NO se toca, ni acá ni en el trigger: responde "¿tomamos
-- nosotros esta carga?", que es una corrección humana sobre algo que el TMS
-- no sabe mejor. 2048098 conserva su `{is_assigned}` a propósito.

-- POR QUÉ SE APAGA EL TRIGGER PARA ESTE UPDATE:
--
-- La función nueva vive en el post_hook de dbt y entra recién en la próxima
-- corrida del pipeline. Con la función VIEJA todavía viva, este UPDATE se
-- revierte a sí mismo: probado contra producción en una transacción
-- revertida, decía `UPDATE 10` y dejaba `is_active`/`is_working` en true con
-- el array ya vacío. O sea el peor resultado posible — se ve aplicado y no lo
-- está, y encima pierde la marca que lo explicaba.
--
-- Apagarlo acá hace que la migración sea auto-contenida: da igual si se
-- aplica antes o después de que dbt publique la función nueva. Va dentro de
-- una transacción explícita porque el DDL en Postgres es transaccional: si
-- algo falla, el trigger vuelve a quedar encendido solo.

BEGIN;

ALTER TABLE app.trips DISABLE TRIGGER trg_protect_manual_overrides;

UPDATE app.trips t
SET is_active  = false,
    is_working = false,
    manually_edited_fields = array_remove(
        array_remove(t.manually_edited_fields, 'is_active'), 'is_working'),
    updated_at = now()
FROM app.trip_statuses s
WHERE s.id = t.trip_status
  AND s.group_id = 'cerrado'
  AND ('is_active' = ANY(t.manually_edited_fields)
       OR 'is_working' = ANY(t.manually_edited_fields));

ALTER TABLE app.trips ENABLE TRIGGER trg_protect_manual_overrides;

COMMIT;
