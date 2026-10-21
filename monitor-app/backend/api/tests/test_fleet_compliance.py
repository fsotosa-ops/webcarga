"""D1: las piezas de app/services/fleet_compliance.py que no necesitan la base."""
import pytest

from app.routers import compliance
from app.services.fleet_compliance import (
    carrier_compliance_cte, entity_compliance_cte, pending_base_ctes, summary_from_row,
)

_SIN_NADA_EMPRESA = {"worst_state": None, "own_overdue": None, "own_expiring": None, "own_missing": None,
                     "fleet_overdue": None, "fleet_expiring": None, "fleet_missing": None, "can_operate": True,
                     "blocking_own": None, "blocking_fleet": None, "requirements_met": True}


def test_pendientes_lee_la_base_desde_fleet_compliance():
    """La base se mudó sin cambios: Pendientes compone la MISMA función."""
    assert pending_base_ctes("$10") in compliance._PENDING_ROWS_SQL
    assert pending_base_ctes("$1") in compliance._PENDING_SUMMARY_BY_CARRIER_SQL
    assert not hasattr(compliance, "_pending_ctes")


def test_las_cte_de_resumen_no_usan_parametros():
    """Quien las compone no renumera nada: no traen ningún $n."""
    assert "$" not in carrier_compliance_cte()
    assert "$" not in entity_compliance_cte()


def test_una_empresa_sin_pendientes_es_up_to_date_con_ceros():
    resumen = summary_from_row(_SIN_NADA_EMPRESA, with_fleet=True)
    assert resumen.model_dump() == {"worst_state": "UP_TO_DATE",
                                    "own": {"overdue": 0, "expiring": 0, "missing": 0},
                                    "fleet": {"overdue": 0, "expiring": 0, "missing": 0},
                                    "can_operate": True, "blocking": {"own": 0, "fleet": 0},
                                    "requirements_met": True}


def test_una_entidad_sin_fila_de_resumen_esta_al_dia_si_esta_activa():
    fila = {"worst_state": None, "overdue": None, "expiring": None, "missing": None,
            "blocking_mandatory": None, "operational_status": "ACTIVE"}
    resumen = summary_from_row(fila, with_fleet=False)
    assert (resumen.worst_state, resumen.fleet, resumen.can_operate) == ("UP_TO_DATE", None, True)


@pytest.mark.parametrize("estado, bloqueantes, puede", [("ACTIVE", 1, False), ("INACTIVE", 0, False),
                                                        ("ACTIVE", 0, True)])
def test_la_habilitacion_de_una_entidad(estado, bloqueantes, puede):
    fila = {"worst_state": "MISSING", "overdue": 0, "expiring": 0, "missing": 1,
            "blocking_mandatory": bloqueantes, "operational_status": estado}
    assert summary_from_row(fila, with_fleet=False).can_operate is puede


def test_una_fila_de_entidad_sin_su_ciclo_de_vida_no_se_inventa():
    """Ruling A-R4: sin operational_status, KeyError; nunca "activa" por defecto."""
    fila = {"worst_state": None, "overdue": 0, "expiring": 0, "missing": 0, "blocking_mandatory": 0}
    with pytest.raises(KeyError):
        summary_from_row(fila, with_fleet=False)
