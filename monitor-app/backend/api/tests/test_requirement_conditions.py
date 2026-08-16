import re
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from app.services.requirement_conditions import SQL_ENTIDADES_QUE_APLICAN, calcular_diferencias
from tests.conftest import wire_transactional_conn

MIGRACIONES = Path(__file__).resolve().parents[2] / "supabase" / "migrations"

# Las vias de siembra que miran el tipo de gestion de una empresa, y cuantas
# veces lo miran cada una. Son las cuatro ramas CARRIER: la general
# (reconcile_new_carrier), la de cliente puntual (reconcile_carrier_shipper_link)
# y las dos de reconcile_new_requirement (general + cliente puntual).
VIAS_DE_SIEMBRA_CARRIER = {
    "reconcile_new_carrier": 1,
    "reconcile_carrier_shipper_link": 1,
    "reconcile_new_requirement": 2,
}


def _ultima_definicion(nombre: str) -> str:
    """El cuerpo vigente de una funcion, segun la ULTIMA migracion que la
    define. Mirar solo la migracion del arreglo dejaria pasar que una
    migracion posterior la reescriba y vuelva a leer la columna declarada."""
    for path in sorted(MIGRACIONES.glob("*.sql"), reverse=True):
        texto = path.read_text(encoding="utf-8")
        inicio = texto.find(f"FUNCTION public.{nombre}(")
        if inicio == -1:
            continue
        cuerpo_inicio = texto.index("AS $function$", inicio) + len("AS $function$")
        cuerpo_fin = texto.index("$function$;", cuerpo_inicio)
        return texto[cuerpo_inicio:cuerpo_fin]
    raise AssertionError(f"Ninguna migracion define public.{nombre}()")


def _predicados_de_gestion(sql: str) -> list[str]:
    """Las lineas donde se decide si el tipo de gestion de una empresa entra
    en la condicion del requisito, normalizadas para poder compararlas entre
    el trigger (NEW.applies_to_...) y el servicio (req.applies_to_...)."""
    lineas = [
        " ".join(linea.split())
        for linea in sql.splitlines()
        if "&&" in linea and "applies_to_management_types" in linea
    ]
    return [linea.replace("NEW.applies_to_management_types", "req.applies_to_management_types")
            for linea in lineas]


def test_la_regla_no_menciona_requirement_level_ni_codigos():
    """La regla vive en las columnas de condicion. Si vuelve a aparecer
    requirement_level o un requirement_code escrito a mano, volvimos al
    frankenstein que este tramo vino a sacar."""
    for entidad, sql in SQL_ENTIDADES_QUE_APLICAN.items():
        assert "requirement_level" not in sql, entidad
        assert "MANTENCION_FRIO" not in sql, entidad
        assert "asset_type" not in sql, entidad


def test_hay_una_regla_por_tipo_de_entidad():
    assert set(SQL_ENTIDADES_QUE_APLICAN) == {"CARRIER", "DRIVER", "ASSET"}


def test_las_tres_reglas_filtran_por_is_active():
    for entidad, sql in SQL_ENTIDADES_QUE_APLICAN.items():
        assert "is_active" in sql, entidad


def test_la_regla_de_empresa_contempla_los_requisitos_de_cliente_puntual():
    """Un requisito con shipper_id aplica a las empresas vinculadas a ese
    cliente, no a ninguna. Sin esta rama, recalcular ANEXO_REPLEG proponia
    borrar sus 35 registros legitimos."""
    sql = SQL_ENTIDADES_QUE_APLICAN["CARRIER"]
    assert "shipper_id" in sql
    assert "carrier_shippers" in sql


def test_la_gestion_de_una_empresa_no_se_lee_de_la_columna_declarada():
    """Defecto C1. `public.carriers.management_types` es lo DECLARADO al crear
    la empresa, y esta en NULL en las 248 empresas: la poblo el alta de
    empresas nuevas, ninguna migracion la relleno. Leerla a secas hacia que
    `NULL && ARRAY['TRACTOREO']` diera NULL, que el conjunto de empresas que
    aplican quedara vacio y que TODOS los registros vigentes del requisito
    pasaran a "quitar" (medido contra produccion: CARPETA_TRIBUTARIA con
    TRACTOREO marcado daba quitar 247, y el DELETE es fisico).

    El tipo de gestion sale de public.carrier_management_types(): la flota
    manda cuando existe, lo declarado cubre el hueco. Es la misma definicion
    que muestra la pantalla de Certificacion. Si alguien vuelve a leer la
    columna declarada, este test muere."""
    sql = SQL_ENTIDADES_QUE_APLICAN["CARRIER"]

    assert "public.carrier_management_types(e.id)" in sql
    assert not re.search(r"\be\.management_types\b", sql), (
        "la regla volvio a leer la columna declarada de carriers"
    )

    predicados = _predicados_de_gestion(sql)
    assert predicados == [
        "OR public.carrier_management_types(e.id) && req.applies_to_management_types)"
    ]


