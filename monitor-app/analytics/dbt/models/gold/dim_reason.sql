/*
  dim_reason
  ──────────────────────────────────────────────────────────────────
  Fuente       : app.status_taxonomies (Configuración: catálogos de motivos y tipos)
  Granularidad : un valor de un catálogo (domain + code). SCD1: renombrar una etiqueta en Configuración la
                 renombra en toda la historia, que es lo que se espera de un catálogo.
  Consumidor   : motivos de no asignación y de anulación del viaje, motivos del cierre, tipos de operación.
  Por código estable, nunca por etiqueta.
*/
SELECT
    t.id            AS reason_id,
    t.domain,
    t.code,
    t.label,
    t.group_id,
    t.sort_order,
    t.active
FROM {{ source('app_catalogs', 'status_taxonomies') }} t
