"""Vistas guardadas de Analítica (plan del módulo, Task 6): personales y compartidas, quién edita, y que una vista
compartida no filtre datos personales a quien no tiene el permiso."""
from __future__ import annotations

import json

import pytest
from fastapi import HTTPException

from app.routers.analytics_views import (
    SavedViewBody, SavedViewPatch, create_view, delete_view, list_views, update_view,
)
from app.routers.table_preferences import TablePreferencesBody

from .conftest import PoolDeUnaConexion, _usuario_real, con_roles

pytestmark = pytest.mark.integracion

VISTA = {"filters": {}, "q": "", "sort": None, "period": {"preset": "last_30d"}, "date_field": "planning"}


async def _dos_usuarios(conn):
    """Dos personas reales distintas (audit_log y saved_views referencian auth.users)."""
    filas = await conn.fetch("SELECT id::text FROM auth.users ORDER BY created_at LIMIT 2")
    assert len(filas) == 2, "la copia local necesita dos usuarios"
    base = await _usuario_real(conn)
    return ({**con_roles(base, "operations_operator"), "sub": filas[0]["id"]},
            {**con_roles(base, "operations_operator"), "sub": filas[1]["id"]})


def _cuerpo(nombre, scope="personal", dataset="trips", columnas=("trip_code",)):
    return SavedViewBody(dataset=dataset, name=nombre, scope=scope, view=VISTA,
                         columns=[{"id": c, "hidden": False} for c in columnas])


async def test_personal_solo_la_ve_su_dueno(conexion_revertida):
    pool = PoolDeUnaConexion(conexion_revertida)
    ana, beto = await _dos_usuarios(conexion_revertida)
    await create_view(_cuerpo("ZZ mía"), pool=pool, user=ana)
    assert "ZZ mía" in {v["name"] for v in await list_views(dataset="trips", pool=pool, user=ana)}
    assert "ZZ mía" not in {v["name"] for v in await list_views(dataset="trips", pool=pool, user=beto)}


async def test_compartir_exige_manage_views(conexion_revertida):
    pool = PoolDeUnaConexion(conexion_revertida)
    ana, _ = await _dos_usuarios(conexion_revertida)
    with pytest.raises(HTTPException) as exc:
        await create_view(_cuerpo("ZZ equipo", scope="shared"), pool=pool, user=ana)
    assert exc.value.status_code == 403
    supervisor = con_roles(ana, "operations_supervisor")
    creada = await create_view(_cuerpo("ZZ equipo", scope="shared"), pool=pool, user=supervisor)
    assert creada["scope"] == "shared"


async def test_nombre_repetido_es_409(conexion_revertida):
    pool = PoolDeUnaConexion(conexion_revertida)
    ana, _ = await _dos_usuarios(conexion_revertida)
    await create_view(_cuerpo("ZZ dup"), pool=pool, user=ana)
    with pytest.raises(HTTPException) as exc:
        await create_view(_cuerpo("ZZ dup"), pool=pool, user=ana)
    assert exc.value.status_code == 409


async def test_columna_fuera_del_catalogo_es_422(conexion_revertida):
    pool = PoolDeUnaConexion(conexion_revertida)
    ana, _ = await _dos_usuarios(conexion_revertida)
    with pytest.raises(HTTPException) as exc:
        await create_view(_cuerpo("ZZ mala", columnas=("no_existe",)), pool=pool, user=ana)
    assert exc.value.status_code == 422


async def test_las_sembradas_existen(conexion_revertida):
    pool = PoolDeUnaConexion(conexion_revertida)
    ana, _ = await _dos_usuarios(conexion_revertida)
    viajes = {v["name"]: v for v in await list_views(dataset="trips", pool=pool, user=ana)}
    flota = {v["name"]: v for v in await list_views(dataset="fleet", pool=pool, user=ana)}
    assert {"BDOT completo", "Operación por cliente"} <= set(viajes)
    assert "F30-1" in flota
    assert all(v["scope"] == "shared" and v["can_edit"] is False for v in [*viajes.values(), *flota.values()]
               if v["name"] in {"BDOT completo", "Operación por cliente", "F30-1"})


async def test_f30_sin_permiso_personal_no_trae_rut(conexion_revertida):
    pool = PoolDeUnaConexion(conexion_revertida)
    ana, _ = await _dos_usuarios(conexion_revertida)
    sin = {v["name"]: v for v in await list_views(dataset="fleet", pool=pool, user=ana)}["F30-1"]
    con = {v["name"]: v for v in await list_views(dataset="fleet", pool=pool, user=con_roles(ana, "admin"))}["F30-1"]
    assert not {"driver_name", "driver_tax_id"} & {c["id"] for c in sin["columns"]}
    assert {"driver_name", "driver_tax_id"} <= {c["id"] for c in con["columns"]}


