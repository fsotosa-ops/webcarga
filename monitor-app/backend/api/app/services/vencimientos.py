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
documento ya no se lee de la fecha suelta: lo dice la politica del tipo
(expiration_policy) y la regla de cada cliente (compliance_requirement_rules).
La expresion se arma ACA y viaja dentro de la consulta. No es una funcion de la
base porque Postgres no inlinea funciones con subconsultas: como llamada por
registro, /compliance/status por empresa paso de 0,28 s a 0,76 s (medido el
08/10). De la base se usan solo hoy_chile(), reglas_aplicables() y las
formulas puras vence_segun_regla() y corte_del_periodo().

CONTRATO DEL ALIAS: el alias que recibe cada predicado debe exponer
requirement_id, entity_type, entity_id, status, expiration_date, issue_date y
period_start. Sobre la tabla (`cr`) los tiene todos; una CTE que alimente a un
predicado tiene que proyectarlos (ver compliance.py y
plantilla_certificacion.py). Los alias internos empiezan con `vg_` para no
tapar los de la consulta que los recibe.
"""


def hoy_sql() -> str:
    """El dia de hoy en Chile. La base corre en UTC: CURRENT_DATE adelanta un
    dia desde las 21:00. La definicion vive en la funcion de la migracion
    20261008100000; aca solo se la nombra."""
    return "public.hoy_chile()"


# El aviso de Configuracion > Alertas, para los tipos sin dias propios. Sin
# correlacion: Postgres lo calcula una vez por consulta.
_AVISO_GENERAL = (
    "(SELECT vg_at.warning_days FROM app.alert_thresholds vg_at "
    "WHERE vg_at.doc_type = 'documento_por_vencer')"
)


def _requisito(alias: str, columna: str) -> str:
    """El valor de una columna del requisito: una busqueda por registro. Solo
    donde hace falta el VALOR (la politica que recibe vence_segun_regla)."""
    return (f"(SELECT vg_q.{columna} FROM public.compliance_requirements vg_q "
            f"WHERE vg_q.id = {alias}.requirement_id)")


def _es(alias: str, columna: str, *valores: str) -> str:
    """Si el requisito tiene uno de esos valores. Se pregunta como pertenencia
    a un conjunto sin correlacion: Postgres lo arma UNA vez por consulta
    (hashed SubPlan). Como busqueda por registro, el tipo se leia ~10 veces
    por fila y la cola tardaba el doble (medido el 08/10)."""
    lista = ", ".join(f"'{v}'" for v in valores)
    return (f"{alias}.requirement_id IN (SELECT vg_c.id FROM public.compliance_requirements vg_c "
            f"WHERE vg_c.{columna} IN ({lista}))")


def _reglas(alias: str, fecha_ref: str) -> str:
    """La regla de cada cliente de la entidad (variante o base), vigente a la
    fecha de referencia del documento."""
    return (f"public.reglas_aplicables({alias}.requirement_id, {alias}.entity_type, "
            f"{alias}.entity_id, {fecha_ref})")


def _con_parametros(alias: str, agregado: str) -> str:
    """Para los tipos con parametros (plazo, periodo): un registro MISSING
    falta (NULL); uno presente sin la fecha que su tipo necesita no cubre
    nada (-infinity); si no, `agregado` sobre las reglas aplicables.

    La fecha de referencia la dicta el TIPO, no la que haya: un F30-1 de
    septiembre se emite en octubre, y versionarlo por la emision dejaria que
    un corte movido en octubre reescriba septiembre (regla 6)."""
    ref = (f"(CASE WHEN {_es(alias, 'expiration_policy', 'ISSUE_PLUS_MONTHS')} "
           f"THEN {alias}.issue_date ELSE {alias}.period_start END)")
    return (
        f"CASE WHEN {alias}.status = 'MISSING' THEN NULL::date "
        f"WHEN {ref} IS NULL THEN '-infinity'::date "
        f"ELSE (SELECT {agregado} FROM {_reglas(alias, ref)} vg_rg) END"
    )


def _fecha_del_documento(alias: str, agregado: str, sin_reglas: str) -> str:
    """Para la fecha del documento, las reglas son opcionales: aportan dias
    de aviso y de gracia. Si el tipo no tiene ninguna -- lo comun --, no se las
    busca por cliente, que por cada registro sale caro. Se pregunta con IN y
    no con EXISTS: sin correlacion, Postgres arma el conjunto UNA vez por
    consulta (hashed SubPlan) en vez de una busqueda por registro."""
    return (
        f"CASE WHEN {alias}.requirement_id IN "
        f"(SELECT vg_x.requirement_id FROM public.compliance_requirement_rules vg_x) "
        f"THEN (SELECT {agregado} FROM {_reglas(alias, 'NULL')} vg_rg) "
        f"ELSE {sin_reglas} END"
    )


def _vence_segun_regla(alias: str) -> str:
    return (f"public.vence_segun_regla({_requisito(alias, 'expiration_policy')}, vg_rg, "
            f"{alias}.expiration_date, {alias}.issue_date, {alias}.period_start)")


def vence_el_sql(alias: str = "cr") -> str:
    """Cuando vence, con los dias de gracia. El peor entre los clientes.
    NULL = no vence, o falta.
      NONE               no vence, traiga o no una fecha
      REQUIRED/OPTIONAL  la fecha que trae el documento
      con parametros     segun la regla de cada cliente"""
    vence = f"min({_vence_segun_regla(alias)})"
    return (
        f"(CASE WHEN {_es(alias, 'expiration_policy', 'NONE')} THEN NULL::date "
        f"WHEN {_es(alias, 'expiration_policy', 'REQUIRED', 'OPTIONAL')} "
        f"THEN {_fecha_del_documento(alias, vence, f'{alias}.expiration_date')} "
        f"ELSE {_con_parametros(alias, vence)} END)"
    )


def aviso_desde_sql(alias: str = "cr") -> str:
    """Desde que dia esta "por vencer": el vencimiento segun la regla de cada
    cliente menos sus dias de aviso, o el aviso general si no los fija. El
    peor (el mas temprano)."""
    aviso = f"min({_vence_segun_regla(alias)} - COALESCE(vg_rg.warning_days, {_AVISO_GENERAL}))"
    return (
        f"(CASE WHEN {_es(alias, 'expiration_policy', 'NONE')} THEN NULL::date "
        f"WHEN {_es(alias, 'expiration_policy', 'REQUIRED', 'OPTIONAL')} "
        f"THEN {_fecha_del_documento(alias, aviso, f'{alias}.expiration_date - {_AVISO_GENERAL}')} "
        f"ELSE {_con_parametros(alias, aviso)} END)"
    )


def exigible_sql(alias: str = "cr") -> str:
    """Si ya se le exige (exigible_on).
      ON_ENTITY_START / ON_REQUEST  siempre (a ON_REQUEST lo filtra la siembra)
      MONTH_AFTER_START  desde el dia 1 del mes siguiente al ingreso del
                         conductor (start_date de su asignacion ACTIVE; sin
                         asignacion, se exige)
      ON_ENTITY_END      el conductor ya no tiene asignacion ACTIVE y tuvo alguna"""
    return (
        f"(CASE WHEN {_es(alias, 'exigible_on', 'MONTH_AFTER_START')} THEN COALESCE("
        f"(SELECT {hoy_sql()} >= (date_trunc('month', vg_da.start_date) + interval '1 month')::date "
        f"FROM public.driver_assignments vg_da "
        f"WHERE vg_da.driver_id = {alias}.entity_id AND vg_da.status = 'ACTIVE'), true) "
        f"WHEN {_es(alias, 'exigible_on', 'ON_ENTITY_END')} THEN "
        f"NOT EXISTS (SELECT 1 FROM public.driver_assignments vg_da "
        f"WHERE vg_da.driver_id = {alias}.entity_id AND vg_da.status = 'ACTIVE') "
        f"AND EXISTS (SELECT 1 FROM public.driver_assignments vg_da "
        f"WHERE vg_da.driver_id = {alias}.entity_id) "
        f"ELSE true END)"
    )


def exigible_desde_sql(alias: str = "cr") -> str:
    """Desde qué fecha se exige, cuando todavía no: el día 1 del mes siguiente
    al ingreso del conductor (MONTH_AFTER_START). NULL en los demás casos:
    "al ingreso" y "a pedido" se exigen siempre, y "al término" no tiene una
    fecha que anunciar (depende de que el conductor se vaya)."""
    return (
        f"(CASE WHEN {_es(alias, 'exigible_on', 'MONTH_AFTER_START')} THEN "
        f"(SELECT (date_trunc('month', vg_da.start_date) + interval '1 month')::date "
        f"FROM public.driver_assignments vg_da "
        f"WHERE vg_da.driver_id = {alias}.entity_id AND vg_da.status = 'ACTIVE') END)"
    )


def cubierto_predicate(alias: str = "cr") -> str:
    """Al día: se exige y no le falta nada. Un documento que todavía no se
    exige NO está al día (HU-C1, entrega 2b, hallazgo I5): mostrarlo así haría
    pasar por cumplido algo que falta."""
    return f"({exigible_sql(alias)} AND NOT {pendiente_predicate(alias)})"


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
