-- Fase 1 del hardening del Diario (2026-07-18) — mecanismo ONGOING de
-- trazabilidad conductor↔vehículo, para reemplazar la dependencia de
-- bronze.raw_bd_ot (bootstrap histórico de una sola vez, migración
-- 20260718060000) en los viajes que entren de acá en adelante.
--
-- Motivo: public.driver_assignments vincula conductor↔EMPRESA y
-- public.asset_assignments vincula vehículo↔EMPRESA, pero ninguna de las
-- dos dice qué conductor específico maneja qué vehículo específico — el
-- dato que realmente hace falta para inferir driver_id de un viaje nuevo
-- de QAnalytics/Sodimac (que nunca reportan RUT ni nombre de conductor,
-- solo patente — ver AGENTLOG ronda "Fase 1 en curso"). raw_bd_ot resolvía
-- esto para el histórico porque cruzaba patente+fecha contra sus propias
-- OTs, pero es una plataforma legacy que se va a dar de baja — no sirve
-- como dependencia permanente (trips_context.md §5.3).
--
-- Diseño: mismo patrón exacto que driver_assignments/asset_assignments
-- (status ACTIVE/INACTIVE, vigencia por fecha, is_manual_override para
-- proteger reasignaciones humanas de sobrescritura automática). Operaciones
-- mantiene esto UNA vez por vehículo (qué conductor lo maneja hoy) en vez
-- de vincular conductor viaje por viaje — el pipeline/API lo consulta
-- automáticamente vía patente para cualquier viaje nuevo.

BEGIN;

CREATE TABLE public.vehicle_driver_assignments (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id         uuid NOT NULL REFERENCES public.assets(id),
    driver_id        uuid NOT NULL REFERENCES public.drivers(id),
    status           varchar NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    start_date       date NOT NULL DEFAULT CURRENT_DATE,
    end_date         date,
    created_at       timestamptz NOT NULL DEFAULT now(),
    is_manual_override boolean NOT NULL DEFAULT false,
    overridden_by    uuid,
    overridden_at    timestamptz,
    UNIQUE (asset_id, driver_id)
);

-- A lo sumo un conductor ACTIVE por vehículo a la vez — mismo principio de
-- "reasignar desactiva la anterior" que ya usa driver_assignments/
-- asset_assignments en carriers.py.
CREATE UNIQUE INDEX ux_vehicle_driver_assignments_active_asset
    ON public.vehicle_driver_assignments (asset_id)
    WHERE status = 'ACTIVE';

CREATE INDEX ix_vehicle_driver_assignments_driver ON public.vehicle_driver_assignments (driver_id);

ALTER TABLE public.vehicle_driver_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicle_driver_assignments_read ON public.vehicle_driver_assignments
    FOR SELECT TO authenticated USING (true);

COMMIT;
