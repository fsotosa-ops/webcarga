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


def test_un_estado_sin_columna_no_rompe_el_meta_del_monitor():
    """Revisión final #3: un vocabulario operacional se puede crear sin grupo, y el
    meta del Monitor lo construía con `group: str` → 500 en /trips/meta y el Monitor
    entero caído. El frontend ya lo pinta neutro ("Sin columna")."""
    from app.routers.trips import OperationalStateMeta, StatusMeta

    assert OperationalStateMeta(id="x", label="Nuevo", group=None).group is None
    assert StatusMeta(id="NUEVO", label="NUEVO", group=None).group is None


_FRONTEND = __import__("pathlib").Path(__file__).resolve().parents[3] / "frontend"


def test_las_columnas_dicen_lo_mismo_en_python_y_en_typescript():
    """Una lista por lenguaje es inevitable; que se separen, no. El tono de cada
    columna vive en lib/states.ts (BOARD_COLUMN_STYLE)."""
    import re
    fuente = (_FRONTEND / "lib" / "states.ts").read_text(encoding="utf-8")
    bloque = fuente.split("const BOARD_COLUMN_STYLE")[1].split("\n}\n")[0]
    assert set(re.findall(r"^\s+(\w+):\s+\{ label:", bloque, re.M)) == set(BOARD_COLUMNS)


def test_el_area_de_cada_umbral_dice_lo_mismo_en_python_y_en_typescript():
    """El frontend ubica cada umbral en su área (settings-sources.AREA_DEL_UMBRAL);
    el backend exige su permiso y registra su revisión ahí (vencimientos.UMBRALES)."""
    import re
    from app.services.vencimientos import UMBRALES
    fuente = (_FRONTEND / "app" / "dashboard" / "admin" / "settings" / "settings-sources.tsx").read_text(encoding="utf-8")
    bloque = fuente.split("const AREA_DEL_UMBRAL")[1].split("\n}\n")[0]
    en_typescript = dict(re.findall(r"(\w+):\s+'([\w-]+)'", bloque))
    assert en_typescript == {doc: u.dominio for doc, u in UMBRALES.items()}
