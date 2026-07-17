from pydantic import BaseModel
from typing import Optional


class TripPatch(BaseModel):
    activo:                 Optional[bool] = None
    trabajando:             Optional[bool] = None
    asignado:               Optional[bool] = None
    primera_vuelta:         Optional[bool] = None
    estado_manual:          Optional[str]  = None
    observaciones:          Optional[str]  = None
    comentarios:            Optional[str]  = None
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

    def sent_fields(self) -> list[str]:
        return list(self.model_dump(exclude_none=True).keys())


class TripStopPatch(BaseModel):
    """Override manual de Desc. Inicio/Fin por parada — vive en
    app.trips.stop_manual_fields (keyed por stop_id), nunca en el jsonb
    `stops` del pipeline (se sobrescribe completo en cada corrida)."""
    desc_inicio: Optional[str] = None
    desc_fin:    Optional[str] = None
