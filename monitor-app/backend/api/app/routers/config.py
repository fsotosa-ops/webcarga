from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from ..auth import get_current_user
from ..authz import Permission, require
from ..authz.deps import exigir
from ..db import get_pool
from ..schemas.status_taxonomy import TRIP_STAGES
from ..services.reordenamiento import (
    ESTADOS_DEL_TABLERO, MovimientoBody, mover_una_posicion,
)
from ..services.reglas_del_monitor import SQL_REGLAS_DEL_MONITOR
from ..services.vencimientos import UMBRALES
from ..services.revisiones import POR_SECCION, SQL_PENDIENTES_POR_SECCION, registrar_revision
from ..services.config_changes import SQL_ULTIMOS_CAMBIOS, diferencia, entity_type, registrar_cambio

# Cada ruta declara su permiso (RBAC): ver tests/test_toda_ruta_declara_permiso.py.
router = APIRouter(prefix="/config", tags=["config"])

# Personas y Roles ya se auditaban con sus propios tipos (USER_ROLE, ROLE) y el id
# real de la entidad; se leen esos, no se escriben dos veces.
_TIPOS_DE_ACCESO = {"users": ["PERSON", "USER_ROLE"], "roles": ["ROLE"]}
_SQL_ULTIMOS_CAMBIOS_DE_ACCESO = """
SELECT DISTINCT ON (a.entity_id) a.entity_id::text AS element_id,
       COALESCE(p.full_name, p.email) AS actor_name, a.occurred_at AS changed_at
  FROM public.audit_log a
  LEFT JOIN public.profiles p ON p.id = a.actor
 WHERE a.entity_type = ANY($1::text[])
 ORDER BY a.entity_id, a.occurred_at DESC, a.id DESC
"""


def _como_respuesta(filas) -> list[dict]:
    return [{**dict(f), "changed_at": f["changed_at"].isoformat()} for f in filas]


@router.get("/changes/people")
async def list_people_changes(
    section: str, pool=Depends(get_pool),
    _usuario=Depends(require(Permission.USERS_MANAGE)),
):
    """El último cambio de cada persona o rol. Exige lo mismo que leer Personas y
    Roles (users.manage), nada más: si pidiera además reference.read, quien gestiona
    usuarios sin ese permiso vería "Sin cambios registrados" en todo."""
    tipos = _TIPOS_DE_ACCESO.get(section)
    if tipos is None:
        raise HTTPException(422, f"people/{section} no es una sección de accesos")
    return _como_respuesta(await pool.fetch(_SQL_ULTIMOS_CAMBIOS_DE_ACCESO, tipos))


@router.get("/changes")
async def list_config_changes(
    area: str, section: str, pool=Depends(get_pool),
    usuario=Depends(require(Permission.REFERENCE_READ)),
):
    """El último cambio de cada elemento de una sección de Configuración: quién y
    cuándo (spec 2026-10-22-configuracion-orden-visual §3.3). Personas y Roles van
    por /changes/people."""
    if (area, section) not in POR_SECCION:
        raise HTTPException(422, f"{area}/{section} no es una sección de Configuración")
    return _como_respuesta(await pool.fetch(SQL_ULTIMOS_CAMBIOS, entity_type(area, section)))

# El `group_id` de un estado del TMS es su etapa del viaje (schemas/status_taxonomy.TRIP_STAGES),
# la misma lista que la de los estados operacionales. `pendiente_cierre_tms` (minuta 09/10,
# ítem 6): asignado y terminado para Operaciones, pero el TMS del cliente todavía no lo cierra
# (Sodimac en "Control de salida"). Lo sigue Facturación.

# ── Pydantic models ───────────────────────────────────────────────────────────

class TripStatusPatch(BaseModel):
    # `sort_order` NO se puede escribir acá: se mueve con POST .../move, que es
    # atómico. Mientras un cliente pueda mandar un número arbitrario, dos
    # estados pueden terminar con el mismo y la lista queda con un empate que
    # la pantalla no sabe deshacer. Ver services/reordenamiento.py.
    model_config = ConfigDict(extra="forbid")

    label:      Optional[str] = None
    group_id:   Optional[str] = None

    @field_validator("group_id")
    @classmethod
    def group_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in TRIP_STAGES:
            raise ValueError(f"group_id debe ser uno de {', '.join(sorted(TRIP_STAGES))}")
        return v




