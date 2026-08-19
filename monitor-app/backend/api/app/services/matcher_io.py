"""Traduce Postgres a lo que el motor de match espera.

El motor (`document_matcher.py`) es PURO a proposito: recibe el catalogo y el
universo ya cargados y no toca la base. Estos dos lectores son su unica
frontera con Postgres, y viven aparte del router por la misma razon — meter su
I/O adentro de un router de 400 lineas devuelve el acoplamiento que ese diseno
evito.
"""
from .document_matcher import Catalog, EntityUniverse, RequirementAlias

# `requirement_filename_aliases` NO tiene target_entity ni requirement_code:
# viven en `compliance_requirements`. Sin este JOIN, `_match_requirement` no
# puede acotar por tipo de entidad y una licencia de conducir se le podria
# proponer a un tracto.
_SQL_CATALOGO = """
SELECT a.requirement_id::text, a.alias, a.priority,
       r.target_entity, r.requirement_code
FROM public.requirement_filename_aliases a
JOIN public.compliance_requirements r ON r.id = a.requirement_id
"""


async def cargar_catalogo(conn) -> Catalog:
    """Los alias de nombre de archivo, con el tipo de entidad de su requisito."""
    filas = await conn.fetch(_SQL_CATALOGO)
    return Catalog(aliases=[
        RequirementAlias(
            requirement_id=f["requirement_id"],
            target_entity=f["target_entity"],
            alias=f["alias"],
            priority=f["priority"] or 0,
            requirement_code=f["requirement_code"],
        )
        for f in filas
    ])


# Las tuplas son planas y SU ORDEN ES EL CONTRATO del motor:
#   carriers (id, tax_id, business_name) · drivers (id, tax_id, full_name)
#   assets   (id, license_plate)
# Cambiar el orden no falla al desplegar: falla proponiendo el documento
# equivocado, en silencio.
_SQL_CARRIERS = "SELECT id::text, tax_id, business_name FROM public.carriers WHERE ($1::uuid IS NULL OR id = $1)"

_SQL_DRIVERS = """
SELECT d.id::text, d.tax_id, d.full_name
FROM public.drivers d
WHERE $1::uuid IS NULL OR EXISTS (
    SELECT 1 FROM public.driver_assignments da
    WHERE da.driver_id = d.id AND da.carrier_id = $1 AND da.status = 'ACTIVE'
)
"""

_SQL_ASSETS = """
SELECT a.id::text, a.license_plate
FROM public.assets a
WHERE a.license_plate IS NOT NULL AND ($1::uuid IS NULL OR EXISTS (
    SELECT 1 FROM public.asset_assignments aa
    WHERE aa.asset_id = a.id AND aa.carrier_id = $1 AND aa.status = 'ACTIVE'
))
"""


async def cargar_universo(conn, carrier_id: str | None = None) -> EntityUniverse:
    """Las entidades candidatas, opcionalmente acotadas a una empresa.

    ACOTAR ES LO QUE MAS SUBE LA PRECISION, y el motor lo dice: "el scope de
    empresa se aplica ACOTANDO EL UNIVERSO antes de llamar. Asi el scope no
    puede quedar desincronizado entre el filtro y el match". Con una empresa
    fijada los candidatos son ~2 conductores y ~3 vehiculos, no 87 y 124.

    Solo asignaciones ACTIVAS: proponerle un documento a alguien que ya no
    trabaja ahi es peor que no proponer nada.
    """
    return EntityUniverse(
        carriers=[tuple(f) for f in await conn.fetch(_SQL_CARRIERS, carrier_id)],
        drivers=[tuple(f) for f in await conn.fetch(_SQL_DRIVERS, carrier_id)],
        assets=[tuple(f) for f in await conn.fetch(_SQL_ASSETS, carrier_id)],
    )
