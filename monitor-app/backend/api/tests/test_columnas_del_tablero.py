"""Las columnas del tablero se declaran una vez (Configuración, Parte 1).

Hoy el conjunto estaba escrito dos veces: `routers/config.VALID_GROUP_IDS` y
`schemas/status_taxonomy.GRUPOS_POR_DOMINIO["OPERATIONAL_STATE"]`."""
from app.routers.config import VALID_GROUP_IDS
from app.schemas.status_taxonomy import BOARD_COLUMNS, GRUPOS_POR_DOMINIO


def test_una_sola_lista_de_columnas():
    assert VALID_GROUP_IDS is BOARD_COLUMNS
    assert GRUPOS_POR_DOMINIO["OPERATIONAL_STATE"] is BOARD_COLUMNS
    assert BOARD_COLUMNS == frozenset(
        {"en_ruta", "en_local", "retornando", "pendiente_cierre_tms", "cerrado", "problema", "otro"})
