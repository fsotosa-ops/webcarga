from pydantic import BaseModel
from typing import Optional


class TripPatch(BaseModel):
    is_active:              Optional[bool] = None
    is_working:             Optional[bool] = None
    is_assigned:            Optional[bool] = None
    is_first_leg:           Optional[bool] = None
    manual_status:          Optional[str]  = None
    notes:                  Optional[str]  = None
    comments:               Optional[str]  = None
    origin_region:          Optional[str]  = None
    origin_city:            Optional[str]  = None
    driver_name:            Optional[str]  = None
    driver_phone:           Optional[str]  = None
    tractor_plate:          Optional[str]  = None
    trailer_plate:          Optional[str]  = None
    # cag_inicio_at/cag_fin_at (Carga Inicio/Fin, origen) removidos de acá
    # (Fase 1, cutover final, 2026-07-18) — origen ahora es una parada más
    # (stop_type=ORIGIN), se edita vía TripStopPatch como cualquier destino.
    # Motivo de no asignación (app.unassigned_reasons) — Fase 1.5d
    unassigned_reason_id:   Optional[str]  = None

    def sent_fields(self) -> list[str]:
        return list(self.model_dump(exclude_none=True).keys())


# Lo que el catálogo de roles le promete a `writer`: "edita campos básicos del
# Diario (toggles, observaciones, teléfono)" — ROLE_META en routers/roles.py.
#
# Vive ACÁ, pegada a TripPatch, y no en auth.py, porque son nombres de campos
# de ESTE modelo: si se separan, el día que alguien renombre uno la lista
# apunta a un nombre muerto y el guardia deja de proteger sin avisar. Un test
# de test_rol_writer.py cruza las dos y falla si divergen.
#
# Lo que queda FUERA es deliberado: `driver_name`, `tractor_plate` y
# `trailer_plate` son la identidad de la flota y alimentan toda la cadena de
# resolución; `unassigned_reason_id` cruza con facturación; y `manual_status`
# pisa el estado que reporta el TMS.
CAMPOS_BASICOS_DEL_DIARIO = frozenset({
    "is_active", "is_working", "is_assigned", "is_first_leg",  # toggles
    "notes", "comments",                                       # observaciones
    "driver_phone",                                            # teléfono
})


class TripBulkCloseBody(BaseModel):
    """Selección masiva en el Diario para cerrar/finalizar varios viajes de
    una — mismo mecanismo que ya usa IndicatorSwitches por viaje individual
    (is_active/is_working=false, protegido de que Mage lo pise en la
    próxima corrida vía manually_edited_fields), solo que en lote.

    `unassigned_reason_id` es OBLIGATORIO desde 2026-08-18: apagar un viaje sin
    decir por qué no declara nada, y la declaración es todo el valor de este
    paso ("el acusete de operaciones"). Se valida en el endpoint y no acá para
    poder devolver un 422 con el mensaje de negocio."""
    trip_ids: list[str]
    unassigned_reason_id: str | None = None


class AsignarConductorBody(BaseModel):
    """Asignar una persona a TODOS sus viajes de una (Monitor, 2026-08-18).

    La unidad de trabajo es la persona, no el viaje: 27 personas sin
    identificar explican 208 viajes, 7,7 cada una. Resolver de a un viaje
    convierte una decision en ocho."""
    driver_id: str
    trip_ids: list[str]


class TripStopPatch(BaseModel):
    """Override manual por parada — columnas *_manual reales en
    app.trip_stops, excluidas del MERGE de dbt (merge_exclude_columns),
    nunca el jsonb `stops` del pipeline (se sobrescribe completo en cada
    corrida). arrival/departure generalizan el mismo mecanismo que ya tenía
    desc_inicio/desc_fin — editable siempre que la TMS no reporte el campo,
    sin condicionar por nombre de TMS. gps_arrival/gps_departure removidos
    2026-07-31: GPS Llegada/Salida son inamovibles (minuta 29/07 §4.2), la
    API ya no acepta escribirlos — ver patch_trip_stop en routers/trips.py."""
    desc_inicio:   Optional[str] = None
    desc_fin:      Optional[str] = None
    arrival:       Optional[str] = None
    departure:     Optional[str] = None


# Los cuatro campos de la parada son TODOS básicos: son justamente los que el
# equipo completa a mano al operar —el TMS puebla Plan., GPS Llegada y GPS
# Salida, y esas tres son de solo lectura (los gps_* se sacaron de este modelo
# el 2026-07-31, minuta 29/07 §4.2)—. O sea que hoy no hay nada sensible acá.
#
# Se declara igual, en vez de abrir el endpoint entero, por lo que viene
# después: el día que alguien agregue un campo a `TripStopPatch`, el filtro lo
# niega por omisión en vez de regalarlo, y el test de abajo falla para obligar
# a decidir de qué lado cae. Un permiso que se amplía solo es el modo de falla
# que este proyecto ya conoce.
CAMPOS_BASICOS_DE_PARADA = frozenset({
    "desc_inicio", "desc_fin",   # inicio y fin de descarga
    "arrival", "departure",      # llegada y salida reales
})
