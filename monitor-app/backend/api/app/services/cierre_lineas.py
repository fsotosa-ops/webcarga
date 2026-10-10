"""El cierre del día sobre app.closure_periods y app.closure_lines.

Diseño: docs/superpowers/specs/2026-09-14-modelo-de-cierre-design.md.

Un día es un PERÍODO (abierto o cerrado) y cada conductor y cada tracto de ese
día es una LÍNEA de conciliación. Este módulo es el único que las escribe:

- `recalcular`  — deriva el estado de cada línea de los viajes del día. Si el
                  período está cerrado NO hace nada: ése es el congelamiento, y
                  es la línea que convierte la firma en una firma. Hasta el
                  16/09, 6 de 7 días firmados se habían recalculado después.
- `poner_motivo` — lo que escribe una persona: motivo, vigencia, comentario.
- `cerrar`       — firma los dos ejes en UNA transacción. Antes eran dos POST
                  encadenados desde el frontend, y si el segundo fallaba el día
                  quedaba medio firmado sin que nada lo dijera.
- `reabrir`      — acto explícito, de admin y con nota.

Transición (olas 2-3 del spec): las tablas viejas (driver_day_status,
equipment_day_status, daily_closures, equipment_closures) se siguen escribiendo
como PROYECCIÓN de las líneas, en la misma transacción. Nadie las lee; son la
red para volver atrás hasta que se retiren (ola 5).
"""
from __future__ import annotations

import json
from datetime import date

from fastapi import HTTPException

from .audit import log_change
from .cierre_viajes import SQL_TOTAL_TRIPS_DEL_DIA
from .driver_roster import TRACTOREO_ROSTER_CTE
from .pre_cierre import run_pre_cierre

# ── Qué significa un motivo ──────────────────────────────────────────────────
# Vive en el catálogo (status_taxonomies.group_id), no acá: migración
# 20260917000000. Un motivo sin grupo se lee como "no trabajó", que es lo que
# la pantalla hacía hasta el 16/09.
GRUPO_TRABAJANDO_SIN_ASIGNACION = "trabajando_sin_asignacion"
GRUPO_NO_TRABAJANDO = "no_trabajando"
GRUPOS_DE_MOTIVO = (GRUPO_NO_TRABAJANDO, GRUPO_TRABAJANDO_SIN_ASIGNACION)

# La categoría de una línea, calculada en UN solo lugar. La pantalla, el
# reporte y el bloqueo del cierre la leen; ninguno la deriva por su cuenta.
_CATEGORIA = f"""
    CASE
        WHEN l.status = 'ASSIGNED' THEN 'ASIGNADO'
        WHEN l.status = 'MISMATCH' THEN 'POR_REGULARIZAR'
        WHEN l.reason_id IS NULL THEN 'SIN_RESOLVER'
        WHEN lr.group_id = '{GRUPO_TRABAJANDO_SIN_ASIGNACION}' THEN 'TRABAJANDO_SIN_ASIGNACION'
        ELSE 'NO_TRABAJANDO'
    END
"""

# Las líneas con los nombres de columna que ya usaban los SQL de lectura
# (driver_id / asset_id, unassigned_reason_id, requires_motivo): cambiar de
# dónde se lee no obliga a reescribir cada consulta.
LINEAS_CONDUCTORES = f"""(
    SELECT l.business_date, l.subject_id AS driver_id, l.status,
           l.reason_id AS unassigned_reason_id, l.valid_until,
           l.resolved_by, l.resolved_at, l.computed_at, l.comentario,
           l.home_location_id,
           {_CATEGORIA} AS category
    FROM app.closure_lines l
    LEFT JOIN app.status_taxonomies lr ON lr.id = l.reason_id
    WHERE l.subject_type = 'DRIVER'
)"""

LINEAS_TRACTOS = f"""(
    SELECT l.business_date, l.subject_id AS asset_id, l.status,
           l.requires_reason AS requires_motivo,
           l.reason_id AS unassigned_reason_id, l.valid_until,
           l.resolved_by, l.resolved_at, l.computed_at, l.comentario,
           l.home_location_id, l.reason_from_driver_id,
           {_CATEGORIA} AS category
    FROM app.closure_lines l
    LEFT JOIN app.status_taxonomies lr ON lr.id = l.reason_id
    WHERE l.subject_type = 'ASSET'
)"""

