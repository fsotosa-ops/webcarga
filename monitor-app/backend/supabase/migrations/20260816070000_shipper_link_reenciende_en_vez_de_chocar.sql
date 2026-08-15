-- Tramo 3, cierre del círculo: `reconcile_carrier_shipper_link()` es la ÚNICA
-- de las cinco vías de siembra que apaga registros Y puede volver a
-- dispararse sobre la misma entidad (su trigger es AFTER INSERT OR UPDATE
-- sobre public.carrier_shippers). Las otras cuatro, o tienen ON CONFLICT, o
-- son AFTER INSERT sobre una fila que se inserta una sola vez.
--
-- EL BUG (reproducido contra la base real, 2026-08-15, en transacción
-- revertida): desactivar un vínculo empresa-cliente apaga los registros de
-- ese cliente (is_current = false, rama ELSIF de abajo). Al reactivarlo, la
-- rama de INSERT sólo mira `NOT EXISTS (... AND cr.is_current = true)`, así
-- que la fila apagada no la ve, intenta insertar una nueva y choca:
--
--   23505 duplicate key value violates unique constraint
--   "compliance_records_entity_id_requirement_id_key"
--
-- El índice único (entity_id, requirement_id) es TOTAL, no parcial: la fila
-- apagada sigue ocupando el lugar. O sea que reactivar un vínculo que alguna
-- vez se desactivó reventaba con un 500, y volver a exigir el documento era
-- imposible sin tocar la base a mano.
--
-- Ya era alcanzable antes de este tramo (la misma función es la que apaga),
-- pero el recálculo reversible lo alimenta a escala: desde que
-- POST /compliance-requirements/{id}/recalc apaga en vez de borrar, cualquier
-- recálculo deja registros apagados que después chocan acá.
--
-- EL ARREGLO: la misma decisión que ya toma el endpoint —
-- `ON CONFLICT (entity_id, requirement_id) DO UPDATE SET is_current = true`.
-- Toca SÓLO el interruptor. No se tocan `status`, `file_url`, `metadata` ni
-- `expiration_date`: un registro apagado puede tener documento cargado (esta
-- misma función lo apaga sin mirar D13 — sólo respeta is_manual_override), y
-- resucitarlo pisándole el archivo sería destruir trabajo real. Tampoco se
-- toca `updated_at`, que alimenta `last_document_update` en la lista de
-- empresas: volver a exigir un requisito no es haber actualizado un
-- documento.
--
-- POR QUÉ SE CONSERVA EL `NOT EXISTS`: con el ON CONFLICT, el predicado deja
-- de ser necesario para la CORRECCIÓN — el estado final es idéntico con o sin
-- él (si la fila ya está vigente, el DO UPDATE le escribiría `true` sobre
-- `true`). Pero no es redundante en EFECTO: sin el predicado, cada
-- reactivación de un vínculo reescribe todas las filas que ya estaban
-- vigentes, con su lock de fila y su tupla muerta por cada una, y esos locks
-- pueden trabarse contra una carga de documento concurrente sobre el mismo
-- registro. Se queda, entonces, con los dos leyéndose como lo que son: el
-- NOT EXISTS decide qué falta sembrar, y el ON CONFLICT es la red para el
-- único caso que ese predicado no puede ver — la fila dormida.
--
-- NO SE TOCA `reconcile_new_requirement()`, que tiene el mismo NOT EXISTS sin
-- ON CONFLICT: su trigger es AFTER INSERT sobre public.compliance_requirements,
-- o sea que el requirement_id es nuevo y no puede haber filas previas contra
-- las cuales chocar. Queda anotado como no alcanzable HOY; lo sería si alguien
-- pasara ese trigger a AFTER INSERT OR UPDATE.
--
-- Se parte de la definición VIVA de la función (la que dejó
-- 20260816050000_carrier_management_types_single_definition.sql, que lee
-- public.carrier_management_types(NEW.carrier_id) y ya no une contra
-- public.carriers), no del texto de 20260816040000 — reescribirla desde ese
-- archivo habría revertido en silencio el arreglo del defecto C1.

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
        -- La fila apagada sigue ocupando el lugar en el índice único TOTAL:
        -- se la vuelve a encender en vez de chocar contra ella. Sólo el
        -- interruptor — el documento, el estado y la vigencia se conservan.
        ON CONFLICT (entity_id, requirement_id) DO UPDATE SET
            is_current = true;
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
