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


class TripStopPatch(BaseModel):
    """Override manual por parada — columnas *_manual reales en
    app.trip_stops, excluidas del MERGE de dbt (merge_exclude_columns),
    nunca el jsonb `stops` del pipeline (se sobrescribe completo en cada
    corrida). arrival/departure/gps_arrival/gps_departure generalizan el
    mismo mecanismo que ya tenían desc_inicio/desc_fin — editable siempre
    que la TMS no reporte el campo, sin condicionar por nombre de TMS."""
    desc_inicio:   Optional[str] = None
    desc_fin:      Optional[str] = None
    arrival:       Optional[str] = None
    departure:     Optional[str] = None
    gps_arrival:   Optional[str] = None
    gps_departure: Optional[str] = None
