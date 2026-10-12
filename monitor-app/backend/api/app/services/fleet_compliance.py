"""La regla documental de quien debe documentos, en un solo lugar (spec
2026-10-12-directory-d1-one-answer-design.md §5).

`vencimientos.py` es el dueño del vocabulario por registro (estado, alcance,
exigibilidad). Este módulo es el dueño de los agregados: el resumen por entidad
y por empresa, la habilitación (`can_operate`) y el aviso por documento. Lo
leen Directorio, vista rápida, embudo de Certificación y Monitor; ninguno lo
recalcula.

La base es la de Pendientes (`pending_base_ctes`, mudada sin cambios desde
routers/compliance.py): así las cifras de una empresa activa son, por
construcción, las de su fila en /pending/summary?group_by=carrier.

Las dos CTE de resumen son autocontenidas (llevan su propio WITH adentro): se
pueden componer juntas, o con `pending_base_ctes`, en una misma consulta sin
chocar por el nombre `pending`. No usan parámetros ($n): quien las compone no
renumera nada."""
from __future__ import annotations

from typing import Any, Mapping

from ..schemas.states import BLOCKING_STATES, SEVERITY_ORDER, ComplianceSummary, StateCounts
from .vencimientos import (
    PENDING_STATES,
    cubierto_predicate,
    document_state_sql,
    exigible_sql,
    hoy_sql,
    in_scope_sql,
    ingreso_sql,
    pendiente_predicate,
    por_vencer_predicate,
    ultima_empresa_sql,
    vence_el_sql,
    vencido_predicate,
)


def _empresa_que_dejo_sql(alias: str) -> str:
    """La empresa de un documento "al término" (exigible_on = ON_ENTITY_END):
    el conductor ya no tiene asignación ACTIVE, así que se le atribuye a la
    última que tuvo, con la MISMA definición de "última" que su alcance
    (ultima_empresa_sql). Solo para ese tipo: el resto de los documentos de un
    conductor sin empresa siguen sin empresa, como antes."""
    return (
        f"(CASE WHEN {alias}.requirement_id IN (SELECT vg_t.id FROM public.compliance_requirements vg_t "
        f"WHERE vg_t.exigible_on = 'ON_ENTITY_END') "
        f"THEN {ultima_empresa_sql(alias, 'DRIVER')} END)"
    )


