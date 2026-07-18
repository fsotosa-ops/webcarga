-- Sexta y última ronda de limpieza (2026-07-18). Auditoría profunda a
-- pedido del usuario tras corregir su propia instrucción inicial: no
-- alcanza con grep de código, hay que descartar triggers/funciones/RPC
-- que puedan conectar estas tablas al sistema vivo antes de dropear.
--
-- Resultado de la auditoría (ver memoria project_db_cleanup_audit_2026_07):
--   - Triggers: solo set_updated_at (housekeeping genérico) en las 6, más
--     un audit_insurance_installment_change en insurance_installments que
--     está ROTO — escribe a app.audit_log, tabla que ya no existe (solo
--     existe public.audit_log, la que sí usa el sistema vivo).
--   - Cero funciones en cualquier schema referencian estas tablas fuera de
--     sus propios triggers.
--   - Cero llamadas .rpc() en todo el backend/frontend a esas funciones.
--   - Todas las FK entrantes son internas al cluster mismo — nada de
--     public.* ni del resto de app.* apunta hacia acá.
--
-- Conclusión: cluster completamente aislado del sistema vivo
-- (frontend+backend+dbt+Mage). La única actividad real era un deployment
-- legacy externo a este repo — el usuario confirmó que ya no es un
-- problema (lo apaga/ya lo apagó) y autorizó el DROP definitivo.
--
-- Ver memoria: project_db_cleanup_audit_2026_07.

BEGIN;

DROP TABLE IF EXISTS app.transporter_contacts;
DROP TABLE IF EXISTS app.insurance_installments;
DROP TABLE IF EXISTS app.insurance_policies;
DROP TABLE IF EXISTS app.drivers;
DROP TABLE IF EXISTS app.vehicles;
DROP TABLE IF EXISTS app.transporters;

COMMIT;