# ── El estado de cada sujeto, derivado de los viajes del día ─────────────────

# MISMATCH: algún viaje del conductor ese día sin empresa resuelta, o con una
# empresa distinta a la suya — necesita regularización antes de cerrar limpio.
SQL_ESTADO_CONDUCTORES = f"""
WITH {TRACTOREO_ROSTER_CTE},
day_trips AS (
    SELECT t.id AS trip_id,
           vfr.resolved_driver_id AS driver_id,
           vfr.resolved_carrier_id AS trip_carrier_id
    FROM app.trips t
    JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
    WHERE t.id IN (SELECT trip_id FROM app.trips_del_dia($1))
)
SELECT
    r.driver_id AS subject_id,
    CASE
        WHEN count(dt.trip_id) > 0
             AND bool_or(dt.trip_carrier_id IS NULL OR dt.trip_carrier_id IS DISTINCT FROM r.home_carrier_id)
            THEN 'MISMATCH'
        WHEN count(dt.trip_id) > 0 THEN 'ASSIGNED'
        ELSE 'UNASSIGNED'
    END AS status,
    true AS requires_reason,
    -- El origen habitual DECLARADO, no el origen del viaje. Son dos preguntas: de quién
    -- es la asistencia, y de dónde salió la carga. La segunda se lee de
    -- app.trip_stops y no se guarda acá.
    r.home_location_id
FROM active_roster r
LEFT JOIN day_trips dt ON dt.driver_id = r.driver_id
GROUP BY r.driver_id, r.home_carrier_id, r.home_location_id
"""

# Un tracto de Equipo Completo puro no exige motivo (cierre pasivo); uno sin
# tipo de operación cae en Tractoreo y sí lo exige.
SQL_ESTADO_TRACTOS = """
WITH active_roster AS (
    SELECT a.id AS asset_id,
           wot.code = 'TRACTOREO' AS is_tractoreo,
           wot.code = 'EQUIPO_COMPLETO' AS is_equipo_completo
    FROM public.assets a
    JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
    JOIN public.carriers c ON c.id = aa.carrier_id AND c.operational_status = 'ACTIVE'
    LEFT JOIN app.status_taxonomies wot ON wot.id = a.webcarga_operation_type_id
    WHERE a.operational_status = 'ACTIVE' AND a.asset_type = 'TRACTOCAMION'
),
today_trips AS (
    SELECT DISTINCT vfr.resolved_tractor_asset_id AS asset_id
    FROM app.trips t
    JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
    WHERE t.id IN (SELECT trip_id FROM app.trips_del_dia($1))
      AND vfr.resolved_tractor_asset_id IS NOT NULL
)
SELECT
    ar.asset_id AS subject_id,
    CASE WHEN tt.asset_id IS NOT NULL THEN 'ASSIGNED' ELSE 'UNASSIGNED' END AS status,
    NOT (COALESCE(ar.is_equipo_completo, false) AND NOT COALESCE(ar.is_tractoreo, false)) AS requires_reason,
    -- El tracto hereda el CD de su conductor habitual, y no al revés: Operaciones
    -- dijo que el CD se le asigna a la persona, que puede cambiar de patente
    -- cuando queda en panne. Misma tabla que usa _SQL_SINCRONIZAR_TRACTOS.
    hd.home_location_id
FROM active_roster ar
LEFT JOIN today_trips tt ON tt.asset_id = ar.asset_id
LEFT JOIN LATERAL (
    SELECT d.home_location_id
    FROM public.vehicle_driver_assignments vda
    JOIN public.drivers d ON d.id = vda.driver_id
    WHERE vda.asset_id = ar.asset_id AND vda.status = 'ACTIVE'
    LIMIT 1
) hd ON true
"""