def pending_base_ctes(estado_param: str) -> str:
    """Las CTE `pending` y `resolved` de Pendientes, una sola vez. Las usan
    la lista (/pending) y el resumen (/pending/summary): si cada uno las
    escribiera, las cifras de la izquierda y la lista de la derecha podrían
    dejar de coincidir. `estado_param` es el placeholder del filtro viejo
    (`estado`), que cada consulta numera a su manera."""
    return f"""
pending AS (
    SELECT cr.id, cr.entity_type, cr.entity_id, cr.status, cr.expiration_date,
           -- Las lee la urgencia de abajo (`pendiente_predicate('r')`): el
           -- predicado calcula el vencimiento con ellas (contrato del alias en
           -- services/vencimientos.py). `resolved` las hereda por `p.*`.
           cr.issue_date, cr.period_start,
           -- El vencimiento calculado (HU-C1, entrega 2b): lo que la pantalla
           -- muestra en vez de la fecha suelta.
           {vence_el_sql('cr')} AS vence_calculado,
           -- Un documento "a pedido" existe porque alguien lo solicitó: la
           -- ficha ofrece quitar la solicitud mientras no tenga archivo.
           req.exigible_on = 'ON_REQUEST' AS a_pedido,
           -- El HECHO de si hay un archivo, para que la pantalla deje de
           -- deducirlo del estado. `status IN ('MISSING','EXPIRED')` se venia
           -- usando como si significara "no tiene archivo", y significa dos
           -- cosas distintas: un 'EXPIRED' SI tiene archivo —vencio porque
           -- alguien lo subio— y un 'REJECTED' puede no tenerlo. Con la
           -- deduccion, la ficha escondia el documento cargado de todo lo
           -- vencido, que es justo lo que esa pantalla vino a hacer visible.
           cr.file_url IS NOT NULL AS tiene_archivo,
           req.id AS requirement_id, req.target_entity,
           req.requirement_code, req.name AS document_name, req.requirement_level,
           req.expiration_policy,
           -- La definición única (services/vencimientos.py, spec 2026-10-11).
           {document_state_sql('cr')} AS document_state,
           {in_scope_sql('cr')} AS in_scope,
           -- Desde cuándo está quien lo debe ("Falta · Ingresó hace N días").
           {ingreso_sql('cr')} AS entered_on
    FROM public.compliance_records cr
    JOIN public.compliance_requirements req ON req.id = cr.requirement_id
    WHERE cr.is_current = true
      -- El estado deja de estar incrustado. `falta` es el default y reproduce
      -- exactamente el predicado anterior, para que ningun llamador actual
      -- cambie de comportamiento. `todos` es lo que hace posible la ficha:
      -- ver lo que la empresa TIENE y no solo lo que le falta.
      AND CASE {estado_param}::text
            WHEN 'todos'      THEN true
            WHEN 'por_vencer' THEN {exigible_sql('cr')} AND {por_vencer_predicate('cr')}
            WHEN 'al_dia'     THEN {cubierto_predicate('cr')}
            ELSE {pendiente_predicate('cr')}
          END
),
resolved AS (
    SELECT p.*,
        CASE p.entity_type
            WHEN 'CARRIER' THEN p.entity_id
            -- Un documento "al término" (finiquito) es de la empresa que el
            -- conductor dejó: sin asignación ACTIVE, la última que tuvo.
            WHEN 'DRIVER'  THEN COALESCE(da.carrier_id, {_empresa_que_dejo_sql('p')})
            WHEN 'ASSET'   THEN aa.carrier_id
        END AS resolved_carrier_id,
        CASE p.entity_type
            WHEN 'DRIVER' THEN d.full_name
            WHEN 'ASSET'  THEN a.license_plate
            ELSE NULL
        END AS subject_name,
        -- Que ES el vehiculo, no solo su patente. Son dos datos distintos y
        -- ninguno reemplaza al otro: `asset_type` esta SIEMPRE (124 de 124
        -- vehiculos: 87 TRACTOCAMION, 37 RAMPLA) y dice el chasis;
        -- `fleet_service_type_id` es el subtipo de carroceria y solo lo tienen
        -- las ramplas (36 de 37; los 87 tractocamiones lo tienen en NULL).
        -- Por eso viajan los dos y la pantalla dibuja uno o dos badges segun
        -- lo que haya, en vez de elegir un campo y mentir cuando falta.
        --
        -- Nulos para CARRIER y DRIVER por construccion: el LEFT JOIN a
        -- `public.assets` ya solo matchea cuando entity_type = 'ASSET'.
        a.asset_type,
        fst.label      AS fleet_service_type_label,
        fst.bg_color   AS fleet_service_type_bg_color,
        fst.text_color AS fleet_service_type_text_color
    FROM pending p
    LEFT JOIN public.driver_assignments da
        ON p.entity_type = 'DRIVER' AND da.driver_id = p.entity_id AND da.status = 'ACTIVE'
    LEFT JOIN public.asset_assignments aa
        ON p.entity_type = 'ASSET' AND aa.asset_id = p.entity_id AND aa.status = 'ACTIVE'
    LEFT JOIN public.drivers d ON p.entity_type = 'DRIVER' AND d.id = p.entity_id
    LEFT JOIN public.assets a ON p.entity_type = 'ASSET' AND a.id = p.entity_id
    -- Los colores salen del catalogo, no del frontend: `app.status_taxonomies`
    -- ya trae bg_color/text_color por fila y es lo que ya leen las otras
    -- pantallas de flota (assets.py, equipment_closures.py, status_report.py).
    LEFT JOIN app.status_taxonomies fst ON fst.id = a.fleet_service_type_id
)"""
