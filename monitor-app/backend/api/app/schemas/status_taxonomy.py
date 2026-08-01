from typing import Optional

from pydantic import BaseModel, field_validator

VALID_DOMAINS = {"OPERATIONAL_STATE", "DRIVER_REASON", "EQUIPMENT_STATE", "FLEET_SERVICE_TYPE"}
VALID_GROUP_IDS = {"en_ruta", "en_local", "retornando", "cerrado", "problema", "otro"}


class StatusTaxonomyBody(BaseModel):
    domain:     str
    label:      str
    bg_color:   str = "#f3f4f6"
    text_color: str = "#374151"
    sort_order: int = 99
    group_id:   Optional[str] = None

    @field_validator("domain")
    @classmethod
    def domain_valid(cls, v: str) -> str:
        if v not in VALID_DOMAINS:
            raise ValueError(f"domain debe ser uno de {VALID_DOMAINS}")
        return v

    @field_validator("label")
    @classmethod
    def label_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 60:
            raise ValueError("label debe tener entre 1 y 60 caracteres")
        return v

    @field_validator("group_id")
    @classmethod
    def group_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_GROUP_IDS:
            raise ValueError(f"group_id debe ser uno de {VALID_GROUP_IDS}")
        return v


class StatusTaxonomyPatch(BaseModel):
    label:      Optional[str] = None
    bg_color:   Optional[str] = None
    text_color: Optional[str] = None
    sort_order: Optional[int] = None
    active:     Optional[bool] = None
    group_id:   Optional[str] = None

    @field_validator("group_id")
    @classmethod
    def group_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_GROUP_IDS:
            raise ValueError(f"group_id debe ser uno de {VALID_GROUP_IDS}")
        return v
