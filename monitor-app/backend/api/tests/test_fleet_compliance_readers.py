"""Proyecciones de fleet_compliance para los lectores (D1, Task 5)."""
from app.services.fleet_compliance import take_summary


def _fila(**extra):
    return {"id": "c1", "worst_state": "OVERDUE", "own_overdue": 1, "own_expiring": 0, "own_missing": 2,
            "fleet_overdue": 0, "fleet_expiring": 3, "fleet_missing": 0, "can_operate": False, **extra}


def test_take_summary_arma_el_resumen_y_saca_las_columnas_sueltas():
    fila = _fila()
    resumen = take_summary(fila, with_fleet=True)
    assert resumen == {"worst_state": "OVERDUE", "own": {"overdue": 1, "expiring": 0, "missing": 2},
                       "fleet": {"overdue": 0, "expiring": 3, "missing": 0}, "can_operate": False}
    assert fila == {"id": "c1"}


def test_take_summary_de_entidad_arma_la_habilitacion_y_no_toca_el_ciclo_de_vida():
    """Filas de conductor o equipo (ruling F1): overdue/expiring/missing/blocking_mandatory
    más el operational_status que el lector ya proyecta como columna propia."""
    fila = {"id": "d1", "operational_status": "ACTIVE", "worst_state": "MISSING", "overdue": 0,
            "expiring": 1, "missing": 2, "blocking_mandatory": 2}
    resumen = take_summary(fila, with_fleet=False)
    assert resumen == {"worst_state": "MISSING", "own": {"overdue": 0, "expiring": 1, "missing": 2},
                       "fleet": None, "can_operate": False}
    assert fila == {"id": "d1", "operational_status": "ACTIVE"}


def test_take_summary_sin_flota_no_inventa_una():
    fila = {"id": "d1", "operational_status": "INACTIVE", "worst_state": None, "overdue": None,
            "expiring": 0, "missing": 0, "blocking_mandatory": 0}
    resumen = take_summary(fila, with_fleet=False)
    assert resumen["fleet"] is None
    assert resumen["worst_state"] == "UP_TO_DATE"   # NULL = nada pendiente (contrato Task 4)
    assert resumen["own"]["overdue"] == 0
    assert resumen["can_operate"] is False          # de baja: nunca habilitado (R-B2)