class MonitorAlertRulesPatch(BaseModel):
    stale_report_hours:     Optional[float] = None
    dwell_hours:            Optional[float] = None
    late_arrival_grace_min: Optional[int]   = None
    unassigned_enabled:     Optional[bool]  = None
    dwell_yellow_min:       Optional[int]   = None
    dwell_orange_min:       Optional[int]   = None
    dwell_red_min:          Optional[int]   = None
    # Horas que la TMS puede seguir corriendo sin traer un viaje antes de que
    # se encienda "Ya no está en el TMS". Configurable a propósito: el
    # criterio de cuándo una ausencia cuenta como baja lo define operaciones
    # (issue #3), y moverlo no puede exigir un despliegue.
    tms_dropped_hours:      Optional[float] = None
    # D5 (minuta 02/10): días desde la última entrega tras los cuales un viaje
    # que el TMS dejó abierto sale del cierre. NULL es un valor válido —"no
    # ocultar nada"—, por eso es el único campo que viaja aunque venga vacío.
    stale_trip_days:        Optional[int]   = None
    # Días sin movimiento tras los cuales un viaje activo sale de "En curso"
    # del Monitor (11/10, services/ventana_en_curso.py). Siempre tiene valor.
    in_progress_idle_days:  Optional[int]   = None

    @field_validator("stale_trip_days", "in_progress_idle_days")
    @classmethod
    def days_positive(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v <= 0:
            raise ValueError("los días deben ser mayores a 0")
        return v

    @field_validator("stale_report_hours", "dwell_hours", "tms_dropped_hours")
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
    'SELECT id, label, group_id AS "group", sort_order '
    f"FROM app.trip_statuses WHERE active = true ORDER BY {ESTADOS_DEL_TABLERO.orden}"
)


@router.get("/statuses")
async def list_statuses(pool=Depends(get_pool),
    _permiso=Depends(require(Permission.REFERENCE_READ)),
):
    # group_id AS "group": el frontend (StatusMeta) usa la key `group` — antes
    # este endpoint devolvía group_id crudo y el select de Grupo en Configuración
    # nunca mostraba el valor guardado (bug de auditoría 2026-07-06)
    return [dict(r) for r in await pool.fetch(_SQL_ESTADOS)]


@router.patch("/statuses/{status_id}")
async def patch_status(
    status_id: str,
    body: TripStatusPatch,
    pool=Depends(get_pool),
    usuario=Depends(require(Permission.OPERATIONS_CONFIGURE)),
):
    existing = await pool.fetchrow(
        "SELECT * FROM app.trip_statuses WHERE id = $1", status_id
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
        'SELECT id, label, group_id AS "group", sort_order '
        "FROM app.trip_statuses WHERE id = $1",
        status_id,
    )
    # GUARDAR CUENTA COMO REVISAR: editar y guardar es tomar una decisión, y no
    # hace falta un segundo gesto para dejarla registrada.
    await registrar_revision(pool, "operations", "tms-statuses", status_id, usuario["sub"])
    antes, despues = diferencia(existing, data)
    if despues:
        await registrar_cambio(pool, actor=usuario["sub"], area="operations", section="tms-statuses",
                               element_id=status_id, action="update", before=antes, after=despues)
    return dict(row)


