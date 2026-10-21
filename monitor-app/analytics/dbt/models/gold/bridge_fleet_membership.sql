/*
  bridge_fleet_membership
  ──────────────────────────────────────────────────────────────────
  Fuente       : app.fleet_assignment_periods (historia de asignaciones de la app, tipo 2 nativo)
  Granularidad : un período de pertenencia: conductor → empresa, equipo → empresa, empresa → cliente.
  Consumidor   : fct_trips y fct_fleet_daily_status, para saber la empresa de un conductor o equipo EN SU FECHA
                 (equivalente a app.carrier_of, hecho como unión por rango).

  La historia real empieza el 2026-10-16. Las asignaciones vigentes de antes se sembraron sin límite inferior:
  valid_from = -infinity y history_known = false (diseño de Analítica 21/10).
*/
SELECT
    p.id                                              AS membership_id,
    p.relation,
    p.subject_id,
    p.counterpart_id,
    COALESCE(lower(p.valid_during), '-infinity'::date) AS valid_from,
    COALESCE(upper(p.valid_during), 'infinity'::date)  AS valid_to,
    upper_inf(p.valid_during)                          AS is_open,
    NOT lower_inf(p.valid_during)                      AS history_known
FROM {{ source('app_catalogs', 'fleet_assignment_periods') }} p
