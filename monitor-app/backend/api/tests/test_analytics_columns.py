"""El catálogo de columnas de Analítica (plan del módulo, Task 3).

Una columna existe una sola vez, en services/analytics_columns.py: de ahí salen la lista que ve el frontend, el
SQL de la consulta y el Excel. Los datos personales (nombre y RUT del conductor) solo con su permiso."""
from __future__ import annotations

import re

import pytest

from app.routers.analytics import list_columns
from app.services.analytics_columns import COLUMNS, TABLES, columns_for

from .conftest import usuario

PERSONALES = {"driver_name", "driver_tax_id"}


@pytest.mark.integracion
@pytest.mark.parametrize("dataset", ["trips", "fleet"])
async def test_cada_columna_existe_en_su_tabla(conexion_revertida, dataset):
    for c in COLUMNS[dataset]:
        await conexion_revertida.execute(
            f"SELECT {c.sql} FROM {TABLES[dataset]} r "
            "LEFT JOIN analytics.driver_identity p ON p.driver_id = r.driver_id LIMIT 0")


@pytest.mark.parametrize("dataset", ["trips", "fleet"])
def test_sin_permiso_no_hay_columnas_personales(dataset):
    assert not [c for c in columns_for(dataset, personal=False) if c.personal]
    assert {c.id for c in columns_for(dataset, personal=True) if c.personal} == PERSONALES


@pytest.mark.parametrize("dataset", ["trips", "fleet"])
def test_ids_unicos_y_seguros(dataset):
    ids = [c.id for c in COLUMNS[dataset]]
    assert len(ids) == len(set(ids))
    assert all(re.fullmatch(r"[a-z0-9_]{1,40}", i) for i in ids)


async def test_el_endpoint_respeta_el_permiso():
    sin = {c["id"] for c in await list_columns(dataset="trips", user=usuario("operations_supervisor"))}
    con = {c["id"] for c in await list_columns(dataset="trips", user=usuario("admin"))}
    assert not sin & PERSONALES
    assert PERSONALES <= con
    # El permiso es privilegiado: sin verificación en dos pasos, tampoco.
    sin_mfa = {c["id"] for c in await list_columns(dataset="trips", user=usuario("admin", aal="aal1"))}
    assert not sin_mfa & PERSONALES


async def test_el_catalogo_dice_cuales_son_personales():
    """Fix pass: "BDOT completo" es todas las columnas que NO son personales (HU, criterio 10)."""
    con = {c["id"]: c for c in await list_columns(dataset="trips", user=usuario("admin"))}
    assert con["driver_name"]["personal"] is True and con["trip_code"]["personal"] is False


async def test_lo_personal_no_se_muestra_por_defecto():
    """Humo en dev (22/10): el Propietario veía Conductor y RUT entre las columnas de entrada. Se eligen a
    propósito en Columnas."""
    con = {c["id"]: c for c in await list_columns(dataset="trips", user=usuario("admin"))}
    assert con["driver_name"]["default_visible"] is False and con["driver_tax_id"]["default_visible"] is False
