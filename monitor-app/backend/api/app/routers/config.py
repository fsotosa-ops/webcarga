from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator, model_validator

from ..auth import require_admin
from ..cache import invalidate_trips_meta_cache
from ..db import get_pool
from ..services.reordenamiento import (
    ESTADOS_DEL_TABLERO, MovimientoBody, mover_una_posicion,
)
from ..services.revisiones import SQL_PENDIENTES_POR_DOMINIO, registrar_revision

router = APIRouter(prefix="/config", tags=["config"])

# Taxonomía de grupos del tablero — compartida entre estados TMS y operacionales
VALID_GROUP_IDS = {"en_ruta", "en_local", "retornando", "cerrado", "problema", "otro"}

# ── Pydantic models ───────────────────────────────────────────────────────────

class TripStatusPatch(BaseModel):
    # `sort_order` NO se puede escribir acá: se mueve con POST .../move, que es
    # atómico. Mientras un cliente pueda mandar un número arbitrario, dos
    # estados pueden terminar con el mismo y la lista queda con un empate que
    # la pantalla no sabe deshacer. Ver services/reordenamiento.py.
    label:      Optional[str] = None
    bg_color:   Optional[str] = None
    text_color: Optional[str] = None
    group_id:   Optional[str] = None

    @field_validator("group_id")
    @classmethod
    def group_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_GROUP_IDS:
            raise ValueError(f"group_id debe ser uno de {VALID_GROUP_IDS}")
        return v




