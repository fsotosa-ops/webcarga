# tests/test_permisos_ts_en_sincronia.py
from scripts.generar_permisos_ts import DESTINO, contenido


def test_el_archivo_del_frontend_esta_al_dia():
    assert DESTINO.read_text() == contenido(), "Correr: venv/bin/python scripts/generar_permisos_ts.py"
