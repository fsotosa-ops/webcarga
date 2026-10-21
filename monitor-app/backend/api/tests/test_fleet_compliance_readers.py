"""Proyecciones de fleet_compliance para los lectores (D1, Task 5)."""
from app.services.fleet_compliance import take_summary


def _fila(**extra):
    return {"id": "c1", "worst_state": "OVERDUE", "own_overdue": 1, "own_expiring": 0, "own_missing": 2,
            "fleet_overdue": 0, "fleet_expiring": 3, "fleet_missing": 0, "can_operate": False,
            "blocking_own": 2, "blocking_fleet": 0, "requirements_met": False, **extra}


def test_take_summary_arma_el_resumen_y_saca_las_columnas_sueltas():
    fila = _fila()
    resumen = take_summary(fila, with_fleet=True)
    assert resumen == {"worst_state": "OVERDUE", "own": {"overdue": 1, "expiring": 0, "missing": 2},
                       "fleet": {"overdue": 0, "expiring": 3, "missing": 0}, "can_operate": False,
                       "blocking": {"own": 2, "fleet": 0}, "requirements_met": False}
    assert fila == {"id": "c1"}


def test_take_summary_de_entidad_arma_la_habilitacion_y_no_toca_el_ciclo_de_vida():
    """Filas de conductor o equipo (ruling F1): overdue/expiring/missing/blocking_mandatory
    más el operational_status que el lector ya proyecta como columna propia."""
    fila = {"id": "d1", "operational_status": "ACTIVE", "worst_state": "MISSING", "overdue": 0,
            "expiring": 1, "missing": 2, "blocking_mandatory": 2}
    resumen = take_summary(fila, with_fleet=False)
    assert resumen == {"worst_state": "MISSING", "own": {"overdue": 0, "expiring": 1, "missing": 2},
                       "fleet": None, "can_operate": False, "blocking": {"own": 2, "fleet": None},
                       "requirements_met": False}
    assert fila == {"id": "d1", "operational_status": "ACTIVE"}


def test_take_summary_sin_flota_no_inventa_una():
    fila = {"id": "d1", "operational_status": "INACTIVE", "worst_state": None, "overdue": None,
            "expiring": 0, "missing": 0, "blocking_mandatory": 0}
    resumen = take_summary(fila, with_fleet=False)
    assert resumen["fleet"] is None
    assert resumen["worst_state"] == "UP_TO_DATE"   # NULL = nada pendiente (contrato Task 4)
    assert resumen["own"]["overdue"] == 0
    assert resumen["can_operate"] is False          # de baja: nunca habilitado (R-B2)


from app.services.fleet_compliance import funnel_bucket_for


def _resumen(*, can_operate=True, own=(0, 0, 0), fleet=(0, 0, 0)):
    a = dict(zip(("overdue", "expiring", "missing"), own))
    b = dict(zip(("overdue", "expiring", "missing"), fleet))
    return {"worst_state": "UP_TO_DATE", "own": a, "fleet": b, "can_operate": can_operate,
            "blocking": {"own": 0 if can_operate else 1, "fleet": 0}, "requirements_met": can_operate}


def test_el_balde_de_una_empresa_no_activa_es_ninguno():
    assert funnel_bucket_for(_resumen(can_operate=False), "ONBOARDING") is None
    assert funnel_bucket_for(_resumen(can_operate=False), "INACTIVE") is None


def test_no_habilitada_gana_a_todo():
    assert funnel_bucket_for(_resumen(can_operate=False, fleet=(0, 2, 0)), "ACTIVE") == "not_enabled"


def test_con_vencimientos_incluye_por_vencer_y_vencidos_opcionales():
    assert funnel_bucket_for(_resumen(fleet=(0, 1, 0)), "ACTIVE") == "expiring"
    assert funnel_bucket_for(_resumen(own=(1, 0, 0)), "ACTIVE") == "expiring"


def test_un_opcional_que_falta_no_saca_del_al_dia():
    assert funnel_bucket_for(_resumen(own=(0, 0, 3)), "ACTIVE") == "up_to_date"
