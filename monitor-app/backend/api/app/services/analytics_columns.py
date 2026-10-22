"""El catálogo de columnas de Analítica: cada columna se declara una vez (HU Analítica, criterio 6).

De aquí salen la lista que ve el frontend (`GET /analytics/columns`), el SQL de la consulta
(services/analytics_query.py) y el Excel. La consulta solo arma SQL con estas expresiones: un id que no está aquí
es 422, nunca texto pegado en el SQL.

`sql` es una expresión sobre `r` (la fila de la tabla del conjunto de datos) o `p` (analytics.driver_identity,
unida por driver_id solo cuando se pide una columna personal y el usuario tiene el permiso).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ..authz import Permission

Dataset = Literal["trips", "fleet"]
ColumnType = Literal["text", "date", "datetime", "number", "bool", "list"]

TABLES: dict[str, str] = {"trips": "analytics.bdot", "fleet": "analytics.fleet_daily"}

# La fecha que manda el período. La primera de cada conjunto es la de por defecto.
DATE_FIELDS: dict[str, dict[str, str]] = {
    "trips": {"planning": "r.planning_date", "delivered": "r.delivered_date", "signed": "r.signed_business_date"},
    "fleet": {"business": "r.business_date"},
}


@dataclass(frozen=True)
class AnalyticsColumn:
    id: str
    label: str
    group: str
    type: ColumnType
    sql: str
    filter: Literal["values", "none"] = "none"
    personal: bool = False
    default_visible: bool = True


def _c(id: str, label: str, group: str, type: ColumnType = "text", *, filter: bool = False,
       visible: bool = True, sql: str | None = None, personal: bool = False) -> AnalyticsColumn:
    return AnalyticsColumn(id, label, group, type, sql or f"r.{id}", "values" if filter else "none", personal,
                           visible)


# Ocultas de entrada aun con el permiso: un dato personal se elige a propósito en Columnas (humo en dev, 22/10).
_PERSONALES = (
    _c("driver_name", "Conductor", "Datos personales", sql="p.driver_name", personal=True, visible=False),
    _c("driver_tax_id", "RUT del conductor", "Datos personales", sql="p.driver_tax_id", personal=True, visible=False),
)

COLUMNS: dict[str, tuple[AnalyticsColumn, ...]] = {
    "trips": (
        _c("trip_code", "Nº de viaje", "Viaje"),
        _c("source_system", "Origen del dato", "Viaje", filter=True, visible=False),
        _c("planning_date", "Fecha de planificación", "Fechas", "date"),
        _c("planning_year_month", "Mes", "Fechas", visible=False),
        _c("planning_iso_week", "Semana", "Fechas", "number", visible=False),
        _c("planning_day_name", "Día", "Fechas", visible=False),
        _c("planned_at", "Hora planificada", "Fechas", "datetime", visible=False),
        _c("origin_departed_at", "Salida del origen", "Fechas", "datetime", visible=False),
        _c("first_destination_arrived_at", "Llegada al primer destino", "Fechas", "datetime", visible=False),
        _c("last_destination_arrived_at", "Llegada al último destino", "Fechas", "datetime", visible=False),
        _c("delivered_at", "Entrega", "Fechas", "datetime"),
        _c("delivered_date", "Fecha de entrega", "Fechas", "date", visible=False),
        _c("client_name", "Cliente", "Cliente", filter=True),
        _c("carrier_name", "Empresa", "Empresa y flota", filter=True),
        _c("carrier_tax_id", "RUT de la empresa", "Empresa y flota", visible=False),
        _c("carrier_source", "De dónde sale la empresa", "Empresa y flota", visible=False),
        _c("tractor_plate", "Patente tracto", "Empresa y flota"),
        _c("trailer_plate", "Patente rampla", "Empresa y flota", visible=False),
        _c("operation_type", "Tipo de operación", "Empresa y flota", filter=True),
        _c("operation_type_source", "De dónde sale el tipo", "Empresa y flota", visible=False),
        _c("operation_type_conflict", "Tipo distinto al del cliente", "Empresa y flota", "bool", visible=False),
        _c("origin_local", "Origen", "Lugares"),
        _c("last_destination_local", "Último destino", "Lugares"),
        _c("destination_zone", "Zona", "Lugares", filter=True),
        _c("last_destination_city", "Comuna de destino", "Lugares", visible=False),
        _c("last_destination_region", "Región de destino", "Lugares", visible=False),
        _c("destination_count", "Destinos", "Lugares", "number", visible=False),
        _c("trip_status", "Estado", "Estado", filter=True),
        _c("trip_status_group", "Grupo de estado", "Estado", visible=False),
        _c("is_active", "Activo", "Estado", "bool", visible=False),
        _c("is_assigned", "Asignado", "Estado", "bool", filter=True),
        _c("unassigned_reason", "Motivo de no asignación", "Estado", filter=True, visible=False),
        _c("is_voided", "Anulado", "Estado", "bool", visible=False),
        _c("voided_at", "Anulado el", "Estado", "datetime", visible=False),
        _c("void_reason", "Motivo de anulación", "Estado", visible=False),
        _c("tms_missing_since", "Ausente del TMS desde", "Estado", "datetime", visible=False),
        _c("tms_absence_kind", "Tipo de ausencia del TMS", "Estado", visible=False),
        _c("signed_business_date", "Día firmado", "Cierre", "date", visible=False),
        _c("signed_at", "Firmado el", "Cierre", "datetime", visible=False),
        *_PERSONALES,
    ),
    "fleet": (
        _c("business_date", "Día", "Fechas", "date"),
        _c("year_month", "Mes", "Fechas"),
        _c("iso_week", "Semana", "Fechas", "number", visible=False),
        _c("day_name", "Día de la semana", "Fechas", visible=False),
        _c("subject_type", "Conductor o equipo", "Sujeto", filter=True),
        _c("license_plate", "Patente", "Sujeto"),
        _c("asset_operation_type", "Tipo de operación del equipo", "Sujeto", visible=False),
        _c("carrier_name", "Empresa", "Empresa", filter=True),
        _c("status", "Estado del día", "Cierre", visible=False),
        _c("category", "Categoría", "Cierre", filter=True),
        _c("reason", "Motivo", "Cierre", filter=True),
        _c("reason_group", "Grupo del motivo", "Cierre", visible=False),
        _c("home_origin", "Origen habitual", "Cierre", filter=True),
        _c("client_names", "Clientes del día", "Cierre", "list", filter=True),
        _c("is_provisional", "Día sin firmar", "Cierre", "bool", visible=False),
        _c("signed_at", "Firmado el", "Cierre", "datetime", visible=False),
        *_PERSONALES,
    ),
}


def can_see_personal(user: dict) -> bool:
    """Nombre y RUT del conductor: el permiso es privilegiado, así que exige además la verificación en dos pasos
    (la misma regla de `authz.exigir`)."""
    return Permission.ANALYTICS_PERSONAL_DATA.value in user["permissions"] and user.get("aal") == "aal2"


def columns_for(dataset: str, *, personal: bool) -> tuple[AnalyticsColumn, ...]:
    return tuple(c for c in COLUMNS[dataset] if personal or not c.personal)
