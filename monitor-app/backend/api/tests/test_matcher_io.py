"""Los dos lectores que alimentan el motor de match.

El motor es PURO a proposito: recibe el catalogo y el universo ya cargados. Estos
son los unicos que tocan Postgres, y por eso se prueban contra Postgres — este
repo ya tuvo bugs de base que los tests con AsyncMock no detectaron.
"""
import pytest

from app.services.document_matcher import Catalog, EntityUniverse
from app.services.matcher_io import cargar_catalogo, cargar_universo

pytestmark = pytest.mark.integracion


async def test_el_catalogo_trae_el_tipo_de_entidad_de_cada_alias(conexion_revertida):
    """`requirement_filename_aliases` NO tiene target_entity: vive en
    compliance_requirements. Sin el JOIN, `_match_requirement` no puede acotar
    por tipo y una licencia de conducir se le podria proponer a un tracto."""
    catalogo = await cargar_catalogo(conexion_revertida)

    assert isinstance(catalogo, Catalog)
    assert catalogo.aliases, "el catalogo llego vacio: hay 79 alias sembrados"
    assert all(a.target_entity in {"CARRIER", "DRIVER", "ASSET"} for a in catalogo.aliases)
    # No basta con que cada valor sea valido: si el JOIN se pierde y todo
    # queda con un tipo fijo, la membresia de arriba sigue pasando en
    # silencio. Los tres tipos realmente conviven en el catalogo sembrado.
    assert {a.target_entity for a in catalogo.aliases} == {"CARRIER", "DRIVER", "ASSET"}
    assert all(a.requirement_code for a in catalogo.aliases), (
        "el manifiesto declara el tipo por codigo, no por alias: sin requirement_code no funciona"
    )


async def test_el_catalogo_cubre_los_37_requisitos(conexion_revertida):
    """Medido el 2026-08-19: 79 alias sobre 37 de 37 requisitos, 2,5 por
    requisito. Si baja, alguien borro alias y el motor deja de reconocer
    documentos sin que nada lo diga."""
    catalogo = await cargar_catalogo(conexion_revertida)
    requisitos = {a.requirement_id for a in catalogo.aliases}

    total = await conexion_revertida.fetchval(
        "SELECT count(*) FROM public.compliance_requirements")
    assert len(requisitos) == total, (
        f"{len(requisitos)} de {total} requisitos tienen alias; los que no lo tengan "
        "son invisibles para el matcher"
    )


async def test_el_universo_completo_trae_las_tres_familias(conexion_revertida):
    universo = await cargar_universo(conexion_revertida)

    assert isinstance(universo, EntityUniverse)
    assert universo.carriers and universo.drivers and universo.assets
    # Las tuplas son planas y su ORDEN es el contrato del motor.
    assert len(universo.carriers[0]) == 3   # (id, tax_id, business_name)
    assert len(universo.drivers[0]) == 3    # (id, tax_id, full_name)
    assert len(universo.assets[0]) == 2     # (id, license_plate)


async def test_acotar_por_empresa_achica_el_universo(conexion_revertida):
    """Es lo que mas sube la precision, y por eso se prueba: acotado, un nombre
    ambiguo cruza con un conductor en vez de con tres homonimos del sistema."""
    completo = await cargar_universo(conexion_revertida)

    carrier_id = await conexion_revertida.fetchval("""
        SELECT carrier_id FROM public.driver_assignments
        WHERE status = 'ACTIVE' GROUP BY 1 ORDER BY count(*) DESC LIMIT 1
    """)
    acotado = await cargar_universo(conexion_revertida, str(carrier_id))

    assert len(acotado.drivers) < len(completo.drivers)
    assert len(acotado.carriers) == 1, "acotado a una empresa, la empresa es una sola"


async def test_el_universo_acotado_solo_trae_asignaciones_activas(conexion_revertida):
    """Un conductor desvinculado no es candidato: proponerle un documento a
    alguien que ya no trabaja ahi es peor que no proponer nada.

    Se elige la empresa a partir de una asignacion INACTIVE real (no la de
    mas asignaciones activas): si esa empresa no tiene ninguna inactiva, sacar
    el filtro `status = 'ACTIVE'` de la consulta no cambia el resultado y la
    mutacion pasa desapercibida."""
    carrier_id = await conexion_revertida.fetchval("""
        SELECT carrier_id FROM public.driver_assignments
        WHERE status = 'INACTIVE' GROUP BY 1 LIMIT 1
    """)
    assert carrier_id is not None, "no hay ninguna asignacion INACTIVE: el test no puede acotar"
    universo = await cargar_universo(conexion_revertida, str(carrier_id))

    esperados = await conexion_revertida.fetchval("""
        SELECT count(*) FROM public.driver_assignments
        WHERE carrier_id = $1 AND status = 'ACTIVE'
    """, carrier_id)
    assert len(universo.drivers) == esperados
