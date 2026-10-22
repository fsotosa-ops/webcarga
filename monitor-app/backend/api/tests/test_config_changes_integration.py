"""Quién cambió qué en Configuración (spec 2026-10-22-configuracion-orden-visual §3.3).

Cada guardado escribe en public.audit_log; la pantalla muestra el último cambio por
elemento. Reemplaza la "revisión" como trazabilidad. Contra Postgres, transacción
revertida."""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from tests.conftest import PoolDeUnaConexion, _usuario_real, usuario

pytestmark = pytest.mark.integracion


def test_entity_uuid_es_estable_y_distinto():
    from app.services.config_changes import entity_uuid
    a = entity_uuid("operations", "alert-thresholds", "stale_report_hours")
    assert a == entity_uuid("operations", "alert-thresholds", "stale_report_hours")
    assert uuid.UUID(a)
    assert a != entity_uuid("operations", "alert-thresholds", "tms_dropped_hours")
    assert a != entity_uuid("operations", "temperature-ranges", "stale_report_hours")
    assert a != entity_uuid("insurance", "alert-thresholds", "stale_report_hours")


async def test_registrar_y_leer_el_ultimo_cambio(conexion_revertida):
    from app.routers.config import list_config_changes
    from app.services.config_changes import registrar_cambio
    conn = conexion_revertida
    primero = await _usuario_real(conn)
    otro = await conn.fetchrow("SELECT id, full_name FROM public.profiles WHERE id <> $1::uuid LIMIT 1", primero["sub"])
    pool = PoolDeUnaConexion(conn)
    await registrar_cambio(pool, actor=primero["sub"], area="operations", section="temperature-ranges",
                           element_id="zz_test", action="update", before={"min_c": 1}, after={"min_c": 2})
    await registrar_cambio(pool, actor=str(otro["id"]), area="operations", section="temperature-ranges",
                           element_id="zz_test", action="update", before={"min_c": 2}, after={"min_c": 3})

    filas = await list_config_changes(area="operations", section="temperature-ranges", pool=pool, usuario=primero)
    nuestras = [f for f in filas if f["element_id"] == "zz_test"]

    assert len(nuestras) == 1
    assert nuestras[0]["actor_name"] == otro["full_name"]
    assert nuestras[0]["changed_at"]


async def test_cambios_de_configuracion_no_incluye_accesos(conexion_revertida):
    from app.routers.config import list_config_changes
    sin_accesos = usuario("operations_operator")
    # Personas y Roles tienen su propia ruta (exige users.manage); aquí no son una sección.
    with pytest.raises(HTTPException) as e:
        await list_config_changes(area="people", section="users", pool=PoolDeUnaConexion(conexion_revertida),
                                  usuario=sin_accesos)
    assert e.value.status_code == 422


async def test_cambios_rechaza_una_seccion_desconocida(conexion_revertida):
    from app.routers.config import list_config_changes
    with pytest.raises(HTTPException) as e:
        await list_config_changes(area="operations", section="no-existe", pool=PoolDeUnaConexion(conexion_revertida),
                                  usuario=usuario("admin"))
    assert e.value.status_code == 422


# ── Task 2: cada ajuste guardado queda registrado ─────────────────────────────

async def _ultimas(conn, area, section, element_id):
    return await conn.fetch(
        "SELECT action, old_value, new_value, actor FROM public.audit_log "
        "WHERE entity_type = $1 AND new_value->>'element_id' = $2 ORDER BY id",
        f"config:{area}/{section}", element_id)


async def test_patch_status_registra_antes_y_despues(conexion_revertida):
    import json
    from app.routers.config import TripStatusPatch, patch_status
    conn = conexion_revertida
    actor = await _usuario_real(conn)
    estado = await conn.fetchrow("SELECT id, label FROM app.trip_statuses LIMIT 1")

    await patch_status(estado["id"], TripStatusPatch(label="ZZ etiqueta"), pool=PoolDeUnaConexion(conn), usuario=actor)

    filas = await _ultimas(conn, "operations", "tms-statuses", estado["id"])
    assert len(filas) == 1 and filas[0]["action"] == "update"
    assert json.loads(filas[0]["old_value"]) == {"label": estado["label"]}
    assert json.loads(filas[0]["new_value"])["label"] == "ZZ etiqueta"
    assert str(filas[0]["actor"]) == actor["sub"]


async def test_taxonomia_crear_y_desactivar_registran(conexion_revertida):
    from app.routers.status_taxonomies import StatusTaxonomyBody, create_taxonomy, deactivate_taxonomy
    conn = conexion_revertida
    actor = await _usuario_real(conn)
    pool = PoolDeUnaConexion(conn)

    nueva = await create_taxonomy(StatusTaxonomyBody(domain="DRIVER_REASON", label="ZZ motivo", sort_order=999,
                                                     group_id="no_trabajando"), pool=pool, usuario=actor)
    await deactivate_taxonomy(str(nueva["id"]), pool=pool, usuario=actor)

    acciones = [f["action"] for f in await _ultimas(conn, "operations", "driver-reasons", str(nueva["id"]))]
    assert acciones == ["create", "delete"]


async def test_regla_del_monitor_registra_por_regla(conexion_revertida):
    import json
    from app.routers.config import MonitorAlertRulesPatch, patch_monitor_alert_rules
    conn = conexion_revertida
    actor = await _usuario_real(conn)
    antes = await conn.fetchval("SELECT dwell_red_min FROM app.monitor_alert_rules WHERE id = 1")

    await patch_monitor_alert_rules(MonitorAlertRulesPatch(dwell_red_min=antes + 5), pool=PoolDeUnaConexion(conn), usuario=actor)

    filas = await _ultimas(conn, "operations", "alert-thresholds", "dwell_red_min")
    assert len(filas) == 1
    assert json.loads(filas[0]["old_value"]) == {"dwell_red_min": antes}
    assert json.loads(filas[0]["new_value"])["dwell_red_min"] == antes + 5
