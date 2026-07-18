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
    # Campos híbridos de origen (Carga Inicio/Fin) — sin equivalente TMS,
    # ver migración 20260717190246_trip_hybrid_date_fields
    cag_inicio_at:          Optional[str]  = None
    cag_fin_at:             Optional[str]  = None
    # Motivo de no asignación (app.unassigned_reasons) — Fase 1.5d
    unassigned_reason_id:   Optional[str]  = None

    def sent_fields(self) -> list[str]:
        return list(self.model_dump(exclude_none=True).keys())


class TripStopPatch(BaseModel):
    """Override manual de Desc. Inicio/Fin por parada — vive en
    app.trips.stop_manual_fields (keyed por stop_id), nunca en el jsonb
    `stops` del pipeline (se sobrescribe completo en cada corrida)."""
    desc_inicio: Optional[str] = None
    desc_fin:    Optional[str] = None