def _sql_upsert(subject_type: str, sql_estado: str) -> str:
    return f"""
INSERT INTO app.closure_lines
    (business_date, subject_type, subject_id, status, requires_reason, home_location_id, computed_at)
SELECT $1, '{subject_type}', e.subject_id, e.status, e.requires_reason, e.home_location_id, now()
FROM ({sql_estado}) e
ON CONFLICT (business_date, subject_type, subject_id) DO UPDATE SET
    status = EXCLUDED.status,
    requires_reason = EXCLUDED.requires_reason,
    -- El CD se refresca mientras el día está abierto; con el día CLOSED este
    -- upsert no corre y por eso queda congelado. No se limpia al pasar a
    -- ASSIGNED: es una dimensión, no un motivo.
    home_location_id = EXCLUDED.home_location_id,
    computed_at = EXCLUDED.computed_at,
    -- El motivo y su vigencia sólo tienen sentido en una línea sin carga: si
    -- ahora la tiene, se limpian. El comentario NO: es una nota del día que
    -- escribió una persona (14/09).
    reason_id   = CASE WHEN EXCLUDED.status = 'UNASSIGNED' THEN app.closure_lines.reason_id END,
    valid_until = CASE WHEN EXCLUDED.status = 'UNASSIGNED' THEN app.closure_lines.valid_until END,
    resolved_by = CASE WHEN EXCLUDED.status = 'UNASSIGNED' THEN app.closure_lines.resolved_by END,
    resolved_at = CASE WHEN EXCLUDED.status = 'UNASSIGNED' THEN app.closure_lines.resolved_at END,
    reason_from_driver_id = CASE WHEN EXCLUDED.status = 'UNASSIGNED' THEN app.closure_lines.reason_from_driver_id END
"""


_SQL_UPSERT_CONDUCTORES = _sql_upsert("DRIVER", SQL_ESTADO_CONDUCTORES)
_SQL_UPSERT_TRACTOS = _sql_upsert("ASSET", SQL_ESTADO_TRACTOS)

# La vigencia: una línea sin carga que nadie tocó (resolved_at nulo) hereda el
# motivo de la línea anterior más reciente del mismo sujeto que siga vigente.
# `resolved_at IS NULL` es lo que respeta a quien borró a propósito el motivo
# heredado: esa línea ya tiene autor y no se vuelve a llenar sola.
# Un viaje del TMS le gana a la vigencia ese día (la línea es ASSIGNED y no
# entra acá) sin borrarla: la línea de origen sigue diciendo hasta cuándo.
_SQL_HEREDAR_VIGENCIA = """
UPDATE app.closure_lines l
SET reason_id = h.reason_id, valid_until = h.valid_until,
    resolved_by = h.resolved_by, resolved_at = h.resolved_at
FROM (
    SELECT DISTINCT ON (p.subject_type, p.subject_id)
           p.subject_type, p.subject_id, p.reason_id, p.valid_until, p.resolved_by, p.resolved_at
    FROM app.closure_lines p
    WHERE p.business_date < $1 AND p.valid_until >= $1 AND p.reason_id IS NOT NULL
      -- Un motivo heredado del conductor no se arrastra por su cuenta: lo
      -- vuelve a calcular _SQL_SINCRONIZAR_TRACTOS desde el conductor del día.
      AND p.reason_from_driver_id IS NULL
    ORDER BY p.subject_type, p.subject_id, p.business_date DESC
) h
WHERE l.business_date = $1
  AND l.subject_type = h.subject_type AND l.subject_id = h.subject_id
  AND l.status = 'UNASSIGNED' AND l.reason_id IS NULL AND l.resolved_at IS NULL
"""

# El tracto hereda el motivo de su conductor habitual (punto 5 del Diario 2.0,
# 01/10). Operaciones escribía a mano en el tracto EL MISMO motivo del
# conductor: 108 veces en dos semanas, en los dos grupos.
#
# Se calcula por conjuntos para todo el día, así sirve igual después de que una
# persona escribe, de un cambio, de un borrado o de una vigencia heredada.
# Sólo toca líneas de tracto sin carga y que exigen motivo, y de esas sólo las
# que están SIN TOCAR (sin motivo y sin autor) o YA HEREDADAS
# (`reason_from_driver_id`): lo que escribió una persona en el tracto no se
# pisa. Si el conductor ya no tiene motivo —lo borraron, o trabajó— la herencia
# se limpia y la línea vuelve a estar sin tocar.
_SQL_SINCRONIZAR_TRACTOS = """
WITH herencia AS (
    SELECT a.id AS line_id, d.subject_id AS driver_id, d.reason_id, d.valid_until,
           d.resolved_by, d.resolved_at
    FROM app.closure_lines a
    -- LEFT: si el tracto dejó de tener conductor habitual, la herencia vieja
    -- también se limpia.
    LEFT JOIN public.vehicle_driver_assignments vda
      ON vda.asset_id = a.subject_id AND vda.status = 'ACTIVE'
    LEFT JOIN app.closure_lines d
      ON d.business_date = a.business_date AND d.subject_type = 'DRIVER'
     AND d.subject_id = vda.driver_id
     AND d.status = 'UNASSIGNED' AND d.reason_id IS NOT NULL
    WHERE a.business_date = $1 AND a.subject_type = 'ASSET'
      AND a.status = 'UNASSIGNED' AND a.requires_reason
      AND ((a.reason_id IS NULL AND a.resolved_at IS NULL) OR a.reason_from_driver_id IS NOT NULL)
)
UPDATE app.closure_lines a
SET reason_id = h.reason_id, valid_until = h.valid_until,
    resolved_by = h.resolved_by, resolved_at = h.resolved_at,
    reason_from_driver_id = h.driver_id
FROM herencia h
WHERE a.id = h.line_id
  AND (a.reason_id, a.valid_until, a.reason_from_driver_id, a.resolved_at)
      IS DISTINCT FROM (h.reason_id, h.valid_until, h.driver_id, h.resolved_at)
"""

