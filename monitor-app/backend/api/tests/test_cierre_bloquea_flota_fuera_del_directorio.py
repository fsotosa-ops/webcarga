"""El Cierre obliga a resolver los viajes cuya flota no esta en el directorio.

Pedido de Pablo, reunion del 21/08: *"yo aqui deberia el sistema obligarme a
asignarle una empresa, y si la empresa no la tenemos, crearla nomas, ponerle el
RUT y el nombre"*.

QUE HABIA ANTES. El pre-cierre YA detectaba los cinco casos desde el
2026-08-18, y no bloqueaba nada: el dia se podia firmar con todos pendientes.
Detectar sin bloquear no cambia ninguna conducta — el aviso quedaba ahi y el
cierre seguia.

POR QUE SE PUEDE BLOQUEAR SIN CONGELAR LA OPERACION. Medido sobre 5 dias reales
(14, 17, 20, 21 y 22 de agosto): entre 2 y 4 casos por dia. Y el override que ya
existia —rol admin, comentario obligatorio, auditado— sigue siendo la valvula,
que es la que el propio refinamiento diseno contra el "deadlock operativo".
"""
from __future__ import annotations

import pytest

# La regla vive en services/cierre_lineas.py desde el 16/09, cuando el cierre
# de los dos ejes pasó a ser uno solo.
from app.services.cierre_lineas import (
    ESCALACIONES_QUE_BLOQUEAN as _ESCALACIONES_QUE_BLOQUEAN,
    pendientes_de_flota as _pendientes_de_flota,
)

# Estos no tocan la base: verifican la REGLA, que es lo que cambio.


def test_sin_tipo_de_operacion_no_bloquea():
    """Queda afuera a proposito: ahi el vehiculo SI esta en el directorio y lo
    que falta es otro dato. Mezclarla con las otras seria volver a un mensaje
    con dos causas — la sexta vez en este proyecto."""
    assert "SIN_TIPO_OPERACION" not in _ESCALACIONES_QUE_BLOQUEAN


def test_bloquean_las_que_significan_flota_fuera_del_directorio():
    """PATENTE_NO_REGISTRADA dejó de bloquear el 01/10 (requirements-bug-12.md,
    RF-01 / CA-01): se informa en Pendientes y no impide firmar el día."""
    assert set(_ESCALACIONES_QUE_BLOQUEAN) == {
        "CONDUCTOR_NO_REGISTRADO",
        "EMPRESA_NO_RECONOCIDA",
        "EMPRESA_ONBOARDING",
    }


def test_cada_pendiente_dice_de_que_tipo_es():
    """Sin el tipo, la pantalla no puede decir QUE hacer: no es lo mismo "esta
    patente no existe en el directorio" que "esta empresa esta en onboarding"."""
    pre = {"escalations": {
        "CONDUCTOR_NO_REGISTRADO": [{"driver_rut": "11111111-1"}],
        "EMPRESA_ONBOARDING": [{"carrier": "Transportes X"}],
        "SIN_TIPO_OPERACION": [{"tractor_plate": "ZZZZ99"}],
        "PATENTE_NO_REGISTRADA": [{"tractor_plate": "ABCD12", "reason": "no existe"}],
    }}
    pendientes = _pendientes_de_flota(pre)

    assert [p["tipo"] for p in pendientes] == ["CONDUCTOR_NO_REGISTRADO", "EMPRESA_ONBOARDING"]
    assert pendientes[0]["driver_rut"] == "11111111-1"
    # Los casos que no bloquean no viajan: si viajaran, la pantalla los
    # mostraria como bloqueantes y el usuario no podria hacerlos desaparecer.
    assert {p["tipo"] for p in pendientes}.isdisjoint({"SIN_TIPO_OPERACION", "PATENTE_NO_REGISTRADA"})


def test_un_dia_limpio_no_bloquea_nada():
    assert _pendientes_de_flota({"escalations": {t: [] for t in _ESCALACIONES_QUE_BLOQUEAN}}) == []
    # Y tolera que el pre-cierre no haya corrido: ausente no es "hay pendientes".
    assert _pendientes_de_flota({}) == []
