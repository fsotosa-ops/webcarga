"""Las etapas del viaje se declaran una vez (Configuración, Parte 1).

Antes eran "columnas del tablero" y estaban escritas dos veces (`routers/config` y
`GRUPOS_POR_DOMINIO["OPERATIONAL_STATE"]`). El tablero se retiró el 17/10 y el
frontend pasó a TRIP_STAGE_STYLE; este test comparaba con el nombre viejo y quedó
rojo hasta el 21/10, cuando el backend completó el mismo rename."""
from app.routers import config
from app.schemas.status_taxonomy import GRUPOS_POR_DOMINIO, TRIP_STAGES


def test_una_sola_lista_de_etapas():
    assert config.TRIP_STAGES is TRIP_STAGES
    assert GRUPOS_POR_DOMINIO["OPERATIONAL_STATE"] is TRIP_STAGES
    assert TRIP_STAGES == frozenset(
        {"en_ruta", "en_local", "retornando", "pendiente_cierre_tms", "cerrado", "problema", "otro"})


def test_un_estado_sin_columna_no_rompe_el_meta_del_monitor():
    """Revisión final #3: un vocabulario operacional se puede crear sin grupo, y el
    meta del Monitor lo construía con `group: str` → 500 en /trips/meta y el Monitor
    entero caído. El frontend ya lo pinta neutro ("Sin columna")."""
    from app.routers.trips import OperationalStateMeta, StatusMeta

    assert OperationalStateMeta(id="x", label="Nuevo", group=None).group is None
    assert StatusMeta(id="NUEVO", label="NUEVO", group=None).group is None


_FRONTEND = __import__("pathlib").Path(__file__).resolve().parents[3] / "frontend"


def test_las_etapas_dicen_lo_mismo_en_python_y_en_typescript():
    """Una lista por lenguaje es inevitable; que se separen, no. El tono de cada
    etapa vive en lib/states.ts (TRIP_STAGE_STYLE)."""
    import re
    fuente = (_FRONTEND / "lib" / "states.ts").read_text(encoding="utf-8")
    assert "const TRIP_STAGE_STYLE" in fuente, "lib/states.ts ya no declara TRIP_STAGE_STYLE: actualizar este test"
    bloque = fuente.split("const TRIP_STAGE_STYLE")[1].split("\n}\n")[0]
    assert set(re.findall(r"^\s+(\w+):\s+\{ label:", bloque, re.M)) == set(TRIP_STAGES)


def test_el_area_de_cada_umbral_dice_lo_mismo_en_python_y_en_typescript():
    """El frontend ubica cada umbral en su área (settings-sources.AREA_DEL_UMBRAL);
    el backend exige su permiso y registra su revisión ahí (vencimientos.UMBRALES)."""
    import re
    from app.services.vencimientos import UMBRALES
    fuente = (_FRONTEND / "app" / "dashboard" / "admin" / "settings" / "settings-sources.tsx").read_text(encoding="utf-8")
    bloque = fuente.split("const AREA_DEL_UMBRAL")[1].split("\n}\n")[0]
    en_typescript = dict(re.findall(r"(\w+):\s+'([\w-]+)'", bloque))
    assert en_typescript == {doc: u.dominio for doc, u in UMBRALES.items()}
