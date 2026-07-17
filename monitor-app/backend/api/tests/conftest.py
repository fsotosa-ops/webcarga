"""Fixtures compartidas. Ver test_trip_create.py para el patrón original de
mock de pool.acquire()/conn.transaction() — factorizado acá porque H2.2+
lo repite en varios routers nuevos (carriers/drivers/assets/contacts)."""
from unittest.mock import AsyncMock, MagicMock

USER = {
    "sub": "11111111-1111-1111-1111-111111111111",
    "email": "editor@webcarga.cl",
    "role": "editor",
}


def wire_transactional_conn(pool: AsyncMock, conn: AsyncMock) -> None:
    """Hace que `async with pool.acquire() as conn: async with conn.transaction():`
    devuelva `conn` y no haga nada real — mismo patrón que test_trip_create.py."""
    acquire_ctx = MagicMock()
    acquire_ctx.__aenter__ = AsyncMock(return_value=conn)
    acquire_ctx.__aexit__ = AsyncMock(return_value=False)
    pool.acquire = MagicMock(return_value=acquire_ctx)

    tx_ctx = MagicMock()
    tx_ctx.__aenter__ = AsyncMock(return_value=None)
    tx_ctx.__aexit__ = AsyncMock(return_value=False)
    conn.transaction = MagicMock(return_value=tx_ctx)