def test_preferencias_aceptan_80_columnas():
    TablePreferencesBody(columns=[{"id": f"c{i}", "hidden": False} for i in range(80)])
    with pytest.raises(ValueError):
        TablePreferencesBody(columns=[{"id": f"c{i}", "hidden": False} for i in range(81)])


# ── Fix pass de la revisión final ─────────────────────────────────────────────

async def test_guardar_sin_permiso_personal_no_borra_las_columnas_personales(conexion_revertida):
    """I3: un supervisor sin datos personales guarda F30-1; Conductor y RUT siguen ahí para quien los ve."""
    pool = PoolDeUnaConexion(conexion_revertida)
    ana, _ = await _dos_usuarios(conexion_revertida)
    admin = con_roles(ana, "admin")
    f30 = {v["name"]: v for v in await list_views(dataset="fleet", pool=pool, user=admin)}["F30-1"]
    otra = con_roles(ana, "admin")
    # El que guarda no ve personales (sin MFA): manda solo lo que ve.
    sin_mfa = {**otra, "aal": "aal1"}
    await update_view(f30["id"], SavedViewPatch(columns=[c for c in f30["columns"] if c["id"] not in
                      {"driver_name", "driver_tax_id"}]), pool=pool, user=sin_mfa)
    despues = {v["name"]: v for v in await list_views(dataset="fleet", pool=pool, user=admin)}["F30-1"]
    assert [c["id"] for c in despues["columns"]] == [c["id"] for c in f30["columns"]]


async def test_orden_y_filtros_personales_no_viajan_sin_permiso(conexion_revertida):
    """I2: una vista compartida ordenada o filtrada por una columna personal abre sin ella para quien no la ve."""
    pool = PoolDeUnaConexion(conexion_revertida)
    ana, _ = await _dos_usuarios(conexion_revertida)
    admin = con_roles(ana, "admin")
    vista = {**VISTA, "sort": {"column": "driver_name", "dir": "asc"}, "filters": {"driver_name": ["X"],
                                                                                  "subject_type": ["DRIVER"]}}
    creada = await create_view(SavedViewBody(dataset="fleet", name="ZZ ordenada", scope="shared", view=vista,
                                             columns=[{"id": "carrier_name", "hidden": False}]), pool=pool, user=admin)
    sup = con_roles(ana, "operations_supervisor")
    vista_sup = {v["name"]: v for v in await list_views(dataset="fleet", pool=pool, user=sup)}["ZZ ordenada"]
    assert vista_sup["view"]["sort"] is None
    assert vista_sup["view"]["filters"] == {"subject_type": ["DRIVER"]}
    assert creada["view"]["sort"] == {"column": "driver_name", "dir": "asc"}


async def test_compartidas_las_edita_su_dueno_o_un_administrador(conexion_revertida):
    """M1 (HU, criterio 9): otro supervisor no edita una compartida ajena ni una sembrada; un administrador sí."""
    pool = PoolDeUnaConexion(conexion_revertida)
    ana, beto = await _dos_usuarios(conexion_revertida)
    compartida = await create_view(_cuerpo("ZZ de ana", scope="shared"), pool=pool,
                                   user=con_roles(ana, "operations_supervisor"))
    with pytest.raises(HTTPException) as exc:
        await update_view(compartida["id"], SavedViewPatch(name="ZZ x"), pool=pool,
                          user=con_roles(beto, "operations_supervisor"))
    assert exc.value.status_code == 403
    editada = await update_view(compartida["id"], SavedViewPatch(name="ZZ y"), pool=pool, user=con_roles(beto, "admin"))
    assert editada["name"] == "ZZ y"
    sembrada = {v["name"]: v for v in await list_views(dataset="trips", pool=pool,
                                                       user=con_roles(beto, "operations_supervisor"))}["BDOT completo"]
    assert sembrada["can_edit"] is False


async def test_una_sembrada_no_se_vuelve_personal(conexion_revertida):
    """M2: era un 500 (CHECK de la tabla)."""
    pool = PoolDeUnaConexion(conexion_revertida)
    ana, _ = await _dos_usuarios(conexion_revertida)
    bdot = {v["name"]: v for v in await list_views(dataset="trips", pool=pool, user=con_roles(ana, "admin"))}["BDOT completo"]
    with pytest.raises(HTTPException) as exc:
        await update_view(bdot["id"], SavedViewPatch(scope="personal"), pool=pool, user=con_roles(ana, "admin"))
    assert exc.value.status_code == 422
