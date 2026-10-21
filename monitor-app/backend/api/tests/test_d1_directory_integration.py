"""D1 "Una sola respuesta", Task 5: el Directorio lee una sola respuesta
(spec 2026-10-12-directory-d1-one-answer-design.md §6.1).

La tira de cifras contaba conductores y equipos dados de baja (84 frente a 78,
F-03). La lista decía "pendiente" a las 251 empresas, con un criterio propio
que no era el de Pendientes (F-02). Contra Postgres de verdad, en una
transacción revertida."""
from __future__ import annotations

from datetime import timedelta

import pytest

from app.routers.carriers import (
    get_carrier, get_directorio, list_carrier_assets, list_carrier_drivers, list_carriers,
)
from tests import d1_subjects as s
from tests.conftest import PoolDeUnaConexion

pytestmark = pytest.mark.integracion


async def _flota_mixta(conn) -> dict:
    """Empresa activa con un conductor y un tracto activos, y otro de cada uno
    dado de baja que conserva su asignación ACTIVE."""
    c = await s.carrier(conn)
    f = {
        "carrier": c,
        "driver": await s.driver(conn, c),
        "inactive_driver": await s.driver(conn, c, status="INACTIVE"),
        "tractor": await s.asset(conn, c),
        "inactive_tractor": await s.asset(conn, c, status="INACTIVE"),
    }
    await s.without_seeding(conn, *f.values())
    return f


async def _lista(conn) -> dict:
    return await list_carriers(q=s.PREFIX, operational_status="", enablement="", shipper_id=None,
                               page=1, limit=100, pool=PoolDeUnaConexion(conn), _=None)


async def test_la_tira_del_directorio_cuenta_solo_la_flota_activa(conexion_revertida):
    conn = conexion_revertida
    pool = PoolDeUnaConexion(conn)
    antes = await get_directorio(pool=pool, _=None)

    await _flota_mixta(conn)
    despues = await get_directorio(pool=pool, _=None)

    assert despues["flota"]["conductores"] == antes["flota"]["conductores"] + 1, (
        "se contó a un conductor dado de baja")
    assert despues["flota"]["tractos"] == antes["flota"]["tractos"] + 1, (
        "se contó a un tracto dado de baja")


async def test_la_lista_trae_el_resumen_con_la_flota_activa(conexion_revertida):
    conn = conexion_revertida
    f = await _flota_mixta(conn)
    req = await s.requirement(conn, entity="DRIVER")
    await s.record(conn, req, "DRIVER", f["driver"])
    # El de baja está fuera de alcance: no cuenta ni bloquea.
    await s.record(conn, req, "DRIVER", f["inactive_driver"])

    fila = next(r for r in (await _lista(conn))["data"] if str(r["id"]) == f["carrier"])

    assert fila["compliance_summary"] == {
        "worst_state": "MISSING",
        "own": {"overdue": 0, "expiring": 0, "missing": 0},
        "fleet": {"overdue": 0, "expiring": 0, "missing": 1},
        "can_operate": False,
        "blocking": {"own": 0, "fleet": 1},
        "requirements_met": False,
    }
    # Lo viejo se retiró en la Task 16 (contraer, §9).
    assert not {"compliance_health", "pending_mandatory"} & set(fila)
    # Las columnas sueltas no viajan: la respuesta trae el resumen, no ocho campos planos.
    assert "own_missing" not in fila and "can_operate" not in fila


async def test_por_vencer_y_opcionales_no_quitan_la_habilitacion(conexion_revertida):
    """E-c: "por vencer" cuenta como al día. Los opcionales cuentan en las
    cifras pero no bloquean."""
    conn = conexion_revertida
    await s.thresholds(conn, warning=30, critical=0)
    hoy = await s.today(conn)
    c = await s.carrier(conn)
    await s.without_seeding(conn, c)
    obligatorio = await s.requirement(conn, entity="CARRIER")
    # CONDITIONAL_OPTIONAL: el nivel opcional que admite el CHECK.
    opcional = await s.requirement(conn, entity="CARRIER", level="CONDITIONAL_OPTIONAL")
    await s.record(conn, obligatorio, "CARRIER", c, status="APPROVED_MANUAL", expires=hoy + timedelta(days=10))
    await s.record(conn, opcional, "CARRIER", c)

    resumen = next(r for r in (await _lista(conn))["data"] if str(r["id"]) == c)["compliance_summary"]

    assert resumen["can_operate"] is True
    assert resumen["own"] == {"overdue": 0, "expiring": 1, "missing": 1}


