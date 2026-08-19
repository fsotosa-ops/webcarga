"""Cuando un documento pasa a estar "por vencer".

La ventana estaba escrita a mano con el literal INTERVAL '30 days' en tres
routers (carriers, drivers, assets), y /pending no la contemplaba en absoluto:
un documento que vence en diez dias no aparecia en el cajon ni en la etapa
"Hay que renovar" del embudo, porque el predicado de pendiente exigia
expiration_date < CURRENT_DATE, o sea YA vencido.

Medido contra produccion el 2026-08-19: 5.121 registros vigentes, 31 con
fecha, 9 vencidos y 3 por vencer dentro de la ventana. Esos 3 —una poliza de
seguro que vence en tres dias, y dos revisiones de vehiculo— no figuraban en
ninguna pantalla del modulo. La renovacion no tenia superficie.

Una sola definicion, porque tres definiciones de lo mismo es como este repo
llego a tener cuatro errores de conteo distintos.
"""

DIAS_POR_VENCER = 30


def por_vencer_predicate(alias: str = "cr") -> str:
    """Vence pronto pero TODAVIA NO vencio.

    Las dos mitades importan: sin la segunda, "por vencer" se comeria a
    "vencido" y la pantalla mostraria un documento caducado como si solo
    estuviera proximo a caducar.
    """
    return (
        f"({alias}.expiration_date IS NOT NULL "
        f"AND {alias}.expiration_date >= CURRENT_DATE "
        f"AND {alias}.expiration_date <= CURRENT_DATE + INTERVAL '{DIAS_POR_VENCER} days')"
    )


def vencido_predicate(alias: str = "cr") -> str:
    """Ya paso su fecha. Se define aca junto al anterior porque las dos son la
    misma regla mirada desde sus dos lados, y separarlas es exactamente como
    aparecio el desfase que documenta `pendiente_predicate`."""
    return (
        f"({alias}.expiration_date IS NOT NULL "
        f"AND {alias}.expiration_date < CURRENT_DATE)"
    )
