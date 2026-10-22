# Analítica

El modelo dimensional de la BDOT reconstruida desde la app. Diseño:
`docs/superpowers/specs/2026-10-21-analitica-modelo-dimensional-design.md`.

- **Dónde corre:** en Mage, en el proyecto dbt `dbt/tms`, carpetas `models/gold` (el modelo) y `models/analytics`
  (la presentación). Lo corre el pipeline `analytics_gold` cada hora en el minuto 20
  (`dbt build --select snapshot_carriers gold analytics`), separado de la ingesta.
- **Qué lee la app:** solo `analytics`.
  - `analytics.bdot`: la sábana, un viaje por fila, sin datos personales.
  - `analytics.driver_identity`: nombre y RUT de cada conductor (se une por `driver_id`); con el rol
    `analytics_personal_reader` o el permiso `analytics.personal_data` de la app.
  - `analytics.fleet_daily`: conductor o equipo por día, como lo dice el Cierre, con los clientes de sus viajes de
    ese día (`client_names`).
- **Ojo:** `analytics` son TABLAS, no vistas. dbt reconstruye gold con `DROP ... CASCADE`, que borraría una vista
  encima. No correr `dbt run --select gold` sin `analytics`: el pipeline los corre juntos.
- **Qué hay en `dbt/`:** una copia versionada de lo que corre en Mage. No se edita aquí: se edita en
  `.mage-agent/local_sync`, se sincroniza a Mage y se copia con `./sync-gold-from-mage.sh`.
- **Reglas compartidas con la app:** zona del destino, origen, último destino, tipo de operación de un local y
  categoría de una línea del Cierre son funciones de la base (migraciones `20261101090000` y `20261102090000`).
  Gold las llama; no las reescribe.