class MonitorAlertRulesPatch(BaseModel):
    stale_report_hours:     Optional[float] = None
    dwell_hours:            Optional[float] = None
    late_arrival_grace_min: Optional[int]   = None
    unassigned_enabled:     Optional[bool]  = None
    dwell_yellow_min:       Optional[int]   = None
    dwell_orange_min:       Optional[int]   = None
    dwell_red_min:          Optional[int]   = None

    @field_validator("stale_report_hours", "dwell_hours")
    @classmethod
    def hours_positive(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and v <= 0:
            raise ValueError("las horas deben ser mayores a 0")
        return v

    @field_validator("late_arrival_grace_min", "dwell_yellow_min", "dwell_orange_min", "dwell_red_min")
    @classmethod
    def grace_non_negative(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v < 0:
            raise ValueError("los minutos no pueden ser negativos")
        return v


class AlertThresholdPatch(BaseModel):
    warning_days: Optional[int] = None
    error_days:   Optional[int] = None

    @field_validator("warning_days")
    @classmethod
    def warning_positive(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v <= 0:
            raise ValueError("warning_days debe ser mayor a 0")
        return v

    @field_validator("error_days")
    @classmethod
    def error_non_negative(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v < 0:
            raise ValueError("error_days no puede ser negativo")
        return v


class TemperatureRangeBody(BaseModel):
    cargo_type: str
    label:      str
    min_c:      float
    max_c:      float

    @field_validator("cargo_type", "label")
    @classmethod
    def not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 60:
            raise ValueError("debe tener entre 1 y 60 caracteres")
        return v

    @model_validator(mode="after")
    def range_valid(self) -> "TemperatureRangeBody":
        if self.min_c > self.max_c:
            raise ValueError("min_c no puede ser mayor a max_c")
        return self


class TemperatureRangePatch(BaseModel):
    label: Optional[str]   = None
    min_c: Optional[float] = None
    max_c: Optional[float] = None

    @field_validator("label")
    @classmethod
    def label_not_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v or len(v) > 60:
            raise ValueError("label debe tener entre 1 y 60 caracteres")
        return v


# ── Trip statuses (TMS-defined IDs, only presentation editable) ──────────────

# El orden del ORDER BY es el mismo que usa el reordenamiento
# (ESTADOS_DEL_TABLERO.orden). Si divergieran, la lista que se ve y la lista
# contra la que se mueve serían dos listas distintas.
_SQL_ESTADOS = (
    'SELECT id, label, bg_color, text_color, group_id AS "group", sort_order '
    f"FROM app.trip_statuses WHERE active = true ORDER BY {ESTADOS_DEL_TABLERO.orden}"
)


@router.get("/statuses")
async def list_statuses(pool=Depends(get_pool)):
    # group_id AS "group": el frontend (StatusMeta) usa la key `group` — antes
    # este endpoint devolvía group_id crudo y el select de Grupo en Configuración
    # nunca mostraba el valor guardado (bug de auditoría 2026-07-06)
    return [dict(r) for r in await pool.fetch(_SQL_ESTADOS)]


@router.patch("/statuses/{status_id}")
async def patch_status(
    status_id: str,
    body: TripStatusPatch,
    pool=Depends(get_pool),
    usuario=Depends(require_admin),
):
    existing = await pool.fetchrow(
        "SELECT id FROM app.trip_statuses WHERE id = $1", status_id
    )
    if not existing:
        raise HTTPException(404, "Estado no encontrado")

    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(422, "Ningún campo enviado")

    sets, vals = [], [status_id]
    for field, value in data.items():
        vals.append(value)
        sets.append(f"{field} = ${len(vals)}")

    await pool.execute(
        f"UPDATE app.trip_statuses SET {', '.join(sets)} WHERE id = $1", *vals
    )
    row = await pool.fetchrow(
        'SELECT id, label, bg_color, text_color, group_id AS "group", sort_order '
        "FROM app.trip_statuses WHERE id = $1",
        status_id,
    )
    # GUARDAR CUENTA COMO REVISAR: editar y guardar es tomar una decisión, y no
    # hace falta un segundo gesto para dejarla registrada.
    await registrar_revision(pool, "operations", "tms-statuses", status_id, usuario["sub"])
    await invalidate_trips_meta_cache()
    return dict(row)


@router.post("/statuses/{status_id}/move")
async def move_status(
    status_id: str,
    body: MovimientoBody,
    pool=Depends(get_pool),
    _=Depends(require_admin),
):
    """Sube o baja un estado una posición, en una sola transacción.

    Devuelve la lista completa ya ordenada: mover es un cambio sobre el
    conjunto, no sobre una fila, y devolver sólo la fila movida obligaría al
    llamador a adivinar qué pasó con la otra."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            await mover_una_posicion(conn, ESTADOS_DEL_TABLERO, status_id, body.direction)
    await invalidate_trips_meta_cache()
    return [dict(r) for r in await pool.fetch(_SQL_ESTADOS)]


# ── Alert thresholds ─────────────────────────────────────────────────────────

@router.get("/alert-thresholds")
async def list_alert_thresholds(pool=Depends(get_pool)):
    rows = await pool.fetch(
        "SELECT doc_type, label, warning_days, error_days "
        "FROM app.alert_thresholds ORDER BY doc_type"
    )
    return [dict(r) for r in rows]


@router.patch("/alert-thresholds/{doc_type}")
async def patch_alert_threshold(
    doc_type: str,
    body: AlertThresholdPatch,
    pool=Depends(get_pool),
    usuario=Depends(require_admin),
):
    existing = await pool.fetchrow(
        "SELECT doc_type FROM app.alert_thresholds WHERE doc_type = $1", doc_type
    )
    if not existing:
        raise HTTPException(404, "Tipo de documento no encontrado")

    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(422, "Ningún campo enviado")

    sets, vals = [], [doc_type]
    for field, value in data.items():
        vals.append(value)
        sets.append(f"{field} = ${len(vals)}")

    await pool.execute(
        f"UPDATE app.alert_thresholds SET {', '.join(sets)} WHERE doc_type = $1", *vals
    )
    row = await pool.fetchrow(
        "SELECT doc_type, label, warning_days, error_days "
        "FROM app.alert_thresholds WHERE doc_type = $1",
        doc_type,
    )
    await registrar_revision(
        pool, "certification", "expiry-alerts", doc_type, usuario["sub"])
    await invalidate_trips_meta_cache()
    return dict(row)


# ── Temperature ranges (full CRUD — cargo_type is free text, not a fixed enum) ─

@router.get("/temperature-ranges")
async def list_temperature_ranges(pool=Depends(get_pool)):
    rows = await pool.fetch(
        "SELECT cargo_type, label, min_c, max_c "
        "FROM app.temperature_ranges ORDER BY cargo_type"
    )
    return [dict(r) for r in rows]


@router.post("/temperature-ranges")
async def create_temperature_range(
    body: TemperatureRangeBody,
    pool=Depends(get_pool),
    usuario=Depends(require_admin),
):
    existing = await pool.fetchrow(
        "SELECT cargo_type FROM app.temperature_ranges WHERE cargo_type = $1",
        body.cargo_type,
    )
    if existing:
        raise HTTPException(409, "Ya existe un rango para ese tipo de carga")

    row = await pool.fetchrow(
        """INSERT INTO app.temperature_ranges (cargo_type, label, min_c, max_c)
           VALUES ($1, $2, $3, $4)
           RETURNING cargo_type, label, min_c, max_c""",
        body.cargo_type, body.label, body.min_c, body.max_c,
    )
    # Crear también es decidir: un rango recién creado no nace pendiente de que
    # alguien lo mire, porque lo acaba de mirar quien lo creó.
    await registrar_revision(
        pool, "operations", "temperature-ranges", body.cargo_type, usuario["sub"])
    await invalidate_trips_meta_cache()
    return dict(row)


@router.patch("/temperature-ranges/{cargo_type}")
async def patch_temperature_range(
    cargo_type: str,
    body: TemperatureRangePatch,
    pool=Depends(get_pool),
    usuario=Depends(require_admin),
):
    existing = await pool.fetchrow(
        "SELECT cargo_type, label, min_c, max_c FROM app.temperature_ranges WHERE cargo_type = $1",
        cargo_type,
    )
    if not existing:
        raise HTTPException(404, "Rango de temperatura no encontrado")

    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(422, "Ningún campo enviado")

    new_min = data.get("min_c", existing["min_c"])
    new_max = data.get("max_c", existing["max_c"])
    if float(new_min) > float(new_max):
        raise HTTPException(422, "min_c no puede ser mayor a max_c")

    sets, vals = [], [cargo_type]
    for field, value in data.items():
        vals.append(value)
        sets.append(f"{field} = ${len(vals)}")

    await pool.execute(
        f"UPDATE app.temperature_ranges SET {', '.join(sets)} WHERE cargo_type = $1", *vals
    )
    row = await pool.fetchrow(
        "SELECT cargo_type, label, min_c, max_c FROM app.temperature_ranges WHERE cargo_type = $1",
        cargo_type,
    )
    await registrar_revision(
        pool, "operations", "temperature-ranges", cargo_type, usuario["sub"])
    await invalidate_trips_meta_cache()
    return dict(row)


@router.delete("/temperature-ranges/{cargo_type}")
async def delete_temperature_range(
    cargo_type: str,
    pool=Depends(get_pool),
    _=Depends(require_admin),
):
    result = await pool.execute(
        "DELETE FROM app.temperature_ranges WHERE cargo_type = $1", cargo_type
    )
    if result == "DELETE 0":
        raise HTTPException(404, "Rango de temperatura no encontrado")
    await invalidate_trips_meta_cache()
    return {"ok": True}


# ── Reglas de alerta del monitor (fila única) ─────────────────────────────────

_ALERT_RULES_SELECT = (
    "SELECT stale_report_hours, dwell_hours, late_arrival_grace_min, unassigned_enabled, "
    "dwell_yellow_min, dwell_orange_min, dwell_red_min "
    "FROM app.monitor_alert_rules WHERE id = 1"
)


@router.get("/monitor-alert-rules")
async def get_monitor_alert_rules(pool=Depends(get_pool)):
    row = await pool.fetchrow(_ALERT_RULES_SELECT)
    if not row:
        raise HTTPException(404, "Reglas de alerta no configuradas")
    return dict(row)


@router.patch("/monitor-alert-rules")
async def patch_monitor_alert_rules(
    body: MonitorAlertRulesPatch,
    pool=Depends(get_pool),
    usuario=Depends(require_admin),
):
    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(422, "Ningún campo enviado")

    sets, vals = [], []
    for field, value in data.items():
        vals.append(value)
        sets.append(f"{field} = ${len(vals)}")
    sets.append("updated_at = NOW()")

    await pool.execute(
        f"UPDATE app.monitor_alert_rules SET {', '.join(sets)} WHERE id = 1", *vals
    )
    row = await pool.fetchrow(_ALERT_RULES_SELECT)
    # Los umbrales son UN formulario, no una lista: su elemento es el
    # formulario entero, y revisarlo es decir "estos siete números están bien".
    await registrar_revision(
        pool, "operations", "alert-thresholds", "reglas", usuario["sub"])
    await invalidate_trips_meta_cache()
    return dict(row)


# ── Inventario del módulo de Configuración ──────────────────────────────────

# Cada dominio declara CÓMO se cuentan sus elementos; la portada no sabe nada de
# dominios en particular — sólo dibuja pares (número, etiqueta). Esa es la razón
# de que el mapa viva acá y no en el frontend: agregar un dominio es agregar una
# entrada a este diccionario, sin tocar la pantalla.
#
# Una sola consulta para toda la portada: hacer una llamada por dominio serían
# cuatro viajes para una pantalla que se mira dos segundos.
_INVENTARIO_SQL = """
SELECT
  (SELECT count(*) FROM public.compliance_requirements)                                    AS req_total,
  (SELECT count(*) FROM public.compliance_requirements
    WHERE applies_to_fleet_service_type_ids IS NOT NULL
       OR applies_to_management_types IS NOT NULL)                                         AS req_condicion,
  (SELECT count(*) FROM public.compliance_requirements WHERE NOT is_active)                AS req_inactivos,
  (SELECT count(*) FROM app.trip_statuses WHERE active)                                    AS estados_tms,
  (SELECT count(*) FROM app.status_taxonomies WHERE domain='OPERATIONAL_STATE' AND active) AS estados_op,
  (SELECT count(*) FROM app.status_taxonomies WHERE domain='EQUIPMENT_STATE' AND active)   AS estados_eq,
  (SELECT count(*) FROM app.status_taxonomies WHERE domain='DRIVER_REASON' AND active)     AS motivos,
  (SELECT count(*) FROM app.status_taxonomies WHERE domain='TRIP_UNASSIGNED_REASON' AND active) AS motivos_no_asignacion,
  (SELECT count(*) FROM app.temperature_ranges)                                            AS rangos_temp,
  (SELECT count(*) FROM app.status_taxonomies WHERE domain='FLEET_SERVICE_TYPE' AND active) AS subtipos,
  (SELECT count(*) FROM app.status_taxonomies WHERE domain='WEBCARGA_OPERATION_TYPE' AND active) AS tipos_operacion,
  (SELECT count(*) FROM public.profiles WHERE active)                                      AS usuarios,
  (SELECT count(DISTINCT role) FROM public.profiles WHERE active)                          AS roles
"""


def _pares(fila, *campos: tuple[str, str, str]) -> list[dict]:
    """Arma los pares (n, etiqueta) de un dominio, en singular o plural según el
    número. Se descartan los ceros: una línea que dice "0 rangos" ocupa el lugar
    de algo que sí informa."""
    salida = []
    for clave, singular, plural in campos:
        n = fila[clave] or 0
        if n:
            salida.append({"n": n, "etiqueta": singular if n == 1 else plural})
    return salida


@router.get("/inventario")
async def inventario_configuracion(pool=Depends(get_pool), _=Depends(require_admin)):
    """Qué gobierna cada dominio, en números reales.

    Las claves son los slugs de dominio del frontend, que van en INGLES por el
    estandar de rutas del proyecto (Ronda 55): la URL habla ingles, la pantalla
    habla espanol.

    La portada mostraba "N secciones", que describe la NAVEGACIÓN y no el
    contenido: Certificación con 37 documentos se veía igual que Personas con
    10 usuarios."""
    f = await pool.fetchrow(_INVENTARIO_SQL)
    # Cuántas decisiones nadie tomó todavía, por dominio. "Sin revisar" no es un
    # adorno: es el camino corto entre "algo falta" y "lo estoy resolviendo".
    pendientes = {
        r["domain"]: {"total": r["total"], "sin_revisar": r["sin_revisar"]}
        for r in await pool.fetch(SQL_PENDIENTES_POR_DOMINIO)
    }
    contenido = {
        "certification": _pares(
            f,
            ("req_total", "documento", "documentos"),
            ("req_condicion", "con condición", "con condición"),
            ("req_inactivos", "sin vigencia", "sin vigencia"),
        ),
        "operations": _pares(
            f,
            ("estados_tms", "estado del tablero", "estados del tablero"),
            ("estados_op", "operacional", "operacionales"),
            ("estados_eq", "de equipo", "de equipo"),
            ("motivos", "motivo", "motivos"),
            ("motivos_no_asignacion", "motivo de no asignación", "motivos de no asignación"),
            ("rangos_temp", "rango de temperatura", "rangos de temperatura"),
        ),
        "fleet": _pares(
            f,
            ("subtipos", "subtipo", "subtipos"),
            ("tipos_operacion", "tipo de operación", "tipos de operación"),
        ),
        "people": _pares(
            f,
            ("usuarios", "usuario", "usuarios"),
            ("roles", "rol", "roles"),
        ),
    }
    # Un dominio sin nada revisable —Personas y accesos— no trae la clave, y la
    # portada no le dibuja insignia. Es opt-in a propósito: una cuenta de
    # usuario no es una decisión de configuración que alguien deba confirmar.
    return {
        clave: {"pares": pares, "revision": pendientes.get(clave)}
        for clave, pares in contenido.items()
    }
