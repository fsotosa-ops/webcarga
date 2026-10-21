/*
  dim_date
  ──────────────────────────────────────────────────────────────────
  Fuente       : generada (calendario)
  Granularidad : un día, del 2026-01-01 al 31/12 del año siguiente al actual.
  Consumidor   : todos los hechos (fecha de planificación, de despacho, de entrega, del día del cierre).

  Los días son de Chile: los hechos convierten sus marcas a America/Santiago antes de unir (21/10).
  Feriados: pendiente (no hay fuente en la app).
*/
WITH dias AS (
    SELECT d::date AS date_day
    FROM generate_series(
        DATE '2026-01-01',
        make_date(extract(year FROM current_date)::int + 1, 12, 31),
        INTERVAL '1 day'
    ) AS d
)
SELECT
    (to_char(date_day, 'YYYYMMDD'))::int                          AS date_key,
    date_day,
    extract(isoyear FROM date_day)::int                           AS iso_year,
    extract(week FROM date_day)::int                              AS iso_week,
    extract(year FROM date_day)::int                              AS year,
    extract(quarter FROM date_day)::int                           AS quarter,
    extract(month FROM date_day)::int                             AS month,
    (ARRAY['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre',
           'Diciembre'])[extract(month FROM date_day)::int]       AS month_name,
    to_char(date_day, 'YYYY-MM')                                  AS year_month,
    extract(isodow FROM date_day)::int                            AS iso_day_of_week,
    (ARRAY['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'])[extract(isodow FROM date_day)::int]
                                                                  AS day_name,
    extract(isodow FROM date_day) IN (6, 7)                       AS is_weekend
FROM dias
