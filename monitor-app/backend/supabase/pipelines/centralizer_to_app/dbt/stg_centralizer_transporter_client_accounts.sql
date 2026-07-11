{{ config(materialized='view', schema='silver') }}

/*
  stg_centralizer_transporter_client_accounts
  ────────────────────────────────────────────────────────
  Fuente       : bronze.raw_centralizer_transporter — SIN dedupe por rut
                 (grano nativo rut + gc, ~42 filas / 38 rut únicos).
  Granularidad : 1 fila por (rut, client_name).
  Motivo       : stg_centralizer_transporters colapsa a 1 fila por rut
                 (dedupe Walmart-primero) para construir el objeto "empresa";
                 ese colapso pierde el avance/estado del segundo cliente para
                 transportistas multi-cliente (confirmado en datos reales:
                 3 rut con Colun+Walmart, 1 rut con Iansa+Sodimac). Este
                 modelo preserva cada fila (rut, gc) intacta para alimentar
                 app.transporter_client_accounts (auditoría 2026-07-10).
*/

SELECT
    app.normalize_rut(rut)                                                     AS rut,
    gc                                                                         AS client_name,
    NULLIF(NULLIF(TRIM(REPLACE(avance_80_20, '%', '')), ''), '-')::numeric     AS avance_80_20,
    NULLIF(NULLIF(TRIM(REPLACE(avance_total, '%', '')), ''), '-')::numeric     AS avance_total
FROM {{ source('bronze', 'raw_centralizer_transporter') }}
WHERE NULLIF(TRIM(rut), '') IS NOT NULL
  AND NULLIF(TRIM(gc), '') IS NOT NULL
