-- Fase 4 (HU-03, Cierre del Día): cierre por TRACTO/EQUIPO, no por
-- conductor. Confirmado contra los documentos fuente (HU_CierreDelDia_
-- Diario2.md 30/07, superó a la HU de conductores del 20/07 que ya
-- implementaba app.driver_day_status/app.daily_closures): "El sistema
-- lista todos los tractos SIN CARGA del día" / "El cierre de tractoreo es
-- ACTIVO: registrar el motivo de cada tracto sin asignar es obligatorio" /
-- "El cierre de equipos completos es PASIVO". El conductor sigue existiendo
-- (se muestra junto a cada tracto, y el caso especial de viaje manual sigue
-- operando a nivel de conductor) pero deja de ser la unidad que se cierra.
--
-- app.driver_day_status/app.daily_closures NO se tocan ni se eliminan en
-- esta migración — quedan intactos, sin uso desde la UI (recuperables si
-- se necesitan a futuro), evitando una acción destructiva sin pedido
-- explícito.
--
-- Mismo patrón que driver_day_status: se recalcula en cada GET (resolución
-- en vivo, sin watermark incremental), preservando unassigned_reason_id/
-- resolved_by/resolved_at ya capturados a mano mientras el equipo siga
-- UNASSIGNED.
CREATE TABLE app.equipment_day_status (
    asset_id            uuid NOT NULL REFERENCES public.assets(id),
    business_date       date NOT NULL,
    status              text NOT NULL CHECK (status IN ('ASSIGNED', 'UNASSIGNED')),
    -- Confirmado con el usuario 2026-08-02: "Sin clasificar" (el 100% de
    -- las empresas hoy, carrier_fleet_service_types sin ingesta real
    -- todavía) se trata como Tractoreo (activo, exige motivo) — más
    -- riguroso que dejarlo pasar en silencio, fuerza a notar la
    -- clasificación faltante en vez de ocultarla. Un equipo con AMBOS
    -- tipos seleccionados (multi-selector) también exige motivo (mismo
    -- criterio de rigor). Solo un equipo puramente Equipo Completo (sin
    -- Tractoreo) queda pasivo.
    requires_motivo     boolean NOT NULL DEFAULT true,
    unassigned_reason_id uuid REFERENCES app.status_taxonomies(id),
    resolved_by         uuid,
    resolved_at         timestamptz,
    computed_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (asset_id, business_date)
);

CREATE TABLE app.equipment_closures (
    business_date   date PRIMARY KEY,
    closed_by       uuid,
    closed_at       timestamptz NOT NULL DEFAULT now(),
    total_equipment integer NOT NULL,
    resolved_count  integer NOT NULL,
    override_count  integer NOT NULL DEFAULT 0
);
