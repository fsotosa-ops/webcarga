-- ==============================================================================
-- Corrige has_expiration en el catálogo de requisitos
-- ==============================================================================
--
-- PROBLEMA: 35 de los 37 requisitos tienen has_expiration = false, incluidos
-- la licencia de conducir, la revisión técnica y el SOAP. Solo SEGURO_CARGA e
-- INSURANCE_POLICY estaban marcados correctamente.
--
-- La columna existe desde la migración inicial (20260715204925) y ningún query
-- del backend la leía, así que el dato incorrecto nunca molestó. Ahora sí: es
-- la que decide si se exige la fecha de vencimiento al cargar un documento
-- (HU-02 / HU-01 de la épica Red de Transporte). Con el catálogo así, la
-- validación quedaría escrita pero prácticamente inactiva.
--
-- GRUPO 1 — confirmados por evidencia, no por criterio: son requisitos que los
-- usuarios YA cargaron con fecha de vencimiento en producción, pese a estar
-- marcados como que no vencen. El dato real contradice al catálogo.
--
-- GRUPO 2 — por vigencia legal en Chile. Todavía no tienen registros con fecha
-- (hay muy pocos documentos cargados en total), así que acá el criterio es
-- normativo y no empírico. CONVIENE VALIDARLO CON PABLO/FABIÁN antes de aplicar.
--
-- EXCLUIDOS a propósito, por ser dudosos: CAPACITACION_EPP y ENTREGA_EPP (¿se
-- renuevan anualmente?), CERTIFICADO_GPS (¿el certificado vence o solo el
-- servicio?), CONTRATO_TRABAJO (indefinido vs. plazo fijo). Y los que
-- claramente no vencen: PADRON, ROLL_SII, CUENTA_BANCARIA, CONTRATO_WEBCARGA,
-- POLITICA_SEGURIDAD, REGLAMENTO_INTERNO, PTS_*, ANEXO_*, DAS_ODI,
-- PLAN_EMERGENCIA.
--
-- Esta migración NO toca ningún compliance_record: solo corrige el catálogo.
-- Los documentos ya cargados sin fecha siguen sin fecha; la validación aplica
-- de acá en adelante.
-- ==============================================================================

BEGIN;

-- ── GRUPO 1: confirmados por datos reales ───────────────────────────────────
-- Estos 8 ya tienen al menos un compliance_record con expiration_date cargada
-- a mano por un usuario, lo que prueba que vencen en la operación real.
UPDATE public.compliance_requirements
SET has_expiration = true
WHERE (target_entity, requirement_code) IN (
    ('ASSET',   'SOAP'),                    -- anual
    ('ASSET',   'PERMISO_CIRCULACION'),     -- anual (marzo)
    ('ASSET',   'REVISION_TECNICA'),
    ('ASSET',   'GASES_CONTAMINANTES'),
    ('DRIVER',  'LICENCIA_CONDUCIR'),
    ('DRIVER',  'COPIA_CI_CONDUCTOR'),      -- la cédula tiene fecha de vencimiento
    ('CARRIER', 'COPIA_CI_REPLEGAL'),
    ('CARRIER', 'F30_MULTAS')               -- certificado con vigencia acotada
);

-- ── GRUPO 2: por vigencia legal — VALIDAR CON NEGOCIO ───────────────────────
UPDATE public.compliance_requirements
SET has_expiration = true
WHERE (target_entity, requirement_code) IN (
    ('CARRIER', 'F43'),                     -- mismo régimen que el F30
    ('CARRIER', 'CARPETA_TRIBUTARIA'),      -- se emite con vigencia
    ('CARRIER', 'CERT_MUTUAL'),             -- certificado de afiliación vigente
    ('CARRIER', 'SEGURO_RC_EMPRESA'),
    ('CARRIER', 'SEGURO_EETT'),
    ('DRIVER',  'CERT_ANTECEDENTES'),       -- vigencia típica de 30-90 días
    ('DRIVER',  'HOJA_DE_VIDA'),            -- hoja de vida del conductor
    ('DRIVER',  'CONTROL_MENSUAL_COL_T'),   -- el nombre ya dice que es mensual
    ('ASSET',   'POLIZA_RC'),
    ('ASSET',   'RESOLUCION_SANITARIA'),
    ('ASSET',   'MANTENCION_FRIO')          -- mantención periódica
);

COMMIT;
