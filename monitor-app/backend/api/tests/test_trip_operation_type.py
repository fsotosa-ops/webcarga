"""El tipo de operación del origen y de cada parada en el Monitor.

La regla (número de local, nombre, sin cruzar clientes) vive en la base y la prueba
test_trip_location_rules_integration.py. Aquí: qué pares se piden y cómo se reparte la respuesta."""
from app.routers.trips import _apply_operation_types, _operation_type_pairs


def _viaje(shipper="s-walmart"):
    return {
        "shipper_id": shipper,
        "origin": "CD LO AGUIRRE",
        "stops": [{"stop_id": "a", "local": "SANTA ROSA - 87"}, {"stop_id": "b", "local": "LINARES - 171"},
                  {"stop_id": "c", "local": None}],
    }


def test_se_piden_el_origen_y_cada_parada_del_cliente():
    assert _operation_type_pairs([_viaje(), _viaje(shipper=None)]) == [
        ("s-walmart", "CD LO AGUIRRE"), ("s-walmart", "SANTA ROSA - 87"), ("s-walmart", "LINARES - 171")]


def test_la_respuesta_se_reparte_al_origen_y_a_cada_parada():
    tipos = {("s-walmart", "SANTA ROSA - 87"): "RM", ("s-walmart", "LINARES - 171"): "Z0",
             ("s-walmart", "CD LO AGUIRRE"): None}
    viaje = _viaje()
    _apply_operation_types(viaje, tipos)
    assert viaje["origin_operation_type"] is None
    assert [s["operation_type"] for s in viaje["stops"]] == ["RM", "Z0", None]


def test_un_viaje_sin_cliente_no_tiene_tipos():
    viaje = _viaje(shipper=None)
    _apply_operation_types(viaje, {("s-walmart", "SANTA ROSA - 87"): "RM"})
    assert viaje["origin_operation_type"] is None
    assert all(s["operation_type"] is None for s in viaje["stops"])