@router.post("/statuses/{status_id}/move")
async def move_status(
    status_id: str,
    body: MovimientoBody,
    pool=Depends(get_pool),
    usuario=Depends(require(Permission.OPERATIONS_CONFIGURE)),
):
    """Sube o baja un estado una posición, en una sola transacción.

    Devuelve la lista completa ya ordenada: mover es un cambio sobre el
    conjunto, no sobre una fila, y devolver sólo la fila movida obligaría al
    llamador a adivinar qué pasó con la otra."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            await mover_una_posicion(conn, ESTADOS_DEL_TABLERO, status_id, body.direction)
    await registrar_cambio(pool, actor=usuario["sub"], area="operations", section="tms-statuses",
                           element_id=status_id, action="move", before=None, after={"direction": body.direction})
    return [dict(r) for r in await pool.fetch(_SQL_ESTADOS)]


# ── Alert thresholds ─────────────────────────────────────────────────────────

@router.get("/alert-thresholds")
async def list_alert_thresholds(pool=Depends(get_pool),
    _permiso=Depends(require(Permission.REFERENCE_READ)),
):
    # Los umbrales del registro, uno por área (Configuración, Parte 1): el aviso
    # general de documentos y el de pólizas. Las filas por documento no las lee
    # nadie (D1-R4).
    rows = await pool.fetch(
        "SELECT doc_type, label, warning_days, error_days "
        "FROM app.alert_thresholds WHERE doc_type = ANY($1::text[]) ORDER BY doc_type",
        list(UMBRALES),
    )
    return [dict(r) for r in rows]


@router.patch("/alert-thresholds/{doc_type}")
async def patch_alert_threshold(
    doc_type: str,
    body: AlertThresholdPatch,
    pool=Depends(get_pool),
    # Base: leer la configuración; el permiso del umbral se exige adentro (exigir).
    usuario=Depends(require(Permission.REFERENCE_READ)),
):
    # Cada umbral lo edita su área: documentos, Certificación; pólizas, Seguros.
    umbral = UMBRALES.get(doc_type)
    if umbral is None:
        raise HTTPException(404, "Ese umbral no se edita en Configuración")
    exigir(usuario, umbral.permiso)
    existing = await pool.fetchrow(
        "SELECT doc_type, label, warning_days, error_days FROM app.alert_thresholds WHERE doc_type = $1",
        doc_type,
    )
    if not existing:
        raise HTTPException(404, "Tipo de documento no encontrado")

    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(422, "Ningún campo enviado")
    # El crítico es un tramo DENTRO del aviso: si no fuera menor, un documento
    # quedaría en aviso crítico antes de estar Por vencer (R-E3).
    aviso = data.get("warning_days", existing["warning_days"])
    critico = data.get("error_days", existing["error_days"])
    if critico >= aviso:
        raise HTTPException(422, "El plazo crítico tiene que ser menor que el aviso")

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
    await registrar_revision(pool, umbral.dominio, umbral.seccion, doc_type, usuario["sub"])
    antes, despues = diferencia(existing, data)
    if despues:
        await registrar_cambio(pool, actor=usuario["sub"], area=umbral.dominio, section=umbral.seccion,
                               element_id=doc_type, action="update", before=antes, after=despues)
    # Sin invalidar /trips/meta: la meta ya no lleva los umbrales (D1, R-E4).
    return dict(row)


# ── Temperature ranges (full CRUD — cargo_type is free text, not a fixed enum) ─

@router.get("/temperature-ranges")
async def list_temperature_ranges(pool=Depends(get_pool),
    _permiso=Depends(require(Permission.REFERENCE_READ)),
):
    rows = await pool.fetch(
        "SELECT cargo_type, label, min_c, max_c "
        "FROM app.temperature_ranges ORDER BY cargo_type"
    )
    return [dict(r) for r in rows]


@router.post("/temperature-ranges")
async def create_temperature_range(
    body: TemperatureRangeBody,
    pool=Depends(get_pool),
    usuario=Depends(require(Permission.OPERATIONS_CONFIGURE)),
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
    await registrar_cambio(pool, actor=usuario["sub"], area="operations", section="temperature-ranges",
                           element_id=body.cargo_type, action="create", before=None,
                           after={k: row[k] for k in ("label", "min_c", "max_c")})
    return dict(row)


@router.patch("/temperature-ranges/{cargo_type}")
async def patch_temperature_range(
    cargo_type: str,
    body: TemperatureRangePatch,
    pool=Depends(get_pool),
    usuario=Depends(require(Permission.OPERATIONS_CONFIGURE)),
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
    antes, despues = diferencia(existing, data)
    if despues:
        await registrar_cambio(pool, actor=usuario["sub"], area="operations", section="temperature-ranges",
                               element_id=cargo_type, action="update", before=antes, after=despues)
    return dict(row)


@router.delete("/temperature-ranges/{cargo_type}")
async def delete_temperature_range(
    cargo_type: str,
    pool=Depends(get_pool),
    usuario=Depends(require(Permission.OPERATIONS_CONFIGURE)),
):
    borrado = await pool.fetchrow(
        "DELETE FROM app.temperature_ranges WHERE cargo_type = $1 RETURNING label, min_c, max_c", cargo_type
    )
    if borrado is None:
        raise HTTPException(404, "Rango de temperatura no encontrado")
    await registrar_cambio(pool, actor=usuario["sub"], area="operations", section="temperature-ranges",
                           element_id=cargo_type, action="delete", before=dict(borrado), after=None)
    return {"ok": True}


# ── Reglas de alerta del monitor (fila única) ─────────────────────────────────

@router.get("/monitor-alert-rules")
async def get_monitor_alert_rules(pool=Depends(get_pool),
    _permiso=Depends(require(Permission.REFERENCE_READ)),
):
    row = await pool.fetchrow(SQL_REGLAS_DEL_MONITOR)
    if not row:
        raise HTTPException(404, "Reglas de alerta no configuradas")
    return dict(row)


@router.patch("/monitor-alert-rules")
async def patch_monitor_alert_rules(
    body: MonitorAlertRulesPatch,
    pool=Depends(get_pool),
    usuario=Depends(require(Permission.OPERATIONS_CONFIGURE)),
):
    data = body.model_dump(exclude_none=True)
    # stale_trip_days acepta NULL a propósito (desactivar el umbral): se manda
    # si vino en el cuerpo, aunque sea vacío.
    if "stale_trip_days" in body.model_fields_set:
        data["stale_trip_days"] = body.stale_trip_days
    if not data:
        raise HTTPException(422, "Ningún campo enviado")

    sets, vals = [], []
    for field, value in data.items():
        vals.append(value)
        sets.append(f"{field} = ${len(vals)}")
    sets.append("updated_at = NOW()")

    previas = await pool.fetchrow("SELECT * FROM app.monitor_alert_rules WHERE id = 1")
    await pool.execute(
        f"UPDATE app.monitor_alert_rules SET {', '.join(sets)} WHERE id = 1", *vals
    )
    row = await pool.fetchrow(SQL_REGLAS_DEL_MONITOR)
    # Los umbrales son UN formulario, no una lista: su elemento es el
    # formulario entero, y revisarlo es decir "estos siete números están bien".
    await registrar_revision(
        pool, "operations", "alert-thresholds", "reglas", usuario["sub"])
    # El registro de cambios sí es por regla: "Última modificación" se ve en cada una.
    antes, despues = diferencia(previas, data)
    for regla, valor in despues.items():
        await registrar_cambio(pool, actor=usuario["sub"], area="operations", section="alert-thresholds",
                               element_id=regla, action="update", before={regla: antes[regla]}, after={regla: valor})
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
  (SELECT count(*) FROM app.status_taxonomies WHERE domain='TRIP_VOID_REASON' AND active) AS motivos_anulacion,
  (SELECT count(*) FROM app.temperature_ranges)                                            AS rangos_temp,
  (SELECT count(*) FROM app.status_taxonomies WHERE domain='FLEET_SERVICE_TYPE' AND active) AS subtipos,
  (SELECT count(*) FROM app.status_taxonomies WHERE domain='WEBCARGA_OPERATION_TYPE' AND active) AS tipos_operacion,
  (SELECT count(*) FROM app.status_taxonomies WHERE domain='DEACTIVATION_REASON' AND active) AS motivos_baja,
  (SELECT count(*) FROM app.status_taxonomies WHERE domain='REACTIVATION_REASON' AND active) AS motivos_reactivacion,
  (SELECT count(*) FROM app.status_taxonomies WHERE domain='ACTIVATION_EXCEPTION_REASON' AND active) AS motivos_activacion,
  (SELECT count(*) FROM public.profiles WHERE active)                                      AS usuarios,
  -- profiles.role se borró con el contract de RBAC (10/10): los roles viven en app.user_roles.
  (SELECT count(DISTINCT ur.role_id) FROM app.user_roles ur
     JOIN public.profiles p ON p.id = ur.user_id WHERE p.active)                          AS roles
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
async def inventario_configuracion(pool=Depends(get_pool), usuario=Depends(require(Permission.REFERENCE_READ))):
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
    # Por sección para el índice de Configuración; el área suma sus secciones.
    pendientes: dict[str, dict] = {}
    por_seccion: dict[str, dict[str, int]] = {}
    for r in await pool.fetch(SQL_PENDIENTES_POR_SECCION):
        area = pendientes.setdefault(r["domain"], {"total": 0, "sin_revisar": 0})
        area["total"] += r["total"]
        area["sin_revisar"] += r["sin_revisar"]
        por_seccion.setdefault(r["domain"], {})[r["section"]] = r["sin_revisar"]
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
            ("motivos_anulacion", "motivo de anulación", "motivos de anulación"),
            ("rangos_temp", "rango de temperatura", "rangos de temperatura"),
        ),
        "fleet": _pares(
            f,
            ("subtipos", "subtipo", "subtipos"),
            ("tipos_operacion", "tipo de operación", "tipos de operación"),
        ),
        "directory": _pares(
            f,
            ("motivos_baja", "motivo de baja", "motivos de baja"),
            ("motivos_reactivacion", "motivo de reactivación", "motivos de reactivación"),
            ("motivos_activacion", "motivo de activación excepcional", "motivos de activación excepcional"),
        ),
        # Seguros (Parte 1): un umbral; su contenido es la sección misma.
        "insurance": [],
        "people": _pares(
            f,
            ("usuarios", "usuario", "usuarios"),
            ("roles", "rol", "roles"),
        ),
    }
    # Un dominio sin nada revisable —Personas y accesos— no trae la clave, y la
    # portada no le dibuja insignia. Es opt-in a propósito: una cuenta de
    # usuario no es una decisión de configuración que alguien deba confirmar.
    # Lo ve quien entra a Configuración (reference.read alcanza: son conteos).
    # Cuántas personas tienen cuenta, solo quien las gestiona: es lo mismo que
    # esconde el dominio en la portada (revisión final RBAC, menor 2).
    if Permission.USERS_MANAGE.value not in usuario["permissions"]:
        contenido.pop("people")
    return {
        clave: {"pares": pares, "revision": pendientes.get(clave), "secciones": por_seccion.get(clave, {})}
        for clave, pares in contenido.items()
    }
