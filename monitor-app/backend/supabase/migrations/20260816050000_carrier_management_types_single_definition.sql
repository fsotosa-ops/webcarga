-- Tramo 3, arreglo C1: UNA sola definicion de "tipo de gestion de una empresa".
--
-- El modulo tenia dos definiciones del mismo concepto, y una se mostraba
-- mientras la otra se aplicaba:
--
--   * Lo que la pantalla de Certificacion MUESTRA sale de
--     COALESCE(gestion derivada de la flota, gestion declarada)
--     (app/routers/compliance.py, CTE `gestion` + COALESCE del embudo).
--   * Lo que la condicion nueva EVALUABA era solo public.carriers.management_types,
--     la columna declarada.
--
-- Medido contra produccion sobre las empresas activas: 39 en total, 36 con
-- gestion derivada de su flota, 0 con gestion declarada. La columna declarada
-- se agrego en 20260815160000 y solo la puebla el alta de empresas nuevas;
-- ninguna migracion la relleno. Como `NULL && ARRAY['TRACTOREO']` da NULL (no
-- false, pero el WHERE lo trata igual), marcar cualquier tipo de gestion en un
-- requisito de empresa dejaba el conjunto de entidades que aplican VACIO, y
-- entonces todos sus registros vigentes pasaban a "quitar". Simulado sobre
-- datos reales: CARPETA_TRIBUTARIA con TRACTOREO marcado daba se_borrarian=247.
-- Hay 15 requisitos de empresa, o sea 15 puertas al mismo resultado, y el
-- DELETE es fisico sobre una tabla sin historial.
--
-- La definicion unica es la que ya se muestra hoy: LA FLOTA MANDA CUANDO
-- EXISTE, LO DECLARADO CUBRE EL HUECO. Se escribe una sola vez, en
-- public.carrier_management_types(), y la llaman los tres lados: lo que se
-- muestra, lo que siembra y lo que calcula la vista previa.
--
-- Por que no se poblo carriers.management_types a mano: seria una
-- desnormalizacion sin dueno. Habria que mantenerla sincronizada con la flota
-- para siempre, y el dia que se desincronizara nadie sabria cual de las dos
-- manda. La columna declarada conserva su razon de ser original -- al crear una
-- empresa todavia no tiene vehiculos, asi que es el unico dato disponible en
-- ese momento. Con el COALESCE las dos conviven sin competir.

-- ── La definicion, UNA vez ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.carrier_management_types(p_carrier_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    -- La flota manda cuando existe; lo declarado cubre el hueco.
    --
    -- Se devuelven CODIGOS, no las etiquetas del catalogo, porque es el
    -- vocabulario de public.carriers.management_types y de
    -- public.compliance_requirements.applies_to_management_types (el CHECK de
    -- 20260816000000 los limita a TRACTOREO / EQUIPO_COMPLETO). El mapeo
    -- etiqueta -> codigo estaba escrito en app/routers/compliance.py y ahora
    -- vive aca: un renombre de etiqueta -- hubo dos en dos dias -- se arregla
    -- en UN lugar.
    --
    -- array_agg(...) FILTER (...) sobre cero filas devuelve NULL, no un arreglo
    -- vacio: por eso el COALESCE cae a lo declarado tanto cuando la empresa no
    -- tiene vehiculos activos como cuando los tiene sin Tipo de Operacion
    -- clasificado. Es exactamente lo que hace hoy el LEFT JOIN de la pantalla.
    SELECT COALESCE(
        (
            SELECT array_agg(DISTINCT CASE t.label
                       WHEN 'Tractoreo'       THEN 'TRACTOREO'
                       WHEN 'Equipo Completo' THEN 'EQUIPO_COMPLETO'
                   END) FILTER (WHERE t.label IN ('Tractoreo', 'Equipo Completo'))
            FROM public.asset_assignments aa
            JOIN public.assets a ON a.id = aa.asset_id
            JOIN app.status_taxonomies t ON t.id = a.webcarga_operation_type_id
            WHERE aa.carrier_id = p_carrier_id AND aa.status = 'ACTIVE'
        ),
        (SELECT c.management_types FROM public.carriers c WHERE c.id = p_carrier_id)
    );
$function$;

COMMENT ON FUNCTION public.carrier_management_types(uuid) IS
    'Tipo de gestion de una empresa, en codigos (TRACTOREO / EQUIPO_COMPLETO). La flota manda cuando existe (asset_assignments ACTIVE -> assets.webcarga_operation_type_id), lo declarado (carriers.management_types) cubre el hueco. UNICA definicion del concepto: la llaman las cuatro ramas CARRIER de siembra (reconcile_new_carrier, reconcile_carrier_shipper_link, las dos de reconcile_new_requirement), la vista previa del recalcular (app/services/requirement_conditions.py, SQL_ENTIDADES_QUE_APLICAN["CARRIER"]) y la pantalla de Certificacion (app/routers/compliance.py). Si cambia esta funcion, cambian los tres lados a la vez -- ese es el punto.';

-- ── Las vias de siembra CARRIER pasan a leerla ────────────────────────────
-- Coherencia en el momento del alta: trg_reconcile_new_carrier es AFTER INSERT
-- (verificado en pg_trigger), asi que la fila de carriers ya es visible cuando
-- corre esto y la empresa todavia no tiene vehiculos asignados. La parte
-- derivada da NULL y el COALESCE cae en la declarada -- que es exactamente lo
-- que acaba de guardar POST /carriers. Misma expresion, distinto dato segun el
-- momento.
CREATE OR REPLACE FUNCTION public.reconcile_new_carrier()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    -- shipper_id IS NULL se conserva: los requisitos de un cliente puntual los
    -- siembra trg_reconcile_carrier_shipper cuando se crea la relación, que una
    -- empresa recién creada todavía no tiene.
    INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
    SELECT NEW.id, 'CARRIER', req.id, 'MISSING', true
    FROM public.compliance_requirements req
    WHERE req.target_entity = 'CARRIER'
      AND req.is_active
      AND req.shipper_id IS NULL
      AND (req.applies_to_management_types IS NULL
           OR public.carrier_management_types(NEW.id) && req.applies_to_management_types)
    ON CONFLICT (entity_id, requirement_id) DO NOTHING;
    RETURN NEW;
END;
$function$;

-- Se saca el JOIN a public.carriers que 20260816040000 habia agregado solo
-- para poder leer c.management_types: la funcion hace esa lectura adentro.
-- carrier_shippers.carrier_id tiene FK a carriers ON DELETE CASCADE, asi que
-- el JOIN nunca filtraba nada -- no era un guardia, era una via de acceso.
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
          );
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

