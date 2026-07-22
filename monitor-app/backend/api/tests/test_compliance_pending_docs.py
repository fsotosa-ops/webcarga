from app.routers.trips import _TRIP_FROM, _TRIP_SELECT

# ── Gap detectado 2026-07-22: el Diario solo mostraba alerta de Seguros
# (HU-12) — la documentación LEGAL_MANDATORY de conductor/tracto/empresa
# nunca llegó a mostrarse (endpoint viejo borrado en Checkpoint A-E). Un
# tri-state ok/vencido fue descartado: contra datos reales, el 100% de
# conductores/tractos/empresas tiene al menos 1 documento pendiente hoy, así
# que satura cualquier badge binario. En cambio: consolidado (cuántos
# documentos pendientes) + flag de "crítico" cuando incluye Licencia de
# Conducir/Carnet (pedido explícito del usuario), que baja solo a medida que
# se sube documentación (recalculado en cada request, sin cache).

def test_trip_select_exposes_pending_docs_columns():
    assert "driver_pending_docs" in _TRIP_SELECT
    assert "driver_pending_docs_critical" in _TRIP_SELECT
    assert "tractor_pending_docs" in _TRIP_SELECT
    assert "carrier_pending_docs" in _TRIP_SELECT


def test_trip_from_joins_compliance_records_per_domain():
    assert _TRIP_FROM.count("public.compliance_records") == 3
    assert "entity_type = 'DRIVER'" in _TRIP_FROM
    assert "entity_type = 'ASSET'" in _TRIP_FROM
    assert "entity_type = 'CARRIER'" in _TRIP_FROM


def test_driver_critical_docs_flag_covers_license_and_id_card():
    assert "LICENCIA_CONDUCIR" in _TRIP_FROM
    assert "COPIA_CI_CONDUCTOR" in _TRIP_FROM


def test_tractor_and_carrier_lateral_have_no_critical_codes():
    """Solo conductor tiene lista de códigos críticos — tracto/empresa usan
    ARRAY[]::varchar[] (ninguno pedido explícitamente por el usuario)."""
    assert _TRIP_FROM.count("ARRAY[]::varchar[]") == 2


def test_pending_docs_null_when_entity_not_resolved():
    """COUNT(*) FILTER sobre cero filas ya da 0 por sí solo — sin el CASE
    explícito, un viaje sin conductor resuelto mostraría '0 pendientes'
    (todo en orden) en vez de 'no hay conductor para evaluar'."""
    assert _TRIP_FROM.count("IS NULL THEN NULL ELSE") == 6  # 2 columnas x 3 dominios
