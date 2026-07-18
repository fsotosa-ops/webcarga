from unittest.mock import AsyncMock

import pytest

from app.routers.trips import (
    _apply_operation_types,
    _load_operation_type_buckets,
    _normalize_location_name,
    _resolve_operation_type,
    _split_local,
)

# Casos reales verificados en vivo contra bronze.raw_shipper_locations /
# app.trips.stops (plan maestro H2.6, fase "catálogo de locales"):
# "SANTA ROSA - 87" → n__local 87 → "Santa Rosa"; 3 site_number repetidos
# dentro de Walmart (171/463/50) con nombres distintos entre sí; origen de
# CDs sin número ("CD LO AGUIRRE").


def test_split_local_extracts_name_and_number():
    assert _split_local("SANTA ROSA - 87") == ("SANTA ROSA", "87")
    assert _split_local("CURICÓ, CAMILO HENRÍQUEZ - 279") == ("CURICÓ, CAMILO HENRÍQUEZ", "279")


def test_split_local_without_number_returns_whole_string_as_name():
    # Los CDs de origen (Walmart) nunca traen número — mismo patrón que
    # cualquier local sin site_number en la planilla (Iansa/Sodimac/Colun).
    assert _split_local("CD LO AGUIRRE") == ("CD LO AGUIRRE", None)


def test_split_local_handles_empty():
    assert _split_local(None) == (None, None)
    assert _split_local("") == (None, None)


def test_normalize_location_name_strips_accents_and_case():
    assert _normalize_location_name("Curicó") == "CURICO"
    assert _normalize_location_name("  El   Belloto ") == "EL BELLOTO"


def _bucket_walmart():
    return {
        "by_number": {
            "87": [("SANTA ROSA", "RM")],
            # site_number repetido dentro del mismo shipper (caso real: 171)
            "171": [("LINARES", "Z0"), ("SAN BERNARDO EUCALIPTUS", "RM")],
        },
        "by_name": {
            "SANTA ROSA": "RM",
            "LINARES": "Z0",
            "SAN BERNARDO EUCALIPTUS": "RM",
        },
    }


def test_resolve_operation_type_by_number_when_unambiguous():
    assert _resolve_operation_type(_bucket_walmart(), "SANTA ROSA - 87") == "RM"


def test_resolve_operation_type_disambiguates_repeated_number_by_name():
    bucket = _bucket_walmart()
    assert _resolve_operation_type(bucket, "LINARES - 171") == "Z0"
    assert _resolve_operation_type(bucket, "SAN BERNARDO EUCALIPTUS - 171") == "RM"


def test_resolve_operation_type_disambiguates_by_containment_when_tms_adds_format_prefix():
    # Caso real verificado en vivo (2026-07-17, trip 0dc02dfc-...): el TMS
    # reporta "SBA San Bernardo Eucaliptus - 171" pero el nombre maestro en
    # public.locations es "San Bernardo Eucaliptus" (el formato "SBA" vive
    # en una columna aparte) — el match exacto normalizado falla, pero la
    # contención desambigua igual sin arriesgar el otro candidato ("Linares").
    bucket = _bucket_walmart()
    assert _resolve_operation_type(bucket, "SBA San Bernardo Eucaliptus - 171") == "RM"


def test_resolve_operation_type_unresolved_when_number_ambiguous_and_name_unknown():
    # Número repetido y el nombre del stop no matchea ninguno de los 2
    # candidatos — no hay forma segura de elegir, debe quedar sin resolver.
    bucket = _bucket_walmart()
    assert _resolve_operation_type(bucket, "OTRO NOMBRE - 171") is None


def test_resolve_operation_type_falls_back_to_name_when_no_number():
    bucket = _bucket_walmart()
    assert _resolve_operation_type(bucket, "Santa Rosa") == "RM"


def test_resolve_operation_type_none_when_no_match():
    bucket = _bucket_walmart()
    assert _resolve_operation_type(bucket, "CD LO AGUIRRE") is None


def test_resolve_operation_type_none_without_bucket_or_local():
    assert _resolve_operation_type(None, "SANTA ROSA - 87") is None
    assert _resolve_operation_type(_bucket_walmart(), None) is None


def test_apply_operation_types_sets_origin_and_per_stop():
    buckets = {"walmart": _bucket_walmart()}
    trip = {
        "client_name": "walmart",
        "origin": "CD LO AGUIRRE",
        "stops": [
            {"stop_id": "a", "local": "SANTA ROSA - 87"},
            {"stop_id": "b", "local": "LINARES - 171"},
        ],
    }
    _apply_operation_types(trip, buckets)
    assert trip["origin_operation_type"] is None
    assert trip["stops"][0]["operation_type"] == "RM"
    assert trip["stops"][1]["operation_type"] == "Z0"


def test_apply_operation_types_no_bucket_for_unknown_client():
    buckets = {"walmart": _bucket_walmart()}
    trip = {"client_name": "sodimac", "origin": None, "stops": [{"local": "SANTA ROSA - 87"}]}
    _apply_operation_types(trip, buckets)
    assert trip["origin_operation_type"] is None
    assert trip["stops"][0]["operation_type"] is None


@pytest.mark.asyncio
async def test_load_operation_type_buckets_scopes_by_shipper_and_skips_null_operation_type():
    pool = AsyncMock()
    pool.fetch.return_value = [
        {"shipper_name": "walmart", "name": "Santa Rosa", "site_number": "87", "operation_type": "RM"},
        {"shipper_name": "walmart", "name": "Linares", "site_number": "171", "operation_type": "Z0"},
        {"shipper_name": "iansa", "name": "Iansa Chillan", "site_number": None, "operation_type": "Region Sur"},
    ]
    buckets = await _load_operation_type_buckets(pool, {"walmart", "iansa"})
    assert _resolve_operation_type(buckets["walmart"], "SANTA ROSA - 87") == "RM"
    assert _resolve_operation_type(buckets["iansa"], "Iansa Chillan") == "Region Sur"
    # Nunca cruza entre shippers: un local de Iansa no debe resolver contra el bucket de Walmart
    assert _resolve_operation_type(buckets["walmart"], "Iansa Chillan") is None


@pytest.mark.asyncio
async def test_load_operation_type_buckets_empty_for_no_client_names():
    pool = AsyncMock()
    buckets = await _load_operation_type_buckets(pool, set())
    assert buckets == {}
    pool.fetch.assert_not_called()
