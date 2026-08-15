"""Tipos compartidos por los schemas del modelo nuevo (public.*, H0/H1).
Reemplaza el PaginatedResponse de transporter_relational.py — mismo shape,
sin depender de un módulo que se borra en H2."""
from typing import Literal

from pydantic import BaseModel

EntityType = Literal["CARRIER", "DRIVER", "ASSET"]


class PaginatedResponse(BaseModel):
    data: list
    count: int
    page: int
    limit: int


# Tipo de gestión DECLARADO en el alta (D7/D9). Códigos propios, no las
# etiquetas de app.status_taxonomies: ésas se renombraron dos veces en dos días
# (20260803060000, 20260804000000) y una FK textual se habría roto en silencio.
#
# Es un CONJUNTO, no un escalar con un tercer valor 'AMBAS': marcar los dos ES
# el caso mixto. 'AMBAS' obligaría a que toda consulta futura recuerde
# IN ('TRACTOREO','AMBAS') y olvidarlo deja afuera a la empresa mixta sin dar
# error. Espeja public.carriers.management_types y
# public.compliance_requirements.applies_to_management_types (mismo dominio,
# dos tablas — compartido acá para no duplicarlo, ver Ronda de arreglo 1 de
# Certificación Tramo 3).
ManagementType = Literal["TRACTOREO", "EQUIPO_COMPLETO"]

# Orden canónico de escritura: el CHECK de la base acepta cualquier orden, así
# que sin normalizar dos filas equivalentes no son iguales por `=`.
_MANAGEMENT_TYPE_ORDER = ["TRACTOREO", "EQUIPO_COMPLETO"]


def normalize_management_types(v):
    """Ordena y quita duplicados; el arreglo vacío se vuelve None.

    NULL y [] no pueden significar los dos "no declarado" — la base rechaza el
    vacío justamente para que exista una sola representación.

    SIEMPRE como field_validator(mode="after"), nunca "before": para cuando
    esto corre, Pydantic ya validó cada elemento contra el Literal del
    dominio (y devolvió un 422 legible si no matcheaba) — acá solo hay que
    ordenar/deduplicar valores que ya son válidos. Con "before" recibía la
    lista cruda sin tipar (Ronda de arreglo 2, hallazgo relacionado: la
    misma clase de bug que revienta `normalize_nonempty_list` con tipos
    mixtos, ver abajo)."""
    if not isinstance(v, list):
        return v
    if not v:
        return None
    return [t for t in _MANAGEMENT_TYPE_ORDER if t in v]


def normalize_nonempty_list(v):
    """Mismo principio que `normalize_management_types` para listas sin un
    orden canónico propio (ej. IDs de catálogo): arreglo vacío -> None,
    dedupe, y orden estable (alfabético) para que el mismo conjunto se
    guarde siempre igual sin importar el orden de entrada.

    SIEMPRE como field_validator(mode="after"), nunca "before": `sorted()`
    revienta con `TypeError` (no `ValueError`, que Pydantic v2 no convierte
    en 422) si ve una lista de tipos mixtos. Con "before" eso pasaba de
    verdad (Ronda de arreglo 2, hallazgo real, reproducido con el
    TestClient); con "after" Pydantic ya validó `list[str]` antes de que
    esto corra, así que acá nunca hay nada que no sea `str`."""
    if not isinstance(v, list):
        return v
    if not v:
        return None
    vistos: list = []
    for item in v:
        if item not in vistos:
            vistos.append(item)
    return sorted(vistos)
