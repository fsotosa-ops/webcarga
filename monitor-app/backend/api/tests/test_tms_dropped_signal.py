"""Señal "El TMS dejó de reportarlo" (Ronda 126).

Un viaje se marca cuando su TMS siguió corriendo durante N horas sin traerlo.
La comparación es contra la ÚLTIMA CORRIDA DE SU PROPIA TMS
(max(status_reported_at) de esa fuente), no contra now() — ésa es toda la
diferencia con la señal `stale`, y es lo que estos tests fijan.

Origen: Sodimac elimina viajes de su portal sin cambiar el estado; quedan en
"asignado" para siempre y molestan el cierre. Hasta la Ronda 126 esa ausencia
no quedaba registrada en ninguna parte.
"""

from datetime import datetime

from app.routers.trips import _tms_dropped, _TMS_DROPPED_DEFAULT_HOURS

# `status_reported_at` es `timestamp without time zone` en app.trips: los dos
# lados de la resta salen de esa misma columna, así que los naive de acá son
# fieles a lo que devuelve asyncpg, no una simplificación del test.
ULTIMA_CORRIDA = datetime(2026, 8, 18, 15, 46, 0)
CTX = ({"sodimac": ULTIMA_CORRIDA}, 3.0)


def viaje(**kw):
    base = {
        "source_system": "sodimac",
        "current_status": "ASIGNADO",
        "status_reported_at": ULTIMA_CORRIDA,
    }
    base.update(kw)
    return base


def test_traido_por_la_ultima_corrida_no_se_marca():
    assert _tms_dropped(viaje(), CTX) is False


def test_dentro_del_umbral_no_se_marca():
    # Dos horas atrás, con umbral de tres.
    assert _tms_dropped(viaje(status_reported_at=datetime(2026, 8, 18, 13, 46, 0)), CTX) is False


def test_pasado_el_umbral_se_marca():
    # Caso real: el viaje 841584 quedó en el archivo del 14/08 mientras Sodimac
    # siguió corriendo hasta el 18/08.
    assert _tms_dropped(viaje(status_reported_at=datetime(2026, 8, 14, 17, 33, 0)), CTX) is True


def test_el_umbral_es_estricto_en_el_borde():
    # Exactamente 3 h no alcanza; un minuto más sí. Fija el `>` del predicado.
    assert _tms_dropped(viaje(status_reported_at=datetime(2026, 8, 18, 12, 46, 0)), CTX) is False
    assert _tms_dropped(viaje(status_reported_at=datetime(2026, 8, 18, 12, 45, 0)), CTX) is True


def test_viaje_cerrado_nunca_se_marca():
    # Que un viaje terminado deje de reportarse es lo normal. Mismo criterio
    # que isOpenTrip() en kpis.ts.
    viejo = datetime(2026, 8, 1, 0, 0, 0)
    for estado in ("CERRADO FINALIZADO", "CERRADO MANUAL", "CANCELADO", "Declinada", "Removida"):
        assert _tms_dropped(viaje(current_status=estado, status_reported_at=viejo), CTX) is False


def test_sin_status_reported_at_se_apaga_en_vez_de_asumir():
    assert _tms_dropped(viaje(status_reported_at=None), CTX) is False


def test_fuente_sin_corridas_se_apaga():
    # 'manual' no tiene última corrida: no hay TMS que haya dejado de reportar.
    assert _tms_dropped(viaje(source_system="manual", status_reported_at=datetime(2026, 1, 1)), CTX) is False


def test_cada_tms_se_compara_contra_su_propia_corrida():
    # El punto central: que Sodimac esté atrasada no marca los viajes de
    # QAnalytics, ni al revés. Si la comparación fuera contra now(), un TMS
    # lento contaminaría al otro.
    ctx = (
        {"sodimac": ULTIMA_CORRIDA, "qanalytics": datetime(2026, 8, 18, 15, 40, 0)},
        3.0,
    )
    reportado = datetime(2026, 8, 18, 15, 30, 0)
    assert _tms_dropped(viaje(source_system="qanalytics", status_reported_at=reportado), ctx) is False
    ctx_sodimac_muy_adelantada = ({"qanalytics": datetime(2026, 8, 19, 0, 0, 0)}, 3.0)
    assert _tms_dropped(viaje(source_system="qanalytics", status_reported_at=reportado), ctx_sodimac_muy_adelantada) is True


def test_el_default_coincide_con_el_valor_de_la_migracion():
    # Si alguien cambia uno sin el otro, un deploy a mitad de camino (columna
    # todavía sin crear) alertaría con un criterio distinto al configurado.
    assert _TMS_DROPPED_DEFAULT_HOURS == 3.0


# ── /trips/meta expone lo que la señal necesita ──────────────────────────────

from unittest.mock import AsyncMock, MagicMock  # noqa: E402

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.auth import get_current_user, get_supabase, require_editor  # noqa: E402
from app.db import get_pool  # noqa: E402
from app.routers.trips import router  # noqa: E402

USER = {"sub": "11111111-1111-1111-1111-111111111111", "email": "op@webcarga.cl", "role": "editor"}


def _meta_client(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_supabase] = lambda: MagicMock()
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    return TestClient(app)


def test_meta_expone_last_run_at_por_tms_y_el_umbral():
    pool = AsyncMock()

    def fetch(query, *a, **k):
        if "max(status_reported_at)" in query:
            return [
                {"source_system": "sodimac", "last_run_at": ULTIMA_CORRIDA},
                {"source_system": "qanalytics", "last_run_at": datetime(2026, 8, 18, 15, 40, 0)},
            ]
        return []

    pool.fetch.side_effect = fetch
    pool.fetchrow.return_value = {
        "stale_report_hours": 2, "dwell_hours": 2, "late_arrival_grace_min": 60,
        "unassigned_enabled": True, "dwell_yellow_min": 60, "dwell_orange_min": 90,
        "dwell_red_min": 120, "tms_dropped_hours": 3,
    }

    res = _meta_client(pool).get("/api/v1/trips/meta")
    assert res.status_code == 200
    body = res.json()

    # El umbral viaja al frontend para que el label de la señal lo muestre.
    assert body["monitor_alert_rules"]["tms_dropped_hours"] == 3

    por_id = {t["id"]: t for t in body["tms_sources"]}
    assert por_id["sodimac"]["last_run_at"].startswith("2026-08-18T15:46")
    assert por_id["qanalytics"]["last_run_at"].startswith("2026-08-18T15:40")
    # 'manual' no ingesta desde ningún portal: sin corridas, la señal se apaga.
    assert por_id["manual"]["last_run_at"] is None
