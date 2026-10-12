"""Pydantic schemas para public.drivers (H2.2 — routers/drivers.py)."""
from typing import Optional

from pydantic import BaseModel, field_validator

from ..authz.permissions import Permission
from .states import FleetLifecycle

OperationalStatus = FleetLifecycle  # glosario (D1)


class DriverCreateBody(BaseModel):
    tax_id: str
    country_code: str = "CL"
    full_name: str
    operational_status: OperationalStatus = "ACTIVE"
    # Origen habitual (HU-28). Opcional en el alta: se puede enrolar a alguien antes de
    # saber de qué CD va a salir, y queda como pendiente del directorio.
    home_location_id: Optional[str] = None

    @field_validator("full_name", mode="before")
    @classmethod
    def _normalize_name(cls, v):
        return v.strip().title() if isinstance(v, str) and v else v

    # Sólo limpieza de bordes. La CANONIZACIÓN (quitar puntos, validar dígito
    # verificador, dejarlo en NNNNNNNN-D) NO vive acá a propósito: la hace
    # `public.canonical_rut()` en routers/drivers.py, que es la misma función
    # que usa el CHECK `drivers_tax_id_is_canonical` de la tabla. Reescribirla
    # en Python daría dos definiciones de la misma regla, y se separan el día
    # que alguien toca una sola.
    @field_validator("tax_id", mode="before")
    @classmethod
    def _clean_tax_id(cls, v):
        return v.strip().upper() if isinstance(v, str) else v


class DriverPatchBody(BaseModel):
    full_name: Optional[str] = None
    operational_status: Optional[OperationalStatus] = None
    # Cadena vacía = "quítaselo". None = "no mandó la clave", que no es lo
    # mismo: sin esa distinción, cambiar el nombre le borraba el CD.
    home_location_id: Optional[str] = None

    @field_validator("full_name", mode="before")
    @classmethod
    def _normalize_name(cls, v):
        return v.strip().title() if isinstance(v, str) and v else v


# Permiso por campo del PATCH (bloque 0 del Directorio, 0.3; patrón de
# TRIP_FIELD_PERMISSIONS). Dar de baja o reactivar es de Operaciones; el resto
# de la ficha, de los supervisores. Un campo nuevo sin entrada acá hace fallar
# test_directory_permissions.test_todo_campo_del_patch_tiene_permiso.
DRIVER_FIELD_PERMISSIONS: dict[str, Permission] = {
    "full_name": Permission.DIRECTORY_EDIT,
    "home_location_id": Permission.DIRECTORY_EDIT,
    "operational_status": Permission.DIRECTORY_FLEET_STATUS,
}
