-- Seguros E2: renovar y extender vigencia (los dos habilitados; a validar con Pablo).
-- Spec: docs/superpowers/specs/2026-10-15-seguros-polizas-y-cuotas-design.md, "Renovación y extensión".
--
-- En la base real, 6 de las 7 empresas "Vencida" tenían además una póliza
-- vigente: renovaciones cargadas como pólizas nuevas. La regla del peor estado
-- contaba también las ya reemplazadas. Solo agrega; re-ejecutable.

-- 1. Renovación: la nueva apunta a la que reemplaza. Una póliza tiene a lo sumo
--    una sucesora, y ninguna se renueva a sí misma.
ALTER TABLE public.insurance_policies
    ADD COLUMN IF NOT EXISTS renews_policy_id uuid REFERENCES public.insurance_policies(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS insurance_policies_renews_policy_id_key
    ON public.insurance_policies (renews_policy_id) WHERE renews_policy_id IS NOT NULL;
DO $$ BEGIN
    ALTER TABLE public.insurance_policies
        ADD CONSTRAINT insurance_policies_no_self_renewal CHECK (renews_policy_id IS DISTINCT FROM id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Extensión: el historial de vigencia (hecho: antes, después, endoso, quién).
CREATE TABLE IF NOT EXISTS public.policy_term_changes (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id          uuid NOT NULL REFERENCES public.insurance_policies(id) ON DELETE CASCADE,
    previous_valid_to  date,
    new_valid_to       date NOT NULL,
    endorsement_number text,
    endorsement_date   date,
    changed_by         uuid,
    changed_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS policy_term_changes_policy_id_idx ON public.policy_term_changes (policy_id);
ALTER TABLE public.policy_term_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.policy_term_changes FROM anon, authenticated;

-- 3. total_installments deja de escribirse (se cuenta en la vista): sin NOT NULL,
--    el código nuevo puede omitirla antes de que la contracción la borre.
ALTER TABLE public.insurance_installments ALTER COLUMN total_installments DROP NOT NULL;

-- 4. Las vistas: RENEWED es un estado calculado (tiene sucesora). outside_validity
--    nunca es null (revisión final E1).
CREATE OR REPLACE VIEW app.insurance_status AS
WITH hoy AS (
    SELECT (now() AT TIME ZONE 'America/Santiago')::date AS d,
           COALESCE((SELECT warning_days FROM app.alert_thresholds WHERE doc_type = 'poliza_por_vencer'), 30) AS aviso
)
SELECT
    p.id                         AS policy_id,
    p.carrier_id,
    p.insurance_company,
    p.policy_number,
    p.valid_from,
    p.valid_to,
    p.policy_document_url IS NOT NULL AS has_file,
    CASE
        WHEN p.cancelled_at IS NOT NULL        THEN 'CANCELLED'
        WHEN EXISTS (SELECT 1 FROM public.insurance_policies s WHERE s.renews_policy_id = p.id) THEN 'RENEWED'
        WHEN p.valid_to IS NULL                THEN 'NO_DATES'
        WHEN p.valid_to < hoy.d                THEN 'EXPIRED'
        WHEN p.valid_to <= hoy.d + hoy.aviso   THEN 'EXPIRING'
        ELSE 'VALID'
    END                          AS policy_state,
    p.valid_to - hoy.d           AS expires_in_days,
    i.id                         AS installment_id,
    i.installment_number,
    count(i.id) OVER (PARTITION BY p.id) AS installments_total,
    i.due_date,
    i.amount_uf,
    i.paid,
    i.paid_on,
    i.paid_by,
    CASE
        WHEN i.id IS NULL        THEN NULL
        WHEN i.paid              THEN 'PAID'
        WHEN i.due_date < hoy.d  THEN 'OVERDUE'
        ELSE 'PENDING'
    END                          AS installment_state,
    i.due_date - hoy.d           AS due_in_days,
    coalesce(i.id IS NOT NULL AND i.due_date IS NOT NULL
        AND (i.due_date < p.valid_from OR i.due_date > p.valid_to), false) AS outside_validity
FROM public.insurance_policies p
CROSS JOIN hoy
LEFT JOIN public.insurance_installments i ON i.policy_id = p.id;

CREATE OR REPLACE VIEW app.carrier_insurance_summary AS
WITH por_poliza AS (
    SELECT policy_id, carrier_id, policy_state,
           count(*) FILTER (WHERE installment_state IN ('OVERDUE', 'PENDING')) AS unpaid,
           count(*) FILTER (WHERE installment_state = 'OVERDUE')               AS overdue,
           min(due_date) FILTER (WHERE installment_state IN ('OVERDUE', 'PENDING')) AS next_due
    FROM app.insurance_status
    WHERE policy_state <> 'CANCELLED'
    GROUP BY policy_id, carrier_id, policy_state
),
-- La renovada no cuenta para el estado de la empresa (la reemplazó otra póliza),
-- pero sus cuotas impagas sí: son deudas.
vigentes AS (SELECT * FROM por_poliza WHERE policy_state <> 'RENEWED')
SELECT
    pp.carrier_id,
    (SELECT count(*) FROM vigentes v WHERE v.carrier_id = pp.carrier_id) AS policies,
    CASE
        WHEN bool_or(pp.policy_state = 'EXPIRED')  THEN 'EXPIRED'
        WHEN bool_or(pp.policy_state = 'NO_DATES') THEN 'NO_DATES'
        WHEN bool_or(pp.policy_state = 'EXPIRING') THEN 'EXPIRING'
        WHEN bool_or(pp.policy_state = 'VALID')    THEN 'VALID'
        ELSE 'NO_POLICY'
    END                         AS worst_state,
    sum(pp.unpaid)::int         AS unpaid_installments,
    sum(pp.overdue)::int        AS overdue_installments,
    min(pp.next_due)            AS next_due_date,
    CASE
        WHEN bool_or(pp.policy_state = 'EXPIRED')  THEN 'EXPIRED'
        WHEN bool_or(pp.overdue >= 2)              THEN 'OVERDUE_INSTALLMENTS'
        WHEN bool_or(pp.policy_state = 'EXPIRING') THEN 'EXPIRING'
    END                         AS insurance_alert
FROM por_poliza pp
GROUP BY pp.carrier_id;

REVOKE ALL ON app.insurance_status FROM anon, authenticated;
REVOKE ALL ON app.carrier_insurance_summary FROM anon, authenticated;
