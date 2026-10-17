-- Seguros por empresa (spec 2026-10-17-seguros-por-empresa-design.md): el veredicto de
-- una empresa, calculado una vez en la base.
--
-- WebCarga monitorea si cada transportista está al día con sus pólizas. La vista de
-- empresa pasa a armarse desde `public.carriers` (antes solo tenía las empresas con
-- póliza; las activas sin póliza las agregaba un LEFT JOIN en insurance.py) y suma:
--   - insurance_verdict: gana el primero que se cumple: EXPIRED, NO_POLICY, OVERDUE,
--     NO_DATES, EXPIRING, UP_TO_DATE.
--   - los datos de su razón: la póliza que explica EXPIRED / NO_DATES / EXPIRING
--     (aseguradora y término), la cuota vencida más antigua y las UF impagas.
--   - severe_overdue: alguna póliza con 2 o más cuotas vencidas (la regla D2 del 15/10).
-- `insurance_alert` (Monitor) conserva su regla y sus valores de hoy: no se deriva del
-- veredicto, porque una empresa "Sin fechas" con cuotas vencidas perdería su alerta.
--
-- CREATE OR REPLACE VIEW solo deja agregar columnas al final: las 7 de antes siguen en su
-- orden (quien las lee no cambia) y las nuevas van después. No toca tablas ni datos.

CREATE OR REPLACE VIEW app.carrier_insurance_summary AS
WITH por_poliza AS (
    SELECT policy_id, carrier_id, policy_state, insurance_company, valid_to,
           count(*) FILTER (WHERE installment_state IN ('OVERDUE', 'PENDING'))         AS unpaid,
           count(*) FILTER (WHERE installment_state = 'OVERDUE')                       AS overdue,
           sum(amount_uf) FILTER (WHERE installment_state IN ('OVERDUE', 'PENDING'))   AS unpaid_uf,
           min(due_date) FILTER (WHERE installment_state = 'OVERDUE')                  AS oldest_overdue,
           min(due_date) FILTER (WHERE installment_state IN ('OVERDUE', 'PENDING'))    AS next_due
    FROM app.insurance_status
    WHERE policy_state <> 'CANCELLED'
    GROUP BY policy_id, carrier_id, policy_state, insurance_company, valid_to
),
-- La renovada no cuenta para el estado de la empresa (la reemplazó otra póliza), pero
-- sus cuotas impagas sí: son deudas.
por_empresa AS (
    SELECT carrier_id,
           count(*) FILTER (WHERE policy_state <> 'RENEWED')   AS policies,
           bool_or(policy_state = 'EXPIRED')                   AS any_expired,
           bool_or(policy_state = 'NO_DATES')                  AS any_no_dates,
           bool_or(policy_state = 'EXPIRING')                  AS any_expiring,
           bool_or(policy_state = 'VALID')                     AS any_valid,
           bool_or(overdue >= 2)                               AS severe_overdue,
           sum(unpaid)::int                                    AS unpaid_installments,
           sum(overdue)::int                                   AS overdue_installments,
           sum(unpaid_uf)                                      AS unpaid_uf,
           min(oldest_overdue)                                 AS oldest_overdue_date,
           min(next_due)                                       AS next_due_date
    FROM por_poliza
    GROUP BY carrier_id
)
SELECT
    c.id                                                AS carrier_id,
    coalesce(e.policies, 0)                             AS policies,
    CASE
        WHEN e.any_expired  THEN 'EXPIRED'
        WHEN e.any_no_dates THEN 'NO_DATES'
        WHEN e.any_expiring THEN 'EXPIRING'
        WHEN e.any_valid    THEN 'VALID'
        ELSE 'NO_POLICY'
    END                                                 AS worst_state,
    coalesce(e.unpaid_installments, 0)                  AS unpaid_installments,
    coalesce(e.overdue_installments, 0)                 AS overdue_installments,
    e.next_due_date,
    CASE
        WHEN e.any_expired    THEN 'EXPIRED'
        WHEN e.severe_overdue THEN 'OVERDUE_INSTALLMENTS'
        WHEN e.any_expiring   THEN 'EXPIRING'
    END                                                 AS insurance_alert,
    CASE
        WHEN e.any_expired                          THEN 'EXPIRED'
        WHEN coalesce(e.policies, 0) = 0            THEN 'NO_POLICY'
        WHEN coalesce(e.overdue_installments, 0) > 0 THEN 'OVERDUE'
        WHEN e.any_no_dates                         THEN 'NO_DATES'
        WHEN e.any_expiring                         THEN 'EXPIRING'
        ELSE 'UP_TO_DATE'
    END                                                 AS insurance_verdict,
    coalesce(e.severe_overdue, false)                   AS severe_overdue,
    e.unpaid_uf,
    e.oldest_overdue_date,
    r.insurance_company                                 AS reason_insurer,
    r.valid_to                                          AS reason_valid_to
FROM public.carriers c
LEFT JOIN por_empresa e ON e.carrier_id = c.id
-- La póliza que explica el veredicto: la vencida más reciente, si no la que no tiene
-- término, si no la que vence antes.
LEFT JOIN LATERAL (
    SELECT pp.insurance_company, pp.valid_to
    FROM por_poliza pp
    WHERE pp.carrier_id = c.id AND pp.policy_state IN ('EXPIRED', 'NO_DATES', 'EXPIRING')
    ORDER BY CASE pp.policy_state WHEN 'EXPIRED' THEN 1 WHEN 'NO_DATES' THEN 2 ELSE 3 END,
             CASE WHEN pp.policy_state = 'EXPIRED' THEN pp.valid_to END DESC NULLS LAST,
             pp.valid_to ASC
    LIMIT 1
) r ON true
-- Las activas, y las inactivas que todavía tienen pólizas no canceladas.
WHERE c.operational_status = 'ACTIVE' OR e.carrier_id IS NOT NULL;

REVOKE ALL ON app.carrier_insurance_summary FROM anon, authenticated;
