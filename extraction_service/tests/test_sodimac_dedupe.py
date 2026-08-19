"""Deduplicación de las capturas de la tabla de Sodimac (GitHub issue #5).

Tests unitarios puros — no necesitan navegador ni credenciales, a diferencia de
`test_sodimac_adapter.py`, que es de integración y sólo corre con INTEGRATION=1.
"""

from app.tms.sodimac.scraper import dedupe_captures

HEADERS = [
    "Nº ID", "CONEXIONES", "TRANSPORTISTA", "FECHA", "HORA",
    "ORIGEN", "DESTINO", "PATENTE", "TIPO DE EQUIPO", "ESTADO",
]


def fila(trip_id: str, origen: str = "Bod La Farfana 4 (257 )", destino: str = "CO Rancagua (26 )"):
    return [trip_id, "link 2 conexiónes", "Webcarga", "15-07-2026", "7:00 AM",
            origen, destino, "JF8307", "P30", "Finalizada"]


def test_reproduce_el_patron_real_de_produccion():
    """320 filas leídas → 41 únicas, con la escalera medida en producción.

    Tres archivos consecutivos del 2026-08-19 traían exactamente 320 filas para
    41 solicitudes: 23 IDs repetidos 10 veces y 2 IDs en cada frecuencia de 1 a
    9. Eso corresponde a diez lecturas del DOM que crecen de a 2 filas:
    23 + 25 + 27 + … + 41 = 320.
    """
    filas = [fila(str(800000 + i), origen=f"Bodega {i}") for i in range(41)]
    capturas = [filas[: 23 + 2 * i] for i in range(10)]

    leidas = sum(len(c) for c in capturas)
    assert leidas == 320, "el escenario debe reproducir el conteo real"

    rows, stats = dedupe_captures(capturas, HEADERS)

    assert len(rows) == 41
    # La primera lectura aporta 23; cada una de las nueve siguientes, 2.
    assert [n for n, _ in stats] == [23] + [2] * 9
    assert sum(d for _, d in stats) == 320 - 41


def test_conserva_las_patas_de_un_viaje_de_varias_conexiones():
    """Dos filas del mismo viaje con orígenes distintos son dos patas reales.

    Es el caso de `815726` (issue #6): el portal lista una fila por pata, con
    códigos de local distintos — 256 y 257 son lugares diferentes. Deduplicar
    por `Nº ID` borraría una pata que sí ocurrió.
    """
    pata_1 = fila("815726", origen="Bod La Farfana 4 (257 )")
    pata_2 = fila("815726", origen="LA FARFANA CDMC (256 )")
    # Cinco lecturas del DOM, cada una con las dos patas.
    rows, _ = dedupe_captures([[pata_1, pata_2]] * 5, HEADERS)

    assert len(rows) == 2
    assert {r["ORIGEN"] for r in rows} == {
        "Bod La Farfana 4 (257 )", "LA FARFANA CDMC (256 )",
    }


def test_conserva_dos_destinos_del_mismo_origen():
    """`838455`: un retiro con dos entregas. Misma lógica, otra columna."""
    a = fila("838455", origen="Bodega CD Maderas Rengo (381 )", destino="HC Puente Alto (75 )")
    b = fila("838455", origen="Bodega CD Maderas Rengo (381 )", destino="HC San Miguel (12 )")
    rows, _ = dedupe_captures([[a, b], [a, b]], HEADERS)

    assert len(rows) == 2
    assert {r["DESTINO"] for r in rows} == {"HC Puente Alto (75 )", "HC San Miguel (12 )"}


def test_filas_identicas_colapsan_a_una():
    rows, stats = dedupe_captures([[fila("815726")], [fila("815726")], [fila("815726")]], HEADERS)
    assert len(rows) == 1
    assert stats == [(1, 0), (0, 1), (0, 1)]


def test_respeta_el_orden_de_aparicion():
    filas = [fila(str(i)) for i in ("3", "1", "2")]
    rows, _ = dedupe_captures([filas], HEADERS)
    assert [r["Nº ID"] for r in rows] == ["3", "1", "2"]


def test_una_diferencia_en_cualquier_columna_hace_dos_filas():
    """La clave es la fila completa, no un subconjunto elegido a mano.

    Fija el criterio: si mañana dos patas difieren sólo en ESTADO (caso real
    `842862`, issue #4), siguen siendo dos filas.
    """
    a = fila("842862")
    b = fila("842862")
    b[HEADERS.index("ESTADO")] = "Despachada"
    rows, _ = dedupe_captures([[a, b]], HEADERS)
    assert len(rows) == 2


def test_sin_capturas_no_revienta():
    rows, stats = dedupe_captures([], HEADERS)
    assert rows == []
    assert stats == []