# "Sin especificar" en un tracto cuyo conductor habitual TIENE motivo ese día:
# la persona está deshaciendo su propio motivo, no declarando "en blanco", así
# que la línea vuelve a sin tocar y la herencia la llena en el mismo acto.
# Antes quedaba con autor y _SQL_SINCRONIZAR_TRACTOS la saltaba para siempre.
# Sólo en ese caso: sin un conductor del que heredar, borrar sigue siendo
# borrar a propósito, y una línea sin autor la volvería a llenar la vigencia
# del tracto (_SQL_HEREDAR_VIGENCIA), justo lo que quien la borró no quería.
_SQL_TRACTO_VUELVE_A_HEREDAR = """
UPDATE app.closure_lines a
SET resolved_by = NULL, resolved_at = NULL
WHERE a.business_date = $1 AND a.subject_type = 'ASSET' AND a.subject_id = ANY($2::uuid[])
  AND a.reason_id IS NULL AND a.reason_from_driver_id IS NULL
  AND EXISTS (
      SELECT 1
      FROM public.vehicle_driver_assignments vda
      JOIN app.closure_lines d
        ON d.business_date = a.business_date AND d.subject_type = 'DRIVER'
       AND d.subject_id = vda.driver_id
       AND d.status = 'UNASSIGNED' AND d.reason_id IS NOT NULL
      WHERE vda.asset_id = a.subject_id AND vda.status = 'ACTIVE'
  )
"""

# ── Proyección a las tablas viejas (se retira en la ola 5) ───────────────────
_SQL_PROYECTAR_CONDUCTORES = """
INSERT INTO app.driver_day_status
    (driver_id, business_date, status, unassigned_reason_id, resolved_by, resolved_at, computed_at, comentario)
SELECT subject_id, business_date, status, reason_id, resolved_by, resolved_at, computed_at, comentario
FROM app.closure_lines
WHERE business_date = $1 AND subject_type = 'DRIVER' AND ($2::uuid[] IS NULL OR subject_id = ANY($2::uuid[]))
ON CONFLICT (driver_id, business_date) DO UPDATE SET
    status = EXCLUDED.status, unassigned_reason_id = EXCLUDED.unassigned_reason_id,
    resolved_by = EXCLUDED.resolved_by, resolved_at = EXCLUDED.resolved_at,
    computed_at = EXCLUDED.computed_at, comentario = EXCLUDED.comentario
"""

_SQL_PROYECTAR_TRACTOS = """
INSERT INTO app.equipment_day_status
    (asset_id, business_date, status, requires_motivo, unassigned_reason_id, resolved_by, resolved_at, computed_at, comentario)
SELECT subject_id, business_date, status, requires_reason, reason_id, resolved_by, resolved_at, computed_at, comentario
FROM app.closure_lines
WHERE business_date = $1 AND subject_type = 'ASSET' AND ($2::uuid[] IS NULL OR subject_id = ANY($2::uuid[]))
ON CONFLICT (asset_id, business_date) DO UPDATE SET
    status = EXCLUDED.status, requires_motivo = EXCLUDED.requires_motivo,
    unassigned_reason_id = EXCLUDED.unassigned_reason_id,
    resolved_by = EXCLUDED.resolved_by, resolved_at = EXCLUDED.resolved_at,
    computed_at = EXCLUDED.computed_at, comentario = EXCLUDED.comentario
"""


