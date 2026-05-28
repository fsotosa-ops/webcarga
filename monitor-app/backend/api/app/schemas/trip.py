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
    driver_name:            Optional[str]  = None
    driver_phone:           Optional[str]  = None
    tractor_plate:          Optional[str]  = None
    trailer_plate:          Optional[str]  = None

    def sent_fields(self) -> list[str]:
        return list(self.model_dump(exclude_none=True).keys())
