-- macros/parse_date_tms.sql
{% macro parse_date_tms(column_expr, tms_name='qanalytics') %}
{%- set cleaned = "NULLIF(TRIM(" ~ column_expr ~ "), '')" -%}
    CASE
        WHEN {{ cleaned }} IS NULL THEN NULL::timestamptz
        {% if tms_name == 'qanalytics' %}
        ELSE TO_TIMESTAMP({{ cleaned }}, 'DD/MM/YYYY HH24:MI:SS')::timestamp
             AT TIME ZONE 'America/Santiago'
        {% elif tms_name == 'sodimac' %}
        ELSE TO_TIMESTAMP({{ cleaned }}, 'DD-MM-YYYY')::timestamp
             AT TIME ZONE 'America/Santiago'
        {% elif tms_name == 'wingsuite' %}
        ELSE TO_TIMESTAMP({{ cleaned }}, 'DD-MM-YYYY HH24:MI:SS')::timestamp
             AT TIME ZONE 'America/Santiago'
        {% else %}
        ELSE NULL::timestamptz
        {% endif %}
    END
{% endmacro %}