@pytest.mark.parametrize("funcion", sorted(VIAS_DE_SIEMBRA_CARRIER))
def test_las_vias_de_siembra_leen_la_misma_gestion_que_la_vista_previa(funcion):
    """EL INVARIANTE DEL TRAMO: la regla de los triggers y la del servicio
    tienen que coincidir. Si divergen, la vista previa miente sobre lo que va
    a pasar y el boton "Aplicar" borra en firme.

    Se compara contra la ULTIMA migracion que define cada funcion, no contra
    la del arreglo: una migracion posterior que reescriba el trigger y vuelva
    a `c.management_types &&` tiene que hacer fallar esto."""
    cuerpo = _ultima_definicion(funcion)
    predicados = _predicados_de_gestion(cuerpo)

    assert len(predicados) == VIAS_DE_SIEMBRA_CARRIER[funcion], (
        f"{funcion}() dejo de mirar el tipo de gestion, o lo mira de mas"
    )
    for predicado in predicados:
        assert predicado.startswith("OR public.carrier_management_types("), (
            f"{funcion}() lee el tipo de gestion de otra fuente: {predicado}"
        )
        assert predicado.endswith(") && req.applies_to_management_types)"), (
            f"{funcion}() compara contra otra cosa: {predicado}"
        )


# ── Qué DEVUELVE la definición ────────────────────────────────────────────
#
# Los tests de arriba prueban quién LLAMA a public.carrier_management_types().
# Ninguno prueba qué devuelve, y esa diferencia importa: vaciarle el cuerpo
# para que entregue sólo `carriers.management_types` reintroduce el defecto C1
# completo —la columna declarada está en NULL en las 248 empresas de
# producción— y deja a todos los demás en verde.
#
# Lo correcto sería EJECUTAR la función. No se puede desde esta suite: no hay
# un servidor de Postgres al que llegar (ver el reporte del arreglo). Así que
# lo que sigue fija el TEXTO de la definición, con dos aserciones de distinta
# naturaleza a propósito, porque cada una tapa el agujero de la otra.

# La definición, palabra por palabra. La comparación es EXACTA (espacios
# colapsados, comentarios afuera), no un `in`: en este mismo tramo un test con
# aserciones `in` dejó pasar un `NOT` agregado a uno de los términos y quedó
# verde con la regla invertida.
# El tipo de gestión se reconoce por su CÓDIGO ESTABLE (`t.code`), no por su
# nombre visible. Mientras dependía de la etiqueta, renombrar "Equipo Completo"
# desde Configuración —lo que esa pantalla ofrece hacer— dejaba de reconocerlo:
# la función caía a lo declarado (NULL en las 248 empresas) y las reglas por
# gestión pasaban a alcanzar a otras. Medido contra producción antes de
# cambiarlo: con la definición vieja, renombrar la etiqueta cambiaba la gestión
# derivada de 13 de las 39 empresas activas; con ésta, de ninguna.
# Ver 20260816090000_status_taxonomies_code.sql.
DEFINICION_ESPERADA = (
    "SELECT COALESCE( ( SELECT array_agg(DISTINCT t.code) FILTER (WHERE t.code IS NOT NULL) "
    "FROM public.asset_assignments aa "
    "JOIN public.assets a ON a.id = aa.asset_id "
    "JOIN app.status_taxonomies t ON t.id = a.webcarga_operation_type_id "
    "WHERE aa.carrier_id = p_carrier_id AND aa.status = 'ACTIVE' ), "
    "(SELECT c.management_types FROM public.carriers c WHERE c.id = p_carrier_id) );"
)


def _cuerpo_normalizado(nombre: str) -> str:
    """El cuerpo de la función sin comentarios y con los espacios colapsados."""
    cuerpo = _ultima_definicion(nombre)
    sin_comentarios = "\n".join(
        linea for linea in cuerpo.splitlines() if not linea.strip().startswith("--")
    )
    return " ".join(sin_comentarios.split())


def test_la_definicion_del_tipo_de_gestion_deriva_de_la_flota():
    """LA FLOTA MANDA CUANDO EXISTE, LO DECLARADO CUBRE EL HUECO.

    Esto protege la CONDUCTA de public.carrier_management_types(), no sus
    llamadores. Sin él, vaciar el cuerpo de la función para que devuelva sólo
    la columna declarada reintroduce el defecto C1 con toda la suite en verde:
    la pantalla de Certificación seguiría mostrando la gestión derivada de la
    flota mientras la condición de los requisitos evalúa una columna vacía, y
    marcar cualquier tipo de gestión propondría borrar todos los registros
    vigentes del requisito (medido contra producción: quitar 247).

    Se afirma en dos niveles, y hacen falta los dos:

    1. El ORDEN del COALESCE. Sobrevive a que alguien reformatee la función y
       muere si la invierte o si le saca la parte derivada. Es la aserción que
       de verdad dice "la flota manda".
    2. El texto completo, exacto. Es frágil ante un reformateo —y ahí está su
       trampa: quien lo vea fallar puede "arreglarlo" pegando el texto nuevo
       sin mirar si el nuevo está bien. Por eso no va solo. Vale por lo que
       atrapa: cualquier cambio de la definición obliga a mirarla.

    Lo que NINGUNA de las dos hace es ejecutar la función: si alguien la
    reescribe con otro texto que compile y devuelva otra cosa, esto no lo ve.
    La cobertura real de eso pide un Postgres al que la suite pueda llegar."""
    cuerpo = _cuerpo_normalizado("carrier_management_types")

    # 1. La flota se consulta ANTES que la columna declarada. Ese orden ES la
    #    regla: en un COALESCE, primero es quien manda.
    assert "public.asset_assignments" in cuerpo, (
        "la definicion dejo de derivar de la flota: esto es el defecto C1"
    )
    assert "c.management_types" in cuerpo, (
        "la definicion dejo de cubrir el hueco con lo declarado en el alta"
    )
    assert cuerpo.index("public.asset_assignments") < cuerpo.index("c.management_types"), (
        "el COALESCE quedo invertido: manda lo declarado y no la flota"
    )

    # 2. Y es exactamente esta definicion, no una parecida.
    assert cuerpo == DEFINICION_ESPERADA


