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


# ── El criterio de "pendiente", que ahora es UNO ──────────────────────────────
#
# Vivía en routers/compliance.py y lo usaban las tres lecturas de Certificación.
# Afuera había CINCO COPIAS escritas a mano —carriers.py (x3, el
# `pending_mandatory` de la ficha) y trips.py (x2, el semáforo del Diario)— y
# diferían en DOS direcciones:
#
#   · `REJECTED`: las copias lo contaban, esta definición no.
#   · "por vencer": esta definición lo cuenta, las copias no.
#
# Medido el 2026-08-23: 0 registros REJECTED y ningún código los escribe, así
# que esa mitad era latente. Pero 2 documentos obligatorios estaban "por
# vencer", y aparecían pendientes en Certificación y NO en la ficha ni en el
# Diario. Esa era la divergencia viva.
#
# Se muda acá porque este módulo ya es dueño de las otras dos mitades de la
# misma regla, y porque un router no debe importar de otro router.
#
# EL AMBITO NO SE UNIFICA, A PROPOSITO. Que la ficha cuente sólo
# LEGAL_MANDATORY y Certificación cuente todos los niveles son dos preguntas
# distintas —"cuántos obligatorios están en problemas" contra "qué entra a la
# cola de trabajo"— y cada llamador le agrega su propio filtro. Lo que sí es una
# sola regla es el vocabulario de estados y fechas.


def pendiente_predicate(alias: str = "cr") -> str:
    """Lo que le falta a alguien: no tiene el documento, o el que tiene ya no
    sirve, o esta por dejar de servir.

    OJO: este predicado lo comparten /pending, el embudo (GET /status), el
    cajon, el `pending_mandatory` de la ficha de empresa y el semaforo del
    Diario. Ya hubo un bug por moverlos por separado. Si cambias este
    predicado, esas lecturas se mueven JUNTAS — que es exactamente el punto.

    `REJECTED` queda AFUERA a proposito y la decision esta abierta (issue #11):
    hoy son 0 filas y ningun codigo lo escribe, asi que la eleccion es inerte.
    El dia que se defina si "rechazar un documento" existe como gesto, entra o
    se retira de las capas — y es una linea, en un lugar.
    """
    return (
        f"({alias}.status IN ('MISSING','EXPIRED') "
        f"OR {vencido_predicate(alias)} "
        f"OR {por_vencer_predicate(alias)})"
    )