-- Las dos ramas CARRIER. La rama de cliente puntual pierde tambien su JOIN a
-- public.carriers, por la misma razon que arriba.
CREATE OR REPLACE FUNCTION public.reconcile_new_requirement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF NOT NEW.is_active THEN
        RETURN NEW;
    END IF;

    IF NEW.target_entity = 'CARRIER' THEN
        IF NEW.shipper_id IS NULL THEN
            INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
            SELECT c.id, 'CARRIER', NEW.id, 'MISSING', true
            FROM public.carriers c
            WHERE (NEW.applies_to_management_types IS NULL
                   OR public.carrier_management_types(c.id) && NEW.applies_to_management_types)
              AND NOT EXISTS (
                SELECT 1 FROM public.compliance_records cr
                WHERE cr.entity_id = c.id AND cr.requirement_id = NEW.id AND cr.is_current = true
            );
        ELSE
            INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
            SELECT cs.carrier_id, 'CARRIER', NEW.id, 'MISSING', true
            FROM public.carrier_shippers cs
            WHERE cs.shipper_id = NEW.shipper_id AND cs.status = 'ACTIVE'
              AND (NEW.applies_to_management_types IS NULL
                   OR public.carrier_management_types(cs.carrier_id) && NEW.applies_to_management_types)
              AND NOT EXISTS (
                SELECT 1 FROM public.compliance_records cr
                WHERE cr.entity_id = cs.carrier_id AND cr.requirement_id = NEW.id AND cr.is_current = true
              );
        END IF;
    ELSIF NEW.target_entity = 'DRIVER' THEN
        -- Un conductor no tiene subtipo ni gestión propios: sólo lo filtra is_active (arriba).
        INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
        SELECT d.id, 'DRIVER', NEW.id, 'MISSING', true
        FROM public.drivers d
        WHERE NOT EXISTS (
            SELECT 1 FROM public.compliance_records cr
            WHERE cr.entity_id = d.id AND cr.requirement_id = NEW.id AND cr.is_current = true
        );
    ELSIF NEW.target_entity = 'ASSET' THEN
        INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
        SELECT a.id, 'ASSET', NEW.id, 'MISSING', true
        FROM public.assets a
        WHERE (NEW.applies_to_fleet_service_type_ids IS NULL
               OR a.fleet_service_type_id = ANY(NEW.applies_to_fleet_service_type_ids))
          AND NOT EXISTS (
            SELECT 1 FROM public.compliance_records cr
            WHERE cr.entity_id = a.id AND cr.requirement_id = NEW.id AND cr.is_current = true
        );
    END IF;

    RETURN NEW;
END;
$function$;