async def test_una_empresa_dada_de_baja_nunca_esta_habilitada(conexion_revertida):
    """D1-R1: sus cifras se calculan (historial) y can_operate es false."""
    conn = conexion_revertida
    c = await s.carrier(conn, status="INACTIVE")
    await s.without_seeding(conn, c)

    resumen = next(r for r in (await _lista(conn))["data"] if str(r["id"]) == c)["compliance_summary"]

    assert resumen["can_operate"] is False


async def test_el_filtro_de_habilitacion_corre_en_el_servidor(conexion_revertida):
    """R-B14 (D-R6): Habilitada / No habilitada como filtro y faceta, con la
    misma regla que el resumen. Una empresa dada de baja no es ninguna de las dos."""
    conn = conexion_revertida
    habilitada = await s.carrier(conn)
    no_habilitada = await s.carrier(conn)
    de_baja = await s.carrier(conn, status="INACTIVE")
    await s.without_seeding(conn, habilitada, no_habilitada, de_baja)
    await s.record(conn, await s.requirement(conn, entity="CARRIER"), "CARRIER", no_habilitada)
    pool = PoolDeUnaConexion(conn)

    async def pedir(enablement: str) -> dict:
        return await list_carriers(q=s.PREFIX, operational_status="", enablement=enablement, shipper_id=None,
                                   page=1, limit=100, pool=pool, _=None)

    assert [str(r["id"]) for r in (await pedir("enabled"))["data"]] == [habilitada]
    solo_no = await pedir("not_enabled")
    assert [str(r["id"]) for r in solo_no["data"]] == [no_habilitada]
    assert solo_no["count"] == 1
    # Las facetas no dependen del filtro activo.
    assert (solo_no["facets"]["enabled"], solo_no["facets"]["not_enabled"], solo_no["facets"]["total"]) == (1, 1, 3)


async def test_la_ficha_trae_estado_dias_y_aviso_por_documento(conexion_revertida):
    conn = conexion_revertida
    await s.thresholds(conn, warning=30, critical=0)
    hoy = await s.today(conn)
    f = await _flota_mixta(conn)
    propio = await s.requirement(conn, entity="CARRIER")
    await s.record(conn, propio, "CARRIER", f["carrier"], status="APPROVED_MANUAL",
                   expires=hoy + timedelta(days=5))
    de_flota = await s.requirement(conn, entity="DRIVER")
    await s.record(conn, de_flota, "DRIVER", f["driver"])
    await s.record(conn, de_flota, "DRIVER", f["inactive_driver"])

    ficha = await get_carrier(f["carrier"], pool=PoolDeUnaConexion(conn), supabase=None, _=None)

    reg = next(r for r in ficha["compliance_records"] if str(r["requirement_id"]) == propio)
    assert (reg["document_state"], reg["days_to_expiry"], reg["alert_severity"]) == ("EXPIRING", 5, "warning")
    # `status` es el historial del archivo, no su vigencia (spec §3).
    assert reg["status"] == "APPROVED_MANUAL"
    assert ficha["compliance_summary"]["own"] == {"overdue": 0, "expiring": 1, "missing": 0}
    assert ficha["compliance_summary"]["fleet"] == {"overdue": 0, "expiring": 0, "missing": 1}
    assert ficha["compliance_summary"]["can_operate"] is False


async def test_el_roster_trae_el_resumen_de_cada_conductor(conexion_revertida):
    conn = conexion_revertida
    f = await _flota_mixta(conn)
    req = await s.requirement(conn, entity="DRIVER")
    await s.record(conn, req, "DRIVER", f["driver"])

    filas = {str(r["id"]): r for r in await list_carrier_drivers(
        f["carrier"], pool=PoolDeUnaConexion(conn), _=None)}

    assert filas[f["driver"]]["compliance_summary"] == {
        "worst_state": "MISSING",
        "own": {"overdue": 0, "expiring": 0, "missing": 1},
        "fleet": None,
        "can_operate": False,
        "blocking": {"own": 1, "fleet": None},
        "requirements_met": False,
    }
    # Dado de baja y sin pendientes: nada que deba, y aun así no habilitado (R-B2).
    de_baja = filas[f["inactive_driver"]]["compliance_summary"]
    assert (de_baja["worst_state"], de_baja["can_operate"]) == ("UP_TO_DATE", False)


