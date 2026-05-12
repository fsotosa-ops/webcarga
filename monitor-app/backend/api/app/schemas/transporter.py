import re
import uuid as _uuid
from typing import Optional

from pydantic import BaseModel, field_validator


class Driver(BaseModel):
    id: str
    rut: str
    name: str


class Vehicle(BaseModel):
    id: str
    type: str
    plate: str


class Trailer(BaseModel):
    id: str
    plate: str


class Contactability(BaseModel):
    emails: list[str] = []
    phones: list[str] = []


class TransporterOut(BaseModel):
    id: str
    business_name: Optional[str] = None
    rut: Optional[str] = None
    account_stage: Optional[str] = None
    contactability: Optional[Contactability] = None
    drivers: list[Driver] = []
    vehicles: list[Vehicle] = []
    trailers: list[Trailer] = []
    manually_edited_fields: list[str] = []
    edited_at: Optional[str] = None
    updated_at: Optional[str] = None


class TransporterListItem(BaseModel):
    id: str
    business_name: Optional[str] = None
    rut: Optional[str] = None
    account_stage: Optional[str] = None
    driver_count: int = 0
    vehicle_count: int = 0
    trailer_count: int = 0
    has_manual_edits: bool = False


class TransporterPatch(BaseModel):
    business_name: Optional[str] = None
    rut: Optional[str] = None
    account_stage: Optional[str] = None
    contactability: Optional[Contactability] = None
    drivers: Optional[list[Driver]] = None
    vehicles: Optional[list[Vehicle]] = None
    trailers: Optional[list[Trailer]] = None

    @field_validator("rut", mode="before")
    @classmethod
    def normalize_rut(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return v
        v = re.sub(r"[.\s]", "", v).upper()
        if "-" not in v and len(v) > 1:
            v = v[:-1] + "-" + v[-1]
        return v

    @field_validator("business_name", mode="before")
    @classmethod
    def normalize_name(cls, v: Optional[str]) -> Optional[str]:
        return v.strip().title() if v else v

    def sent_fields(self) -> list[str]:
        return [k for k, val in self.model_dump().items() if val is not None]


class AddDriverReq(BaseModel):
    rut: str
    name: str


class PatchDriverReq(BaseModel):
    rut: Optional[str] = None
    name: Optional[str] = None


class AddVehicleReq(BaseModel):
    type: str
    plate: str


class AddTrailerReq(BaseModel):
    plate: str


class PaginatedResponse(BaseModel):
    data: list
    count: int
    page: int
    limit: int