async def _proyectar(conn, fecha: date, sujetos: list[str] | None = None) -> None:
    await conn.execute(_SQL_PROYECTAR_CONDUCTORES, fecha, sujetos)
    await conn.execute(_SQL_PROYECTAR_TRACTOS, fecha, sujetos)


async def _bloquear_periodo(conn, fecha: date) -> str:
    """Crea el período si no existe y lo toma con FOR UPDATE: dos personas
    firmando o editando el mismo día se serializan acá."""
    await conn.execute(
        "INSERT INTO app.closure_periods (business_date) VALUES ($1) ON CONFLICT DO NOTHING", fecha,
    )
    return await conn.fetchval(
        "SELECT status FROM app.closure_periods WHERE business_date = $1 FOR UPDATE", fecha,
    )


async def periodo(pool, fecha: date) -> dict | None:
    fila = await pool.fetchrow(
        """
        SELECT p.status, p.closed_by, p.closed_at, p.override_count, p.frozen_totals,
               p.reopened_by, p.reopened_at, p.reopen_note,
               cp.full_name AS closed_by_name
        FROM app.closure_periods p
        LEFT JOIN public.profiles cp ON cp.id = p.closed_by
        WHERE p.business_date = $1
        """,
        fecha,
    )
    if not fila:
        return None
    datos = dict(fila)
    if isinstance(datos["frozen_totals"], str):
        datos["frozen_totals"] = json.loads(datos["frozen_totals"])
    return datos


# ── recalcular ───────────────────────────────────────────────────────────────

async def recalcular(pool, fecha: date) -> dict | None:
    """Deriva las líneas del día de sus viajes. Devuelve el resultado del
    pre-cierre, o None si el día está cerrado — en ese caso no corre NADA,
    tampoco el pre-cierre, que escribe en el directorio como efecto."""
    if await pool.fetchval(
        "SELECT status = 'CLOSED' FROM app.closure_periods WHERE business_date = $1", fecha,
    ):
        return None

    # HU-02: el pre-cierre corrige lo que puede antes de calcular MISMATCH.
    pre_cierre = await run_pre_cierre(pool, fecha)

    async with pool.acquire() as conn:
        async with conn.transaction():
            if await _bloquear_periodo(conn, fecha) == "CLOSED":
                # Alguien firmó entre la lectura de arriba y el bloqueo.
                return None
            await conn.execute(_SQL_UPSERT_CONDUCTORES, fecha)
            await conn.execute(_SQL_UPSERT_TRACTOS, fecha)
            await conn.execute(_SQL_HEREDAR_VIGENCIA, fecha)
            await conn.execute(_SQL_SINCRONIZAR_TRACTOS, fecha)
            await _proyectar(conn, fecha)
    return pre_cierre


# ── poner_motivo ─────────────────────────────────────────────────────────────

