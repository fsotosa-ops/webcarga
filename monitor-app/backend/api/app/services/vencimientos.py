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

HU-C1, entrega 2: cuando vence, desde cuando avisa y desde cuando se exige un
documento ya no se lee de la fecha suelta. Lo calculan al leer las funciones
de la migracion 20261008120000 (documento_vence_el, documento_aviso_desde,
documento_exigible), segun la politica del tipo y la regla de cada cliente.
Este modulo solo las nombra, y sigue siendo la unica puerta desde Python.

CONTRATO DEL ALIAS: el alias que recibe cada predicado debe exponer
requirement_id, entity_type, entity_id, status, expiration_date, issue_date y
period_start. Sobre la tabla (`cr`) los tiene todos; una CTE que alimente a un
predicado tiene que proyectarlos (ver compliance.py y
plantilla_certificacion.py).
"""


def hoy_sql() -> str:
    """El dia de hoy en Chile. La base corre en UTC: CURRENT_DATE adelanta un
    dia desde las 21:00. La definicion vive en la funcion de la migracion
    20261008100000; aca solo se la nombra."""
    return "public.hoy_chile()"


def _vigencia_args(alias: str) -> str:
    return (f"{alias}.requirement_id, {alias}.entity_type, {alias}.entity_id, "
            f"{alias}.status, {alias}.expiration_date, {alias}.issue_date, "
            f"{alias}.period_start")


def vence_el_sql(alias: str = "cr") -> str:
    """Cuando vence, segun la politica y la regla de cada cliente (el peor).
    NULL = no vence, o falta."""
    return f"public.documento_vence_el({_vigencia_args(alias)})"


def aviso_desde_sql(alias: str = "cr") -> str:
    """Desde que dia esta "por vencer": los dias de aviso del tipo o, si no
    los fija, el aviso general de Configuracion > Alertas."""
    return f"public.documento_aviso_desde({_vigencia_args(alias)})"


def exigible_sql(alias: str = "cr") -> str:
    """Si ya se le exige (exigible_on: al ingreso, mes siguiente, al termino)."""
    return (f"public.documento_exigible({alias}.requirement_id, "
            f"{alias}.entity_type, {alias}.entity_id)")


def por_vencer_predicate(alias: str = "cr") -> str:
    """Vence pronto pero TODAVIA NO vencio.

    Las dos mitades importan: sin la segunda, "por vencer" se comeria a
    "vencido" y la pantalla mostraria un documento caducado como si solo
    estuviera proximo a caducar.
    """
    # COALESCE: un documento que no vence da NULL, y un predicado de tres
    # valores hace que `NOT pendiente` deje de ser "al dia".
    return (
        f"COALESCE({vence_el_sql(alias)} >= {hoy_sql()} "
        f"AND {aviso_desde_sql(alias)} <= {hoy_sql()}, false)"
    )


def vencido_predicate(alias: str = "cr") -> str:
    """Ya paso su fecha. Se define aca junto al anterior porque las dos son la
    misma regla mirada desde sus dos lados, y separarlas es exactamente como
    aparecio el desfase que documenta `pendiente_predicate`."""
    return f"COALESCE({vence_el_sql(alias)} < {hoy_sql()}, false)"


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

    Y solo si ya es exigible (`exigible_on`): un documento que se pide el mes
    siguiente al ingreso no le falta a nadie el mes del ingreso.
    """
    return (
        f"({exigible_sql(alias)} AND ("
        f"{alias}.status IN ('MISSING','EXPIRED') "
        f"OR {vencido_predicate(alias)} "
        f"OR {por_vencer_predicate(alias)}))"
    )


# ── Si un documento vence ────────────────────────────────────────────────────
#
# `compliance_requirements.expiration_policy` es la ÚNICA fuente. Reemplazó a
# has_expiration, un booleano que cargaba tres significados y que Configuración
# no edita: todo lector que lo siguiera usando se desincronizaba con la primera
# política cambiada desde la pantalla (HU-C1, entrega 1).


def lleva_fecha(politica: str) -> bool:
    """El documento admite una fecha de vencimiento: obligatoria u opcional."""
    return politica != "NONE"


def exige_fecha(politica: str) -> bool:
    """Sin fecha, el documento no se acepta."""
    return politica == "REQUIRED"


def lleva_fecha_sql(alias: str = "req") -> str:
    """`lleva_fecha` para un SELECT, sobre el alias del requisito."""
    return f"({alias}.expiration_policy <> 'NONE')"
