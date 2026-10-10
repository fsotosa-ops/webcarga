"""La regla del último Propietario solo vale si el chequeo y la escritura van
en la misma transacción (revisión final RBAC, hallazgo 2). Llamarla suelta es
un error de programación, no un caso de negocio."""
from unittest.mock import MagicMock

import pytest

from app.services.access_admin import assert_can_manage_user
from tests.conftest import usuario


async def test_fuera_de_una_transaccion_es_error_de_programacion():
    conn = MagicMock()
    conn.is_in_transaction.return_value = False
    with pytest.raises(RuntimeError, match="transacción"):
        await assert_can_manage_user(conn, usuario("owner"), "u-1", deactivating=True)