async def poner_motivo(
    pool, fecha: date, subject_type: str, sujetos: list[str], *,
    campos: set[str], reason_id: str | None, valid_until: date | None,
    comentario: str | None, user: dict,
) -> None:
    """Lo que escribe una persona sobre una o varias líneas del mismo tipo.

    `campos` es `model_fields_set` del body: "no mandó la clave" no es lo mismo
    que "la quiere vacía". Sin eso, cambiar el motivo borraba en silencio un
    comentario, y comentar borraba el motivo."""
    pone_motivo = "unassigned_reason_id" in campos
    pone_vigencia = "valid_until" in campos
    pone_comentario = "comentario" in campos

    async with pool.acquire() as conn:
        async with conn.transaction():
            if await _bloquear_periodo(conn, fecha) == "CLOSED":
                raise HTTPException(409, "El día está cerrado. Para cambiarlo hay que reabrirlo.")

            filas = await conn.fetch(
                """
                SELECT l.subject_id::text AS subject_id, l.status, l.reason_id, lr.group_id
                FROM app.closure_lines l
                LEFT JOIN app.status_taxonomies lr ON lr.id = l.reason_id
                WHERE l.business_date = $1 AND l.subject_type = $2 AND l.subject_id = ANY($3::uuid[])
                """,
                fecha, subject_type, sujetos,
            )
            encontrados = {f["subject_id"] for f in filas}
            faltan = [s for s in sujetos if s not in encontrados]
            if faltan:
                raise HTTPException(404, f"No están en el cierre de ese día: {faltan}")

            # El 422 gobierna el MOTIVO y la vigencia, no la fila: un
            # comentario se acepta en cualquier estado (14/09).
            if (pone_motivo or (pone_vigencia and valid_until)) and any(f["status"] != "UNASSIGNED" for f in filas):
                raise HTTPException(422, "Sólo se puede registrar motivo en una fila sin carga")

            grupo_nuevo = None
            if pone_motivo and reason_id:
                grupo_nuevo = await conn.fetchval(
                    "SELECT COALESCE(group_id, $2) FROM app.status_taxonomies "
                    "WHERE id = $1 AND domain = 'DRIVER_REASON'",
                    reason_id, GRUPO_NO_TRABAJANDO,
                )
                if grupo_nuevo is None:
                    raise HTTPException(422, "Ese motivo no existe en el catálogo de motivos de conductor")

            if pone_vigencia and valid_until:
                if valid_until < fecha:
                    raise HTTPException(422, "La vigencia no puede terminar antes del día que se está cerrando")
                grupos_finales = (
                    [grupo_nuevo] if pone_motivo
                    else [f["group_id"] or (GRUPO_NO_TRABAJANDO if f["reason_id"] else None) for f in filas]
                )
                if any(g != GRUPO_NO_TRABAJANDO for g in grupos_finales):
                    raise HTTPException(
                        422,
                        "Sólo un motivo de 'no trabajó' puede tener vigencia: "
                        "trabajar sin asignación es un hecho de ese día",
                    )

            # "Sin especificar" en un tracto (HU-D3, minuta 02/10).
            vuelve_a_heredar = pone_motivo and not reason_id and not (pone_vigencia and valid_until)
            await conn.execute(
                """
                UPDATE app.closure_lines
                SET reason_id   = CASE WHEN $4 THEN $5::uuid ELSE reason_id END,
                    -- Cambiar el motivo sin decir hasta cuándo deja la vigencia
                    -- vacía: la vieja era de OTRO motivo.
                    valid_until = CASE WHEN $6 THEN $7::date WHEN $4 THEN NULL ELSE valid_until END,
                    comentario  = CASE WHEN $8 THEN $9 ELSE comentario END,
                    -- Una persona que elige (o borra) el motivo de un tracto se
                    -- queda con la línea: deja de seguir al conductor. Un
                    -- comentario solo no rompe la herencia.
                    reason_from_driver_id = CASE WHEN $4 OR $6 THEN NULL ELSE reason_from_driver_id END,
                    resolved_by = $10::uuid, resolved_at = now()
                WHERE business_date = $1 AND subject_type = $2 AND subject_id = ANY($3::uuid[])
                """,
                fecha, subject_type, sujetos,
                pone_motivo, reason_id or None,
                pone_vigencia, valid_until,
                pone_comentario, comentario,
                user["sub"],
            )

            if subject_type == "ASSET" and vuelve_a_heredar:
                await conn.execute(_SQL_TRACTO_VUELVE_A_HEREDAR, fecha, sujetos)

            if pone_motivo or pone_vigencia:
                await conn.execute(_SQL_SINCRONIZAR_TRACTOS, fecha)

            await _proyectar(conn, fecha)


# ── cerrar / reabrir ─────────────────────────────────────────────────────────

# Las escalaciones del pre-cierre que bloquean: significan que la flota de ese
# viaje no está en el directorio, así que el viaje no tiene empresa resoluble
# (Pablo, 21/08). SIN_TIPO_OPERACION y CONDUCTOR_SIN_EMPRESA quedan afuera a
# propósito.
#
# PATENTE_NO_REGISTRADA salió el 01/10 (requirements-bug-12.md, RF-01 / CA-01:
# "la patente … no genera bloqueos por falta de empresa asignada"). GPRZ30 fue
# de una EETT nuestra y hoy el TMS la informa en otra empresa; bloqueaba el día
# entero. Sigue en Pendientes con su acción (asignar o crear la empresa): es un
# estado no vinculante, no un dato que se esconde.
ESCALACIONES_QUE_BLOQUEAN = (
    "CONDUCTOR_NO_REGISTRADO",
    "EMPRESA_NO_RECONOCIDA",
    "EMPRESA_ONBOARDING",
)


