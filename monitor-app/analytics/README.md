# Analítica

El modelo dimensional de la BDOT reconstruida desde la app. Diseño:
`docs/superpowers/specs/2026-10-21-analitica-modelo-dimensional-design.md`.

- **Dónde corre:** en Mage, en el proyecto dbt `dbt/tms`, carpeta `models/gold`. Lo corre el pipeline
  `analytics_gold` cada hora en el minuto 20 (`dbt build --select snapshot_carriers gold`), separado de la ingesta.
- **Qué hay en `dbt/`:** una copia versionada de lo que corre en Mage. No se edita aquí: se edita en
  `.mage-agent/local_sync`, se sincroniza a Mage y se copia con `./sync-gold-from-mage.sh`.
- **Reglas compartidas con la app:** zona del destino, origen, último destino, tipo de operación de un local y
  categoría de una línea del Cierre son funciones de la base (migraciones `20261101090000` y `20261102090000`).
  Gold las llama; no las reescribe.
