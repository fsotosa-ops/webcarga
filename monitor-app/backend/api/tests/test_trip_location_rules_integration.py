"""Las reglas de lugar del viaje en la base (migración 20261101090000, diseño de Analítica 21/10).

Los casos son los que probaban el Python (test_trip_operation_type.py, casos reales de Walmart) más el último
destino vigente. Escritos a mano a propósito: un error en la función no puede pasar el test."""
from __future__ import annotations

import json
import uuid
from datetime import date

import pytest

pytestmark = pytest.mark.integracion


async def _shipper(conn, locales: list[tuple[str, str | None, str | None]]) -> str:
    """Un cliente con sus locales (nombre, número, tipo de operación)."""
    shipper = str(await conn.fetchval(
        "INSERT INTO public.shippers (name, status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"ZZ-TEST-LUGAR {uuid.uuid4().hex[:6]}"))
    for nombre, numero, tipo in locales:
        await conn.execute(
            "INSERT INTO public.locations (entity_type, entity_id, name, site_number, operation_type, operational_status) "
            "VALUES ('SHIPPER', $1::uuid, $2, $3, $4, 'ACTIVE')", shipper, nombre, numero, tipo)
    return shipper


WALMART = [
    ("Santa Rosa", "87", "RM"),
    # Número repetido dentro del mismo cliente (caso real: 171).
    ("Linares", "171", "Z0"),
    ("San Bernardo Eucaliptus", "171", "RM"),
    ("Curicó, Camilo Henríquez", "279", "Region Sur"),
    ("El Belloto", None, "Region Norte"),
]


@pytest.mark.parametrize("local,esperado", [
    ("SANTA ROSA - 87", "RM"),                         # por número, sin ambigüedad
    ("LINARES - 171", "Z0"),                           # número repetido: desempata el nombre
    ("SAN BERNARDO EUCALIPTUS - 171", "RM"),
    ("SBA San Bernardo Eucaliptus - 171", "RM"),       # el TMS antepone el formato: desempata la contención
    ("OTRO NOMBRE - 171", None),                       # número repetido y nombre desconocido: sin resolver
    ("Santa Rosa", "RM"),                              # sin número: por nombre
    ("  el   belloto ", "Region Norte"),               # nombre con espacios y minúsculas
    ("CURICO, CAMILO HENRIQUEZ - 279", "Region Sur"),  # sin tildes contra el maestro con tildes
    ("Santa Rosa - 999", "RM"),                        # número que el cliente no tiene: por nombre
    ("CD LO AGUIRRE", None),                           # ni número ni nombre conocido
    ("", None),
    (None, None),
])
async def test_el_tipo_de_operacion_de_un_local(conexion_revertida, local, esperado):
    shipper = await _shipper(conexion_revertida, WALMART)
    assert await conexion_revertida.fetchval("SELECT app.location_operation_type($1::uuid, $2)", shipper, local) == esperado


async def test_nunca_cruza_clientes(conexion_revertida):
    walmart = await _shipper(conexion_revertida, WALMART)
    iansa = await _shipper(conexion_revertida, [("Iansa Chillan", None, "Region Sur")])
    f = "SELECT app.location_operation_type($1::uuid, $2)"
    assert await conexion_revertida.fetchval(f, iansa, "Iansa Chillan") == "Region Sur"
    assert await conexion_revertida.fetchval(f, walmart, "Iansa Chillan") is None
    assert await conexion_revertida.fetchval(f, None, "Santa Rosa - 87") is None


async def test_un_nombre_con_dos_tipos_queda_sin_resolver(conexion_revertida):
    # Mismo nombre, dos locales con número distinto y tipo distinto: por nombre no hay cómo elegir.
    shipper = await _shipper(conexion_revertida, [("Talca", "10", "RM"), ("TALCA", "11", "Z0")])
    assert await conexion_revertida.fetchval("SELECT app.location_operation_type($1::uuid, 'Talca')", shipper) is None


async def test_la_zona_agrupa_los_tipos(conexion_revertida):
    filas = await conexion_revertida.fetch(
        "SELECT t, app.operation_type_zone(t) AS z FROM unnest(ARRAY['RM','Z0','Region Norte','Region Sur',NULL,'Otro']) t")
    assert [f["z"] for f in filas] == ["RM", "Z0", "Región", "Región", "Sin clasificar", "Sin clasificar"]


async def _viaje(conn, shipper, vigentes: list[str] | None, filas: list[tuple[int, str, str]]) -> uuid.UUID:
    """Un viaje con su lista vigente de destinos (app.trips.stops) y sus filas en trip_stops."""
    viaje = uuid.uuid4()
    stops = json.dumps([{"stop_id": f"v{i}", "local": l} for i, l in enumerate(vigentes)]) if vigentes is not None else None
    await conn.execute(
        "INSERT INTO app.trips (id, planning_date, client_name, source_system, source_system_trip_id, trip_status, "
        "is_active, is_assigned, shipper_id, stops) VALUES ($1, $2, 'X', 'manual', $3, 'Asignado', true, true, $4::uuid, $5::jsonb)",
        viaje, date(2026, 6, 11), f"ZZ-LUGAR-{viaje.hex[:6]}", shipper, stops)
    for orden, tipo, local in filas:
        await conn.execute(
            "INSERT INTO app.trip_stops (stop_id, trip_id, stop_order, stop_type, local) VALUES ($1, $2, $3, $4, $5)",
            f"zz-{viaje.hex[:8]}-{orden}-{tipo}", viaje, orden, tipo, local)
    return viaje


async def test_el_ultimo_destino_es_el_de_la_lista_vigente(conexion_revertida):
    """trip_stops guarda la versión vieja de una parada (el TMS cambió de base): no es el destino."""
    conn = conexion_revertida
    shipper = await _shipper(conn, WALMART)
    viaje = await _viaje(conn, shipper, ["SANTA ROSA - 87", "LINARES - 171"], [
        (0, "ORIGIN", "CD LO AGUIRRE"),
        (1, "DESTINATION", "SANTA ROSA - 87"),
        (2, "DESTINATION", "LINARES - 171"),
        (3, "DESTINATION", "EL BELLOTO"),  # versión vieja, con el mayor stop_order
    ])
    fila = await conn.fetchrow(
        "SELECT app.trip_origin_local($1) AS o, app.trip_last_destination_local($1) AS d, "
        "app.trip_destination_zone($1) AS z", viaje)
    assert (fila["o"], fila["d"], fila["z"]) == ("CD LO AGUIRRE", "LINARES - 171", "Z0")


async def test_sin_lista_vigente_usa_la_ultima_parada(conexion_revertida):
    conn = conexion_revertida
    shipper = await _shipper(conn, WALMART)
    viaje = await _viaje(conn, shipper, None, [(1, "DESTINATION", "SANTA ROSA - 87"), (2, "DESTINATION", "EL BELLOTO")])
    assert await conn.fetchval("SELECT app.trip_destination_zone($1)", viaje) == "Región"


async def test_el_origen_es_la_primera_parada_de_origen(conexion_revertida):
    """Sodimac es multiorigen: varias paradas ORIGIN reales; el origen es la primera."""
    conn = conexion_revertida
    viaje = await _viaje(conn, None, [], [(1, "ORIGIN", "BODEGA 2"), (0, "ORIGIN", "BODEGA 1")])
    assert await conn.fetchval("SELECT app.trip_origin_local($1)", viaje) == "BODEGA 1"
    assert await conn.fetchval("SELECT app.trip_destination_zone($1)", viaje) == "Sin clasificar"
