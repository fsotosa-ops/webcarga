"""D1: el glosario de estados del backend (app/schemas/states.py) no se desalinea
de la definición de cada estado (services/vencimientos.py) ni de los schemas."""
from typing import get_args

import pytest
from pydantic import ValidationError

from app.schemas import asset, carrier, driver
from app.schemas.states import (
    BlockingCounts,
    BLOCKING_STATES, SEVERITY_ORDER, CarrierLifecycle, ComplianceSummary, DocumentState, FleetLifecycle,
    StateCounts,
)
from app.services.vencimientos import DOCUMENT_STATES, PENDING_STATES


def test_los_estados_del_glosario_son_los_que_calcula_document_state_sql():
    assert set(get_args(DocumentState)) == set(DOCUMENT_STATES)


def test_el_orden_de_severidad_cubre_todo_menos_lo_que_aun_no_se_exige():
    assert set(SEVERITY_ORDER) == set(DOCUMENT_STATES) - {"NOT_REQUIRED"}
    assert SEVERITY_ORDER[0] == "OVERDUE" and SEVERITY_ORDER[-1] == "UP_TO_DATE"


def test_por_vencer_no_bloquea_y_pendientes_sigue_igual():
    assert BLOCKING_STATES == ("OVERDUE", "MISSING")
    assert PENDING_STATES == ("OVERDUE", "EXPIRING", "MISSING")
    assert set(BLOCKING_STATES) < set(PENDING_STATES)


def test_los_schemas_usan_el_ciclo_de_vida_del_glosario():
    assert carrier.OperationalStatus is CarrierLifecycle
    assert driver.OperationalStatus is FleetLifecycle
    assert asset.OperationalStatus is FleetLifecycle


def test_el_resumen_rechaza_un_estado_fuera_del_glosario():
    with pytest.raises(ValidationError):
        ComplianceSummary(worst_state="CRITICAL", own=StateCounts(), can_operate=True, blocking=BlockingCounts())


def test_el_resumen_sin_flota_es_de_conductor_o_equipo():
    resumen = ComplianceSummary(worst_state="UP_TO_DATE", own=StateCounts(), can_operate=True, blocking=BlockingCounts())
    assert resumen.fleet is None
    assert resumen.own.model_dump() == {"overdue": 0, "expiring": 0, "missing": 0}
