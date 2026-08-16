-- Hallazgo de /code-review sobre 20260816070000: el `ON CONFLICT DO UPDATE`
-- que agregó esa migración no lleva `WHERE`, así que reescribe `true` sobre
-- `true` en las filas que ya estaban vigentes.
--
-- Es el MISMO defecto que se corrigió del lado de la API
-- (app/routers/requirements.py, el recálculo), y es el espejo del `AND
-- is_current` que la rama de apagado de esta misma función lleva a propósito:
-- la guarda se puso en un lado y no en el otro.
--
-- Acá el impacto es menor que en el recálculo, porque el `NOT EXISTS` de la
-- propia sentencia ya filtra las filas vigentes bajo su instantánea. El
-- reescritura vacía sólo ocurre en la carrera que el `ON CONFLICT` existe para
-- atrapar: dos transacciones concurrentes reactivando vínculos de la misma
-- empresa. Pero cuando ocurre, es exactamente el "lock de fila y tupla muerta
-- sin cambiar ningún valor" contra el que argumenta el comentario de
-- 20260816070000 al explicar por qué se conserva el `NOT EXISTS`. Sin este
-- WHERE, ese argumento vale sólo en el caso común y no siempre.
--
-- `is_current` es NOT NULL desde 20260816060000, así que `NOT is_current` no
-- cae en lógica de tres valores.
--
-- Se parte de la definición VIVA (pg_get_functiondef), no del texto de un
-- archivo: 20260816050000 dejó la llamada a public.carrier_management_types()
-- y reescribir desde 20260816040000 la revertiría en silencio.

CREATE OR REPLACE FUNCTION public.reconcile_carrier_shipper_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF TG_OP = 'INSERT' OR (NEW.status = 'ACTIVE' AND OLD.status IS DISTINCT FROM 'ACTIVE') THEN
        INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
        SELECT NEW.carrier_id, 'CARRIER', req.id, 'MISSING', true
        FROM public.compliance_requirements req
        WHERE req.target_entity = 'CARRIER' AND req.shipper_id = NEW.shipper_id
          AND req.is_active
          AND (req.applies_to_management_types IS NULL
               OR public.carrier_management_types(NEW.carrier_id) && req.applies_to_management_types)
          AND NOT EXISTS (
            SELECT 1 FROM public.compliance_records cr
            WHERE cr.entity_id = NEW.carrier_id AND cr.requirement_id = req.id AND cr.is_current = true
          )
        -- La fila apagada sigue ocupando el lugar en el índice único TOTAL: se
        -- la vuelve a encender en vez de chocar contra ella. Sólo el
        -- interruptor — el documento, el estado y la vigencia se conservan.
        -- El WHERE hace que encender sea idempotente, igual que apagar: sin él
        -- una fila ya vigente se reescribiría consigo misma.
        ON CONFLICT (entity_id, requirement_id) DO UPDATE SET
            is_current = true
        WHERE NOT public.compliance_records.is_current;
    ELSIF TG_OP = 'UPDATE' AND NEW.status <> 'ACTIVE' AND OLD.status = 'ACTIVE' THEN
        UPDATE public.compliance_records cr
        SET is_current = false
        FROM public.compliance_requirements req
        WHERE cr.entity_id = NEW.carrier_id AND cr.requirement_id = req.id
          AND req.target_entity = 'CARRIER' AND req.shipper_id = NEW.shipper_id
          AND cr.is_current = true
          AND NOT cr.is_manual_override;
    END IF;
    RETURN NEW;
END;
$function$;