def pendientes_de_flota(pre_cierre: dict | None) -> list[dict]:
    """Aplana las escalaciones que bloquean, conservando de cuál vino cada
    una: no es lo mismo "esta patente no existe" que "esta empresa está en
    onboarding"."""
    escalaciones = (pre_cierre or {}).get("escalations", {})
    return [
        {"tipo": tipo, **caso}
        for tipo in ESCALACIONES_QUE_BLOQUEAN
        for caso in escalaciones.get(tipo, [])
    ]


async def cerrar(pool, fecha: date, *, override: bool, override_note: str | None, user: dict) -> dict:
    pre_cierre = await recalcular(pool, fecha)

    async with pool.acquire() as conn:
        async with conn.transaction():
            if await _bloquear_periodo(conn, fecha) == "CLOSED":
                raise HTTPException(409, {"message": "El día ya está cerrado", "ya_cerrado": True})

            conductores_pendientes = [dict(r) for r in await conn.fetch(
                """
                SELECT l.subject_id::text AS driver_id, d.full_name, l.status
                FROM app.closure_lines l
                JOIN public.drivers d ON d.id = l.subject_id
                WHERE l.business_date = $1 AND l.subject_type = 'DRIVER'
                  AND (l.status = 'MISMATCH' OR (l.status = 'UNASSIGNED' AND l.reason_id IS NULL))
                ORDER BY d.full_name
                """,
                fecha,
            )]
            tractos_pendientes = [dict(r) for r in await conn.fetch(
                """
                SELECT l.subject_id::text AS asset_id, a.license_plate AS tractor_plate,
                       c.id::text AS carrier_id, c.business_name AS carrier_name
                FROM app.closure_lines l
                JOIN public.assets a ON a.id = l.subject_id
                LEFT JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
                LEFT JOIN public.carriers c ON c.id = aa.carrier_id
                WHERE l.business_date = $1 AND l.subject_type = 'ASSET' AND l.requires_reason
                  AND l.status = 'UNASSIGNED' AND l.reason_id IS NULL
                ORDER BY a.license_plate
                """,
                fecha,
            )]
            # Si el día ya se había recalculado cerrado por otro camino,
            # `pre_cierre` es None y no hay escalaciones que evaluar.
            sin_flota = pendientes_de_flota(pre_cierre)
            forzados = len(conductores_pendientes) + len(tractos_pendientes) + len(sin_flota)

            if forzados and not override:
                # Tres motivos distintos, tres listas: un solo número no dice
                # qué hacer.
                partes = []
                if conductores_pendientes:
                    partes.append(f"{len(conductores_pendientes)} conductor(es) sin resolver")
                if tractos_pendientes:
                    partes.append(f"{len(tractos_pendientes)} tracto(s) sin motivo")
                if sin_flota:
                    partes.append(f"{len(sin_flota)} viaje(s) con flota fuera del directorio")
                raise HTTPException(409, {
                    "message": " y ".join(partes) + " — no se puede cerrar el día",
                    "pending": conductores_pendientes,
                    "pending_equipment": tractos_pendientes,
                    "sin_flota": sin_flota,
                })

            if forzados:
                if "closures.override" not in user["permissions"]:
                    raise HTTPException(403, "No tienes permiso para firmar el cierre con pendientes")
                if not override_note or not override_note.strip():
                    raise HTTPException(422, "El override requiere un comentario de justificación")
                nota = {"business_date": fecha.isoformat(), "note": override_note}
                for d in conductores_pendientes:
                    await log_change(
                        conn, actor=user["sub"], entity_type="DRIVER", entity_id=d["driver_id"],
                        action="cuadratura_override", field="status", old_value=d["status"], new_value=nota,
                    )
                for t in tractos_pendientes:
                    await log_change(
                        conn, actor=user["sub"], entity_type="ASSET", entity_id=t["asset_id"],
                        action="cierre_override", field="status", old_value="UNASSIGNED", new_value=nota,
                    )
                if sin_flota:
                    # Contra el usuario: lo que falta es justamente la entidad
                    # (la patente no existe), y audit_log.entity_id es NOT NULL.
                    await log_change(
                        conn, actor=user["sub"], entity_type="USER", entity_id=user["sub"],
                        action="cierre_forzado_con_flota_fuera_del_directorio", field="daily_closure",
                        old_value=sin_flota, new_value=nota,
                    )

            conteos = await conn.fetchrow(
                """
                SELECT count(*) FILTER (WHERE subject_type = 'DRIVER') AS conductores,
                       count(*) FILTER (WHERE subject_type = 'ASSET') AS tractos
                FROM app.closure_lines WHERE business_date = $1
                """,
                fecha,
            )
            total_trips = await conn.fetchval(SQL_TOTAL_TRIPS_DEL_DIA, fecha)
            totales = {
                "conductores": conteos["conductores"],
                "conductores_resueltos": conteos["conductores"] - len(conductores_pendientes),
                "tractos": conteos["tractos"],
                "tractos_resueltos": conteos["tractos"] - len(tractos_pendientes),
                "viajes": total_trips,
            }
            cerrado = await conn.fetchrow(
                """
                UPDATE app.closure_periods
                SET status = 'CLOSED', closed_by = $2::uuid, closed_at = now(),
                    override_count = $3, override_note = $4, frozen_totals = $5::jsonb,
                    updated_at = now()
                WHERE business_date = $1
                RETURNING closed_at
                """,
                fecha, user["sub"], forzados if override else 0,
                override_note if forzados else None, json.dumps(totales),
            )

            # Proyección a las cabeceras viejas, en la MISMA transacción.
            await conn.execute(
                """
                INSERT INTO app.daily_closures
                    (business_date, closed_by, closed_at, total_drivers, resolved_count, override_count, total_trips)
                VALUES ($1, $2::uuid, $3, $4, $5, $6, $7)
                ON CONFLICT (business_date) DO UPDATE SET
                    closed_by = EXCLUDED.closed_by, closed_at = EXCLUDED.closed_at,
                    total_drivers = EXCLUDED.total_drivers, resolved_count = EXCLUDED.resolved_count,
                    override_count = EXCLUDED.override_count, total_trips = EXCLUDED.total_trips
                """,
                fecha, user["sub"], cerrado["closed_at"], totales["conductores"],
                totales["conductores_resueltos"],
                (len(conductores_pendientes) + len(sin_flota)) if override else 0, total_trips,
            )
            await conn.execute(
                """
                INSERT INTO app.equipment_closures
                    (business_date, closed_by, closed_at, total_equipment, resolved_count, override_count)
                VALUES ($1, $2::uuid, $3, $4, $5, $6)
                ON CONFLICT (business_date) DO UPDATE SET
                    closed_by = EXCLUDED.closed_by, closed_at = EXCLUDED.closed_at,
                    total_equipment = EXCLUDED.total_equipment, resolved_count = EXCLUDED.resolved_count,
                    override_count = EXCLUDED.override_count
                """,
                fecha, user["sub"], cerrado["closed_at"], totales["tractos"],
                totales["tractos_resueltos"], len(tractos_pendientes) if override else 0,
            )

    return {
        "business_date": fecha.isoformat(),
        "closed_at": cerrado["closed_at"].isoformat(),
        "totales": totales,
        "overridden": forzados if override else 0,
    }