def test_la_definicion_del_tipo_de_gestion_esta_escrita_una_sola_vez():
    """La flota manda cuando existe, lo declarado cubre el hueco. Esa frase
    se escribe UNA vez, en la funcion de base, y la llaman los tres lados: lo
    que se muestra (app/routers/compliance.py), lo que siembra (los cuatro
    triggers) y lo que calcula la vista previa (este servicio). Si vuelve a
    haber una copia del COALESCE en el SQL de la API, este test muere."""
    from app.routers import compliance

    fuente = Path(compliance.__file__).read_text(encoding="utf-8")
    assert "public.carrier_management_types(c.id)" in fuente
    assert "COALESCE(g.operation_types, e.management_types)" not in fuente, (
        "la pantalla volvio a tener su propia copia de la definicion"
    )


async def test_bloqueado_predicate_text_is_exactly_d13_combined_with_or():
    """D13 dice que un registro esta bloqueado si tiene archivo, edicion
    manual, O un estado distinto de MISSING -- cualquiera de las tres
    alcanza. El predicado vive en SQL (no en Python; ver el docstring del
    modulo), y `pool` acá está mockeado: `pool.fetch` no ejecuta la consulta
    contra Postgres, asi que esto NO evalua filas reales -- solo confirma
    que el TEXTO de la clausula sigue siendo D13, con una comparacion exacta
    (espacios colapsados) contra el texto esperado, no un `in` por termino.
    Un `in` por termino dejaba pasar un `NOT` de mas delante de cualquiera
    de los tres (probado a mano: mutar `cr.is_manual_override` a
    `NOT cr.is_manual_override` seguia pasando con `in`, D13 invertido y
    test en verde -- Ronda de arreglo 2). La comparacion exacta cierra ese
    hueco: cualquier mutacion del texto -- invertir una condicion, agregar
    un NOT, cambiar OR por AND, cambiar `<>`/`IS DISTINCT FROM` -- lo hace
    fallar. La evaluacion contra datos reales de esta clausula se hizo a
    mano vía MCP de Supabase (ver reportes de las Rondas de arreglo 1 y 2:
    MANTENCION_FRIO con bloqueados=0, REVISION_TECNICA con bloqueados=2) --
    no hay forma de ejercitarla con pytest sin una conexion real a Postgres,
    que este sandbox no tiene (ver AGENTLOG /
    reference_sandbox_cannot_reach_supabase_db_directly)."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"target_entity": "ASSET"}
    conn.fetch.return_value = []

    await calcular_diferencias(pool, "req-1")

    sobran_sql = conn.fetch.call_args_list[1].args[0]
    clause_start = sobran_sql.index("(cr.file_url")
    clause_end = sobran_sql.index("AS bloqueado")
    clause_normalized = " ".join(sobran_sql[clause_start:clause_end].split())

    assert clause_normalized == (
        "(cr.file_url IS NOT NULL OR cr.is_manual_override "
        "OR cr.status IS DISTINCT FROM 'MISSING')"
    )


async def test_calcular_diferencias_lee_las_tres_consultas_en_una_sola_transaccion_de_lectura():
    """M3: `target_entity`, `crear` y `sobran` van sobre LA MISMA conexion
    adquirida del pool, dentro de una transaccion de solo lectura -- no
    sueltas contra `pool` (donde cada `pool.fetch*` puede tomar una conexion
    distinta y por lo tanto ver un snapshot distinto). Sin esto, `crear` y
    `quitar` de una misma vista previa podian no ser mutuamente coherentes
    entre si -- son los numeros que alguien mira antes de confirmar un
    borrado irreversible."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"target_entity": "ASSET"}
    conn.fetch.return_value = []

    await calcular_diferencias(pool, "req-1")

    pool.acquire.assert_called_once()
    conn.transaction.assert_called_once_with(readonly=True)
    assert conn.fetchrow.call_count == 1
    assert conn.fetch.call_count == 2
    # las tres lecturas nunca deberian haber ido sueltas contra el pool
    pool.fetchrow.assert_not_called()
    pool.fetch.assert_not_called()
