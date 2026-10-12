-- D1 "Una sola respuesta", despliegue 3 (D1-R4, ruling R-E11).
--
-- Configuración › Alertas de vencimiento tenía una fila por documento que no
-- leía ninguna lógica: solo se lee la global `documento_por_vencer`
-- (services/vencimientos.py, fleet_compliance.alert_severity_sql). Desde el
-- despliegue 2 la pantalla y la API ya no las muestran ni las dejan editar, y
-- desde el despliegue 3 /trips/meta ya no las devuelve. Aquí se borran,
-- guardando antes cada fila en audit_log para poder restaurarla.
--
-- audit_log.entity_id es uuid NOT NULL y la PK de alert_thresholds es texto:
-- el id es md5('app.alert_thresholds:' || doc_type)::uuid (determinístico,
-- se recalcula desde la clave). doc_code guarda la clave legible.
-- audit_log.id es GENERATED ALWAYS AS IDENTITY: no se nombra.
--
-- Re-ejecutable: la copia y el borrado son UNA sentencia; en la segunda
-- corrida no hay filas que borrar y no se copia nada.
-- Sin triggers ni REFRESH.

WITH retiradas AS (
    DELETE FROM app.alert_thresholds
    WHERE doc_type <> 'documento_por_vencer'
    RETURNING *
)
INSERT INTO public.audit_log (actor, entity_type, entity_id, action, field, old_value, new_value, source, doc_code)
SELECT NULL,
       'ALERT_THRESHOLD',
       md5('app.alert_thresholds:' || r.doc_type)::uuid,
       'delete',
       NULL,
       to_jsonb(r),
       NULL,
       'migration',
       r.doc_type
FROM retiradas r;

COMMENT ON TABLE app.alert_thresholds IS
  'Una sola fila: documento_por_vencer (aviso = warning_days, crítico = error_days). La leen '
  'services/vencimientos.py y services/fleet_compliance.py. Las filas por documento se retiraron '
  'el despliegue 3 de D1; su copia está en public.audit_log (entity_type = ''ALERT_THRESHOLD'').';
