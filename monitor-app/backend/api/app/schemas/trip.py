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
