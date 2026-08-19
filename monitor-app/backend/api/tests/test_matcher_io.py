"""Los dos lectores que alimentan el motor de match.

El motor es PURO a proposito: recibe el catalogo y el universo ya cargados. Estos
son los unicos que tocan Postgres, y por eso se prueban contra Postgres — este
repo ya tuvo bugs de base que los tests con AsyncMock no detectaron.
"""
from uuid import uuid4

import pytest

from app.services.document_matcher import Catalog, EntityUniverse
from app.services.matcher_io import cargar_catalogo, cargar_universo

pytestmark = pytest.mark.integracion

# Todo lo que este archivo inserta lleva esta marca en su nombre: no es la
# forma de limpiar (de eso se encarga el ROLLBACK de conexion_revertida), es
# la forma de reconocer una fuga si alguna vez la hubiera.
PREFIJO = "ZZ-TEST-INTEGRACION"


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


async def test_el_catalogo_no_pierde_cobertura_de_los_37_requisitos_conocidos(conexion_revertida):
    """Medido el 2026-08-19: 79 alias sobre 37 de 37 requisitos, 2,5 por
    requisito.

    La version anterior de este test exigia `cubiertos == total` contra
    `compliance_requirements`. Nada en el esquema garantiza esa igualdad, y
    Operaciones agrega requisitos sin desplegar: el dia que agreguen uno sin
    su alias todavia, ese assert pone la suite roja por un dato correcto (un
    requisito nuevo, legitimamente sin alias por ahora).

    El invariante que si importa es que la cobertura no BAJE de los 37 que
    hoy la tienen. Si alguno de esos 37 pierde TODOS sus alias, la cuenta cae
    por debajo del piso medido hoy y el test se pone rojo — que es exactamente
    lo que tiene que pasar."""
    catalogo = await cargar_catalogo(conexion_revertida)
    requisitos_con_alias = {a.requirement_id for a in catalogo.aliases}

    assert len(requisitos_con_alias) >= 37, (
        f"solo {len(requisitos_con_alias)} de los 37 requisitos conocidos conservan "
        "alias: alguno perdio toda su cobertura y el motor deja de reconocer sus "
        "documentos sin que nada lo avise"
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


async def test_el_universo_acotado_de_vehiculos_solo_trae_asignaciones_activas(conexion_revertida):
    """Simetrico al de conductores de arriba, y sin la excusa que tuvo aquel:
    hay 2 filas INACTIVE de vehiculos en la base, asi que el test se escribe
    hoy sin tener que fabricar el dato."""
    carrier_id = await conexion_revertida.fetchval("""
        SELECT carrier_id FROM public.asset_assignments
        WHERE status = 'INACTIVE' GROUP BY 1 LIMIT 1
    """)
    assert carrier_id is not None, "no hay ninguna asignacion INACTIVE de vehiculos: el test no puede acotar"
    universo = await cargar_universo(conexion_revertida, str(carrier_id))

    esperados = await conexion_revertida.fetchval("""
        SELECT count(*) FROM public.asset_assignments
        WHERE carrier_id = $1 AND status = 'ACTIVE'
    """, carrier_id)
    assert len(universo.assets) == esperados


# ── Universo global: solo empresas activas para la bandeja global ──────────

async def test_el_universo_global_excluye_empresas_de_baja(conexion_revertida):
    """207 de 248 empresas reales son LEGACY_INACTIVE. Proponerle un archivo
    a una empresa historica al 0,95 es peor que no proponer nada — filtramos
    con la MISMA definicion que usa el embudo (FUNNEL_ACTIVE_STATUSES), no
    una lista de estados escrita a mano por segunda vez."""
    conn = conexion_revertida
    suf = uuid4().hex[:10]
    baja = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id, operational_status) "
        "VALUES ($1, $2, 'LEGACY_INACTIVE') RETURNING id::text",
        f"{PREFIJO} baja {suf}", f"{PREFIJO}-baja-{suf}",
    )
    activa = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id, operational_status) "
        "VALUES ($1, $2, 'ACTIVE') RETURNING id::text",
        f"{PREFIJO} activa {suf}", f"{PREFIJO}-activa-{suf}",
    )

    universo = await cargar_universo(conn)
    ids = {c[0] for c in universo.carriers}

    assert activa in ids, "una empresa ACTIVE debe seguir en el universo global"
    assert baja not in ids, "una empresa LEGACY_INACTIVE no debe proponerse en la bandeja global"


async def test_el_universo_acotado_a_una_empresa_de_baja_igual_la_incluye(conexion_revertida):
    """Cuando el operador ya eligio la empresa desde su ficha, esa empresa ES
    el destino querido aunque este de baja: el filtro de estado solo aplica
    sin carrier_id."""
    conn = conexion_revertida
    suf = uuid4().hex[:10]
    baja = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id, operational_status) "
        "VALUES ($1, $2, 'LEGACY_INACTIVE') RETURNING id::text",
        f"{PREFIJO} acotada {suf}", f"{PREFIJO}-acotada-{suf}",
    )

    universo = await cargar_universo(conn, baja)

    assert [c[0] for c in universo.carriers] == [baja]
