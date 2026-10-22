-- La capa de presentación de Analítica: el schema y sus roles (diseño de Analítica, 21-22/10).
--
-- Las tablas de `analytics` NO se crean aquí: son modelos de dbt (Mage, dbt/tms/models/analytics). dbt reconstruye
-- gold con DROP ... CASCADE cada hora, que borraría una vista creada por migración (probado el 22/10); por eso la
-- presentación son tablas que dbt reemplaza de una vez. dbt les da SELECT a estos roles con su config `grants`.
--
-- Roles (NOLOGIN, de grupo): una herramienta de BI o un usuario de lectura se crea después y recibe uno de ellos.
--   analytics_reader          : la sábana y los reportes, sin datos personales.
--   analytics_personal_reader : lo anterior más analytics.bdot_people (nombre y RUT del conductor).
-- La API conecta como hoy (postgres); el control de datos personales en la app es el permiso
-- analytics.export_personal_data. Estos roles son para el acceso directo a la base.

BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics;
COMMENT ON SCHEMA analytics IS
    'Presentación de Analítica: tablas delgadas sobre gold (modelos de dbt). Sin lógica propia. Ver docs/superpowers/specs/2026-10-21-analitica-modelo-dimensional-design.md';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_reader') THEN
        CREATE ROLE analytics_reader NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_personal_reader') THEN
        CREATE ROLE analytics_personal_reader NOLOGIN;
    END IF;
END $$;

GRANT analytics_reader TO analytics_personal_reader;

REVOKE ALL ON SCHEMA analytics FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA analytics TO analytics_reader;

COMMIT;
