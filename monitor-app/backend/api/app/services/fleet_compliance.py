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

from ..schemas.states import (
    BLOCKING_STATES, CARRIER_STATUSES_IN_CERTIFICATION, SEVERITY_ORDER, BlockingCounts, ComplianceSummary,
    FunnelBucket, StateCounts,
)
from .vencimientos import (
    PENDING_STATES,
    cubierto_predicate,
    document_state_sql,
    exigible_sql,
    hoy_sql,
    in_scope_sql,
    ingreso_sql,
    pendiente_predicate,
    GLOBAL_ALERT_THRESHOLD,
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
           -- Las lee el estado de abajo (`pendiente_predicate('r')`): el
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
        fst.label      AS fleet_service_type_label
    FROM pending p
    LEFT JOIN public.driver_assignments da
        ON p.entity_type = 'DRIVER' AND da.driver_id = p.entity_id AND da.status = 'ACTIVE'
    LEFT JOIN public.asset_assignments aa
        ON p.entity_type = 'ASSET' AND aa.asset_id = p.entity_id AND aa.status = 'ACTIVE'
    LEFT JOIN public.drivers d ON p.entity_type = 'DRIVER' AND d.id = p.entity_id
    LEFT JOIN public.assets a ON p.entity_type = 'ASSET' AND a.id = p.entity_id
    -- La etiqueta del subtipo sale del catalogo; el color no: un subtipo se ve
    -- neutro (Configuracion, Parte 1).
    LEFT JOIN app.status_taxonomies fst ON fst.id = a.fleet_service_type_id
)"""


# ── El resumen de quien debe documentos ──────────────────────────────────────

def _lista(estados: tuple[str, ...]) -> str:
    return ", ".join(f"'{e}'" for e in estados)


_PENDIENTES = _lista(PENDING_STATES)
_BLOQUEAN = _lista(BLOCKING_STATES)


def _peor_estado(alias: str) -> str:
    """El peor estado de los OBLIGATORIOS del grupo (spec §3; ruling A-R5), en
    el orden de SEVERITY_ORDER. Un opcional pendiente cuenta en las cifras pero
    no empeora el resumen. Sin filas (una empresa sin pendientes, unida con LEFT
    JOIN) o solo con opcionales, cae a UP_TO_DATE."""
    ramas = " ".join(
        f"WHEN bool_or({alias}.document_state = '{e}' AND {alias}.requirement_level = 'LEGAL_MANDATORY') "
        f"THEN '{e}'"
        for e in SEVERITY_ORDER if e != "UP_TO_DATE")
    return f"(CASE {ramas} ELSE 'UP_TO_DATE' END)"


def _cifra(estado: str, condicion: str = "true") -> str:
    return f"(count(*) FILTER (WHERE o.document_state = '{estado}' AND {condicion}))::int"


def entity_compliance_cte() -> str:
    """CTE `entity_compliance`: por entidad (empresa, conductor o equipo), lo
    suyo que está pendiente. Una fila solo por entidad con algo pendiente: quien
    la lee hace LEFT JOIN y `summary_from_row` vuelve los NULL a 0.

    Sin alcance a propósito: es lo que la entidad debe, esté activa o no (la
    ficha de una entidad de baja muestra su historial). Para la flota activa de
    una empresa activa coincide con el alcance de Pendientes."""
    return f"""entity_compliance AS (
    WITH {pending_base_ctes("'falta'")}
    SELECT o.entity_type::text AS entity_type, o.entity_id,
           {_peor_estado('o')} AS worst_state,
           {_cifra('OVERDUE')} AS overdue,
           {_cifra('EXPIRING')} AS expiring,
           {_cifra('MISSING')} AS missing,
           (count(*) FILTER (WHERE o.requirement_level = 'LEGAL_MANDATORY'
                               AND o.document_state IN ({_BLOQUEAN})))::int AS blocking_mandatory
    FROM pending o
    WHERE o.document_state IN ({_PENDIENTES})
    GROUP BY o.entity_type, o.entity_id
)"""


# Las empresas cuya carpeta se trabaja (activas y en onboarding), como lista SQL: la
# definición vive en el glosario (schemas/states.py).
_EN_CERTIFICACION = ", ".join(f"'{s}'" for s in CARRIER_STATUSES_IN_CERTIFICATION)


def carrier_compliance_cte() -> str:
    """CTE `carrier_compliance`: una fila por CADA empresa (también las que no
    deben nada), con lo propio, lo de su flota y la habilitación.

    Alcance de las cifras (21/10: un camino por grupo, no por estado):
      - empresa en certificación (activa o en onboarding,
        CARRIER_STATUSES_IN_CERTIFICATION): el de Pendientes (in_scope, empresa
        atribuida = resolved_carrier_id), con lo que bloquea marcado. Por eso sus
        cifras son las de su fila en /pending/summary?group_by=carrier, y una en
        onboarding se mide con la misma regla que una que opera;
      - empresa dada de baja (ruling D1-R1): sus registros más los de su
        app.active_fleet, como historial: nada bloquea.

    worst_state: el peor de los obligatorios (A-R5); las cifras cuentan todo.

    `requirements_met`: sin ningún LEGAL_MANDATORY vencido o faltante, propio o de
    app.active_fleet, en una empresa en certificación. Habilitación (`can_operate`):
    eso y además ACTIVE. Para activar una en onboarding se pide `requirements_met`. Por vencer no bloquea; los opcionales no bloquean pero
    cuentan en las cifras. Un documento al término de quien ya se fue cuenta en
    la flota (Pendientes lo muestra) pero no bloquea: no es flota activa."""
    return f"""carrier_compliance AS (
    WITH {pending_base_ctes("'falta'")},
    owed AS (
        SELECT r.resolved_carrier_id AS carrier_id, r.entity_type, r.document_state, r.requirement_level,
               (r.requirement_level = 'LEGAL_MANDATORY' AND r.document_state IN ({_BLOQUEAN})
                AND (r.entity_type = 'CARRIER' OR af.entity_id IS NOT NULL)) AS blocks
        FROM resolved r
        JOIN public.carriers c ON c.id = r.resolved_carrier_id AND c.operational_status IN ({_EN_CERTIFICACION})
        LEFT JOIN app.active_fleet af
               ON af.carrier_id = r.resolved_carrier_id AND af.entity_type = r.entity_type
              AND af.entity_id = r.entity_id
        WHERE r.in_scope AND r.document_state IN ({_PENDIENTES})
        UNION ALL
        SELECT c.id, r.entity_type, r.document_state, r.requirement_level, false
        FROM resolved r
        JOIN public.carriers c
          ON r.entity_type = 'CARRIER' AND c.id = r.entity_id AND c.operational_status NOT IN ({_EN_CERTIFICACION})
        WHERE r.document_state IN ({_PENDIENTES})
        UNION ALL
        SELECT af.carrier_id, r.entity_type, r.document_state, r.requirement_level, false
        FROM resolved r
        JOIN app.active_fleet af ON af.entity_type = r.entity_type AND af.entity_id = r.entity_id
        JOIN public.carriers c ON c.id = af.carrier_id AND c.operational_status NOT IN ({_EN_CERTIFICACION})
        WHERE r.document_state IN ({_PENDIENTES})
    )
    SELECT c.id AS carrier_id,
           {_peor_estado('o')} AS worst_state,
           {_cifra('OVERDUE', "o.entity_type = 'CARRIER'")} AS own_overdue,
           {_cifra('EXPIRING', "o.entity_type = 'CARRIER'")} AS own_expiring,
           {_cifra('MISSING', "o.entity_type = 'CARRIER'")} AS own_missing,
           {_cifra('OVERDUE', "o.entity_type <> 'CARRIER'")} AS fleet_overdue,
           {_cifra('EXPIRING', "o.entity_type <> 'CARRIER'")} AS fleet_expiring,
           {_cifra('MISSING', "o.entity_type <> 'CARRIER'")} AS fleet_missing,
           (c.operational_status = 'ACTIVE' AND NOT COALESCE(bool_or(o.blocks), false)) AS can_operate,
           (c.operational_status IN ({_EN_CERTIFICACION}) AND NOT COALESCE(bool_or(o.blocks), false))
               AS requirements_met,
           count(*) FILTER (WHERE o.blocks AND o.entity_type = 'CARRIER') AS blocking_own,
           count(*) FILTER (WHERE o.blocks AND o.entity_type <> 'CARRIER') AS blocking_fleet
    FROM public.carriers c
    LEFT JOIN owed o ON o.carrier_id = c.id
    GROUP BY c.id, c.operational_status
)"""


def _n(row: Mapping[str, Any], clave: str) -> int:
    valor = row[clave]
    return 0 if valor is None else int(valor)


def summary_from_row(row: Mapping[str, Any], *, with_fleet: bool) -> ComplianceSummary:
    """El modelo del contrato desde una fila de `carrier_compliance`
    (with_fleet=True) o de `entity_compliance` (with_fleet=False). Un NULL en las
    cifras vale 0 y un worst_state NULL vale UP_TO_DATE: es la fila de quien no
    debe nada, unida con LEFT JOIN.

    Una fila de entidad no trae la habilitación hecha: la arma con
    `blocking_mandatory` y el `operational_status` de la entidad, que el lector
    tiene que seleccionar (si falta, KeyError: mejor que inventar "activa")."""
    worst = row["worst_state"] or "UP_TO_DATE"
    if with_fleet:
        return ComplianceSummary(
            worst_state=worst,
            own=StateCounts(overdue=_n(row, "own_overdue"), expiring=_n(row, "own_expiring"),
                            missing=_n(row, "own_missing")),
            fleet=StateCounts(overdue=_n(row, "fleet_overdue"), expiring=_n(row, "fleet_expiring"),
                              missing=_n(row, "fleet_missing")),
            can_operate=bool(row["can_operate"]),
            blocking=BlockingCounts(own=_n(row, "blocking_own"), fleet=_n(row, "blocking_fleet")),
            requirements_met=bool(row["requirements_met"]),
        )
    return ComplianceSummary(
        worst_state=worst,
        own=StateCounts(overdue=_n(row, "overdue"), expiring=_n(row, "expiring"), missing=_n(row, "missing")),
        fleet=None,
        can_operate=row["operational_status"] == "ACTIVE" and _n(row, "blocking_mandatory") == 0,
        blocking=BlockingCounts(own=_n(row, "blocking_mandatory")),
        # Conductores y equipos no tienen onboarding: es lo mismo que la habilitación.
        requirements_met=row["operational_status"] == "ACTIVE" and _n(row, "blocking_mandatory") == 0,
    )


# ── El aviso de un documento ─────────────────────────────────────────────────
#
# "Crítico" no es un estado (E-e): es un aviso calculado con los días que faltan
# y el umbral global de Configuración › Alertas. Las filas por documento de
# app.alert_thresholds no se leen (D1-R4).

_ERROR_DAYS = (
    "(SELECT vg_ae.error_days FROM app.alert_thresholds vg_ae "
    f"WHERE vg_ae.doc_type = '{GLOBAL_ALERT_THRESHOLD}')"
)


def days_to_expiry_sql(alias: str = "cr") -> str:
    """Días de Chile hasta el vencimiento calculado (negativo si ya venció), o
    NULL si no vence, falta, o le falta el dato de vigencia (-infinity)."""
    return f"(NULLIF({vence_el_sql(alias)}, '-infinity'::date) - {hoy_sql()})"


def alert_severity_sql(alias: str = "cr") -> str:
    """'critical' si está por vencer (`por_vencer_predicate`, que ya respeta los
    días de aviso de cada regla) y le faltan como mucho los `error_days` del
    umbral global; 'warning' si está por vencer y no es crítico; NULL en otro
    caso. El crítico es un tramo DENTRO del por vencer (ruling T4-C): un
    documento "Al día" nunca lleva aviso, aunque la ventana de su regla sea más
    corta que `error_days`. "No vencido" es lo mismo que en document_state_sql:
    ni marcado EXPIRED ni pasado de su fecha. Un documento vencido no lleva
    aviso: su estado ya lo dice."""
    por_vencer = (
        f"({exigible_sql(alias)} AND NOT ({alias}.status = 'EXPIRED' OR {vencido_predicate(alias)}) "
        f"AND {por_vencer_predicate(alias)})"
    )
    return (
        f"(CASE WHEN {por_vencer} AND {days_to_expiry_sql(alias)} <= {_ERROR_DAYS} THEN 'critical' "
        f"WHEN {por_vencer} THEN 'warning' END)"
    )


# ── Proyecciones para los lectores (D1, Task 5) ──────────────────────────────
#
# Los lectores no escriben los alias del resumen a mano: si cada uno proyectara
# `own_missing` a su manera, el día que el resumen sume una cifra habría cinco
# lugares que tocar. `summary_from_row` lee estas columnas (ruling R-B1).

CARRIER_SUMMARY_COLUMNS: tuple[str, ...] = (
    "worst_state", "own_overdue", "own_expiring", "own_missing",
    "fleet_overdue", "fleet_expiring", "fleet_missing", "can_operate",
    "blocking_own", "blocking_fleet", "requirements_met",
)
# Una fila de conductor o equipo no trae la habilitación hecha: la arma
# `summary_from_row` con `blocking_mandatory` y el `operational_status` que el
# lector ya selecciona como columna propia (por eso no se retira de la fila).
ENTITY_SUMMARY_COLUMNS: tuple[str, ...] = (
    "worst_state", "overdue", "expiring", "missing", "blocking_mandatory",
)


def compliance_record_columns_sql(alias: str = "cr") -> str:
    """Estado, días que faltan y aviso de un registro, para un SELECT. Lo leen
    la ficha del Directorio y los paneles de conductor y equipo (R-B7); el
    `status` guardado sigue al lado como historial del archivo."""
    return (
        f"{document_state_sql(alias)} AS document_state, "
        f"{days_to_expiry_sql(alias)} AS days_to_expiry, "
        f"{alert_severity_sql(alias)} AS alert_severity"
    )


def entity_summary_columns_sql(alias: str = "ec") -> str:
    """El resumen de un conductor o un equipo desde un LEFT JOIN a
    `entity_compliance` (sin fila = nada pendiente). El lector selecciona además
    su propio `operational_status`: habilitado = activo y sin obligatorios
    vencidos ni faltantes (R-B2), y eso lo decide `summary_from_row`."""
    return (
        f"{alias}.worst_state AS worst_state, "
        f"COALESCE({alias}.overdue, 0) AS overdue, "
        f"COALESCE({alias}.expiring, 0) AS expiring, "
        f"COALESCE({alias}.missing, 0) AS missing, "
        f"COALESCE({alias}.blocking_mandatory, 0) AS blocking_mandatory"
    )


def carrier_summary_columns_sql(alias: str = "cc") -> str:
    """El resumen de una empresa desde un JOIN a `carrier_compliance` (una fila
    por empresa, R-B3)."""
    return ", ".join(f"{alias}.{col} AS {col}" for col in CARRIER_SUMMARY_COLUMNS)


# Filtros de habilitación del Directorio (R-B14) sobre una fila que ya trae
# las columnas de `carrier_summary_columns_sql`. Una empresa no activa no es
# ni Habilitada ni No habilitada: la pantalla la muestra en gris.
ENABLEMENT_FILTERS: dict[str, str] = {
    "enabled": "can_operate",
    "not_enabled": "operational_status = 'ACTIVE' AND NOT can_operate",
}


def take_summary(row: dict, *, with_fleet: bool) -> dict:
    """Arma `compliance_summary` desde una fila ya convertida a dict y le saca
    las columnas sueltas: la respuesta lleva el resumen, no campos planos que
    alguien termine leyendo por separado."""
    summary = summary_from_row(row, with_fleet=with_fleet).model_dump()
    for col in CARRIER_SUMMARY_COLUMNS if with_fleet else ENTITY_SUMMARY_COLUMNS:
        row.pop(col, None)
    return summary


def carrier_pending_total_sql(alias: str = "cc") -> str:
    """Cuánto debe una empresa, propio y de su flota: lo mismo que su fila en
    /pending/summary?group_by=carrier si está activa (spec §5)."""
    return "(" + " + ".join(
        f"COALESCE({alias}.{col}, 0)"
        for col in CARRIER_SUMMARY_COLUMNS if col.startswith(("own_", "fleet_"))
    ) + ")::int"


def funnel_bucket_for(summary: ComplianceSummary | dict, lifecycle: str) -> FunnelBucket | None:
    """El balde del embudo, de la escala del resumen (spec §6.1, conflicto 8):
    no habilitada, con vencimientos (incluye por vencer) o al día. Una empresa
    no activa (ONBOARDING incluida) no tiene balde (R-B4). Un opcional que falta
    no saca del "al día": no bloquea, y sus cifras ya están en el resumen."""
    s = summary if isinstance(summary, ComplianceSummary) else ComplianceSummary.model_validate(summary)
    if lifecycle != "ACTIVE":
        return None
    if not s.can_operate:
        return "not_enabled"
    fleet = s.fleet or StateCounts()
    if s.own.overdue + s.own.expiring + fleet.overdue + fleet.expiring > 0:
        return "expiring"
    return "up_to_date"