async def test_el_roster_de_equipos_se_lee_en_vivo_y_trae_su_resumen(conexion_revertida):
    """R-B8: app.carrier_asset_roster no se refresca con public.assets. Dar de
    baja un tracto dejaba ACTIVE en la ficha, y can_operate saldría mal."""
    conn = conexion_revertida
    c = await s.carrier(conn)
    a = await s.asset(conn, c)
    await s.without_seeding(conn, c, a)
    await conn.execute("UPDATE public.assets SET operational_status = 'INACTIVE' WHERE id = $1", a)

    filas = await list_carrier_assets(c, pool=PoolDeUnaConexion(conn), _=None)

    assert [(str(r["id"]), r["operational_status"]) for r in filas] == [(a, "INACTIVE")]
    assert filas[0]["compliance_summary"]["can_operate"] is False
    assert "webcarga_operation_type_code" in filas[0]
    assert not {"compliance_health", "pending_mandatory"} & set(filas[0])


async def test_los_campos_viejos_ya_no_salen(conexion_revertida):
    """Despliegue 3 (spec §9, Task 16): lo retirado no vuelve. La lista, sus
    facetas y los dos rosters de una empresa con flota y un requisito."""
    conn = conexion_revertida
    f = await _flota_mixta(conn)
    await s.record(conn, await s.requirement(conn, entity="DRIVER"), "DRIVER", f["driver"])
    await s.record(conn, await s.requirement(conn, entity="ASSET"), "ASSET", f["tractor"])
    pool = PoolDeUnaConexion(conn)

    lista = await _lista(conn)
    fila = next(r for r in lista["data"] if str(r["id"]) == f["carrier"])
    assert "compliance_health" not in fila and "pending_mandatory" not in fila
    assert "compliance_summary" in fila
    assert set(lista["facets"]) == {"enabled", "not_enabled", "total"}

    conductores = await list_carrier_drivers(f["carrier"], pool=pool, _=None)
    equipos = await list_carrier_assets(f["carrier"], pool=pool, _=None)
    assert {str(r["id"]) for r in conductores} == {f["driver"], f["inactive_driver"]}
    assert {str(r["id"]) for r in equipos} == {f["tractor"], f["inactive_tractor"]}
    for r in [*conductores, *equipos]:
        assert "compliance_health" not in r and "pending_mandatory" not in r
        assert "compliance_summary" in r
    # El requisito sembrado sí llega, por el resumen y no por un campo plano.
    por_id = {str(r["id"]): r for r in [*conductores, *equipos]}
    assert por_id[f["driver"]]["compliance_summary"]["own"]["missing"] == 1
    assert por_id[f["tractor"]]["compliance_summary"]["own"]["missing"] == 1


async def test_la_lista_pone_primero_las_no_habilitadas(conexion_revertida):
    """Sin compliance_health el orden sale del resumen: activas que no pueden
    operar primero, después por nombre. Una dada de baja no es No habilitada."""
    conn = conexion_revertida
    habilitada = await s.carrier(conn)
    de_baja = await s.carrier(conn, status="INACTIVE")
    no_habilitada = await s.carrier(conn)
    await s.without_seeding(conn, habilitada, de_baja, no_habilitada)
    # Nombres en el orden contrario al esperado: el nombre solo desempata.
    for nombre, cid in (("A", habilitada), ("B", de_baja), ("C", no_habilitada)):
        await conn.execute("UPDATE public.carriers SET business_name = $1 WHERE id = $2",
                           f"{s.PREFIX} {nombre} orden", cid)
    await s.record(conn, await s.requirement(conn, entity="CARRIER"), "CARRIER", no_habilitada)

    ids = [str(r["id"]) for r in (await _lista(conn))["data"]]

    assert ids == [no_habilitada, habilitada, de_baja]