async def reabrir(pool, fecha: date, *, nota: str | None, user: dict) -> dict:
    # Quién reabre lo decide el permiso de la ruta (closures.sign): Operador y
    # Supervisor de Operaciones firman y reabren (usuario, 09/10).
    if not nota or not nota.strip():
        raise HTTPException(422, "Reabrir exige una nota que diga por qué")

    async with pool.acquire() as conn:
        async with conn.transaction():
            if await _bloquear_periodo(conn, fecha) != "CLOSED":
                raise HTTPException(409, "El día no está cerrado")
            await conn.execute(
                """
                UPDATE app.closure_periods
                SET status = 'OPEN', reopened_by = $2::uuid, reopened_at = now(),
                    reopen_note = $3, updated_at = now()
                WHERE business_date = $1
                """,
                fecha, user["sub"], nota.strip(),
            )
            await conn.execute("DELETE FROM app.daily_closures WHERE business_date = $1", fecha)
            await conn.execute("DELETE FROM app.equipment_closures WHERE business_date = $1", fecha)
            await log_change(
                conn, actor=user["sub"], entity_type="USER", entity_id=user["sub"],
                action="cierre_reabierto", field="closure_period",
                new_value={"business_date": fecha.isoformat(), "note": nota.strip()},
            )
    return {"business_date": fecha.isoformat(), "status": "OPEN"}
