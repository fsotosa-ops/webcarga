{% snapshot snapshot_carriers %}
{{
    config(
        target_schema='silver',
        unique_key='id',
        strategy='check',
        check_cols=['business_name', 'tax_id', 'operational_status', 'status_reason_id'],
        invalidate_hard_deletes=True
    )
}}
/*
  snapshot_carriers
  ──────────────────────────────────────────────────────────────────
  Fuente       : public.carriers (Directorio de la app)
  Granularidad : una versión por empresa cada vez que cambia su nombre, RUT, estado del ciclo de vida o motivo.
  Consumidor   : gold.dim_carrier (SCD2).

  La historia empieza cuando corre por primera vez (diseño de Analítica, 21/10): lo anterior no se reconstruye.
  dim_carrier extiende la primera versión hacia atrás y la marca (history_known = false).
*/
SELECT id, business_name, tax_id, operational_status, status_reason_id, updated_at
FROM {{ source('directory', 'carriers') }}
{% endsnapshot %}
