from app.schemas.common import normalize_management_types


def test_normalize_management_types_orders_and_dedupes_known_values():
    assert normalize_management_types(['EQUIPO_COMPLETO', 'TRACTOREO', 'TRACTOREO']) == \
        ['TRACTOREO', 'EQUIPO_COMPLETO']


def test_normalize_management_types_empty_list_becomes_none():
    assert normalize_management_types([]) is None


def test_normalize_management_types_non_list_passthrough():
    assert normalize_management_types(None) is None


def test_normalize_management_types_passthrough_unknown_values():
    """M1: la funcion se volvio compartida y perdio el guion bajo que tenia
    como version privada de carrier.py -- la version privada terminaba en
    `return vistos + desconocidos`, la compartida los descartaba en
    silencio. Los tres usos de hoy (CarrierCreateBody, CarrierPatchBody,
    RequirementConditionsPatchBody) nunca le pasan algo fuera del dominio
    porque corren en mode="after" contra un Literal que ya filtro -- pero la
    funcion en si tiene que dejar pasar lo desconocido, no perderlo, para
    que el primer campo list[str] que la use sin un Literal por delante
    tenga como enterarse (en vez de perder el dato sin dejar rastro)."""
    assert normalize_management_types(['TRACTOREO', 'SIDER']) == ['TRACTOREO', 'SIDER']


def test_normalize_management_types_passthrough_dedupes_unknowns_too():
    assert normalize_management_types(['SIDER', 'SIDER', 'TRACTOREO']) == ['TRACTOREO', 'SIDER']
