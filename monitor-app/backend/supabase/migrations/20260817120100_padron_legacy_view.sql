-- ============================================================================
-- Insumo de la Capa 2: el padrón derivado del legacy
-- ============================================================================
-- Spec: docs/superpowers/specs/2026-08-17-modelo-resolucion-flota-design.md
--
-- Vive en `app` y consume `public` — esa es la direccion correcta: la base
-- esta en public y desde ahi alimenta app.
--
-- DE DONDE SALE: bronze.raw_bd_ot, que Mage carga del Excel
-- `Finanzas/BD OT 2026.xlsx` (SharePoint). Ese archivo SIGUE VIVO —ultima
-- edicion 2026-08-12— pero cambio de oficio: es un libro de liquidacion, y
-- sus despachos cortan el 2026-07-31. Cero despachos en agosto.
--
-- POR ESO NO SE CRUZA POR DIA. Cruzando patente+fecha, agosto resuelve 0 de
-- 528. Como padron resuelve 528 de 528, porque las patentes que ruedan hoy
-- son las mismas que el archivo conocia en julio.
--
-- ES UNA INFERENCIA, NO UN HECHO. Por eso es una vista auditable —se puede
-- preguntar de donde salio cada fila y de cuando es— y por eso quien consuma
-- esto DEBE aplicar el corte de frescura. Medido contra julio:
--
--     evidencia < 3 meses   673 casos   94,2% de acierto
--     evidencia 3-6 meses    25 casos    4,0% de acierto
--
-- El 91% global que figuraba en el plan escondia esas dos poblaciones. Una
-- entrada vieja no es una conjetura peor: es un nombre casi seguro
-- equivocado, y en el Cierre un nombre plausible se confirma solo.
-- `ultimo_despacho` esta expuesto justamente para poder cortar.

CREATE OR REPLACE VIEW app.v_legacy_padron_conductor AS
WITH despachos AS (
    SELECT public.patente_canonica(o.patente_camion) AS patente,
           public.rut_canonico(o.rut_chofer)         AS tax_id,
           btrim(o.chofer)                           AS nombre_legacy,
           CASE WHEN btrim(o.f_despacho) ~ '^\d{4}-\d{2}-\d{2}'
                THEN to_timestamp(btrim(o.f_despacho), 'YYYY-MM-DD HH24:MI:SS')::date
           END                                       AS despacho
    FROM bronze.raw_bd_ot o
),
validos AS (
    -- Las tres condiciones son la misma idea: si no se puede identificar al
    -- tracto, a la persona, o cuando fue, la fila no sirve como evidencia.
    SELECT * FROM despachos
    WHERE patente IS NOT NULL AND tax_id IS NOT NULL AND despacho IS NOT NULL
),
-- bronze.raw_bd_ot es append-only por hash de fila y ADEMAS tiene 3.477 filas
-- duplicadas: el `WHERE NOT EXISTS` de bd_ot_master.sql compara contra el
-- destino pero no dentro del propio lote, asi que dos filas identicas en una
-- misma carga entran las dos. Sin este DISTINCT un conductor pesaria mas por
-- haberse recargado, no por haber manejado mas.
distintos AS (
    SELECT DISTINCT patente, tax_id, nombre_legacy, despacho FROM validos
),
ranking AS (
    SELECT patente, tax_id,
           max(nombre_legacy) AS nombre_legacy,
           max(despacho)      AS ultimo_despacho,
           count(*)           AS despachos
    FROM distintos GROUP BY patente, tax_id
)
SELECT DISTINCT ON (patente)
    patente, tax_id, nombre_legacy, ultimo_despacho, despachos
FROM ranking
-- El desempate es deliberado: manda QUIEN LO MANEJO MAS RECIENTEMENTE, y
-- recien despues quien lo manejo mas veces. Un conductor que hizo 200 viajes
-- hasta marzo no es el habitual de un tracto que otro maneja desde junio.
ORDER BY patente, ultimo_despacho DESC, despachos DESC, tax_id;

COMMENT ON VIEW app.v_legacy_padron_conductor IS
    'Inferencia: conductor habitual por tracto, derivada de bronze.raw_bd_ot. '
    'Quien la consuma DEBE cortar por ultimo_despacho: < 3 meses acierta '
    '94,2%, entre 3 y 6 meses acierta 4,0%.';
