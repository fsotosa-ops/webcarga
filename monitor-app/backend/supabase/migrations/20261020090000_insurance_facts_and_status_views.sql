-- Seguros, Entrega 1 (expandir): la base guarda hechos y los estados se calculan al leer.
-- Spec: docs/superpowers/specs/2026-10-15-seguros-polizas-y-cuotas-design.md
--
-- Antes: `insurance_policies.status` (ACTIVE en 33 de 33, 9 ya vencidas) e
-- `insurance_installments.payment_status` (OVERDUE guardado en 87, PENDING con
-- fecha pasada en 63) eran estados guardados, y la vigencia se calculaba en una
-- vista MATERIALIZADA que solo se refrescaba cuando alguien escribía: una póliza
-- vencida ayer seguía "al día" si nadie tocaba Seguros.
--
-- Esta migración SOLO AGREGA (no borra nada, ni la vista materializada): los hechos nuevos (rellenados desde los datos
-- actuales, que son la base: carga de prueba desde Mage) y dos vistas normales.
-- Las columnas viejas las borra la Entrega 2, con su copia en audit_log.
-- Re-ejecutable.

-- 1. Hechos de la póliza: solo la cancelación la decide una persona.
ALTER TABLE public.insurance_policies
    ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
    ADD COLUMN IF NOT EXISTS cancelled_reason text;

UPDATE public.insurance_policies
SET cancelled_at = updated_at
WHERE status = 'CANCELLED' AND cancelled_at IS NULL;

-- 2. Hechos de la cuota. `paid` y `paid_on` son dos columnas a propósito: un
--    null no puede querer decir a la vez "impaga" y "pagada sin fecha" (hay 54
--    pagadas sin fecha registrada).
ALTER TABLE public.insurance_installments
    ADD COLUMN IF NOT EXISTS paid boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS paid_on date,
    ADD COLUMN IF NOT EXISTS paid_by uuid;

-- Solo mientras nadie haya pagado o deshecho un pago con la API nueva (lo dice
-- la auditoría): después, payment_status ya no se mantiene y volver a correr
-- esto resucitaría un pago deshecho. Re-ejecutable sin ese riesgo.
UPDATE public.insurance_installments
SET paid = true,
    paid_on = (paid_at AT TIME ZONE 'America/Santiago')::date
WHERE payment_status = 'PAID' AND paid = false
  AND NOT EXISTS (SELECT 1 FROM public.audit_log
                  WHERE entity_type = 'INSURANCE_POLICY' AND field = 'paid');

-- 3. El plazo de "Por vencer" de las pólizas: el mismo mecanismo que los
--    documentos (una fila global), sin pantalla hasta el rediseño de
--    Configuración. Las 33 pólizas usaban 30 días.
INSERT INTO app.alert_thresholds (doc_type, label, warning_days, error_days)
VALUES ('poliza_por_vencer', 'Póliza por vencer', 30, 0)
ON CONFLICT (doc_type) DO NOTHING;

-- 4. La vista materializada (app.carrier_insurance_status), su función de
--    refresco y sus 4 triggers se quedan hasta la Entrega 2: la API que corre
--    al aplicar esto todavía la lee. Ningún código nuevo la usa.

-- 5. El estado de la póliza y de cada cuota: UNA regla, calculada al leer.
--    "Hoy" es la fecha de Chile, solo aquí: los días que faltan (expires_in_days,
--    due_in_days) salen de la vista para que nadie más recalcule "hoy".
--    Una fila por cuota, y una por póliza sin cuotas.
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
    (i.id IS NOT NULL AND i.due_date IS NOT NULL
        AND (i.due_date < p.valid_from OR i.due_date > p.valid_to)) AS outside_validity
FROM public.insurance_policies p
CROSS JOIN hoy
LEFT JOIN public.insurance_installments i ON i.policy_id = p.id;

-- 6. La empresa: el peor estado de sus pólizas no canceladas, y la alerta del
--    Monitor (D2: 2 o más cuotas vencidas en una póliza es regla del negocio).
--    La leen la lista de Seguros, la ficha de empresa y /trips.
CREATE OR REPLACE VIEW app.carrier_insurance_summary AS
WITH por_poliza AS (
    SELECT policy_id, carrier_id, policy_state,
           count(*) FILTER (WHERE installment_state IN ('OVERDUE', 'PENDING')) AS unpaid,
           count(*) FILTER (WHERE installment_state = 'OVERDUE')               AS overdue,
           min(due_date) FILTER (WHERE installment_state IN ('OVERDUE', 'PENDING')) AS next_due
    FROM app.insurance_status
    WHERE policy_state <> 'CANCELLED'
    GROUP BY policy_id, carrier_id, policy_state
)
SELECT
    carrier_id,
    count(*)                    AS policies,
    CASE
        WHEN bool_or(policy_state = 'EXPIRED')  THEN 'EXPIRED'
        WHEN bool_or(policy_state = 'NO_DATES') THEN 'NO_DATES'
        WHEN bool_or(policy_state = 'EXPIRING') THEN 'EXPIRING'
        ELSE 'VALID'
    END                         AS worst_state,
    sum(unpaid)::int            AS unpaid_installments,
    sum(overdue)::int           AS overdue_installments,
    min(next_due)               AS next_due_date,
    CASE
        WHEN bool_or(policy_state = 'EXPIRED')  THEN 'EXPIRED'
        WHEN bool_or(overdue >= 2)              THEN 'OVERDUE_INSTALLMENTS'
        WHEN bool_or(policy_state = 'EXPIRING') THEN 'EXPIRING'
    END                         AS insurance_alert
FROM por_poliza
GROUP BY carrier_id;

-- 7. Como el resto de las vistas de app (20260818200000): solo la API las lee.
REVOKE ALL ON app.insurance_status FROM anon, authenticated;
REVOKE ALL ON app.carrier_insurance_summary FROM anon, authenticated;
