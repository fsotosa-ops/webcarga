from unittest.mock import AsyncMock

from app.services.requirement_conditions import SQL_ENTIDADES_QUE_APLICAN, calcular_diferencias


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
    pool.fetchrow.return_value = {"target_entity": "ASSET"}
    pool.fetch.return_value = []

    await calcular_diferencias(pool, "req-1")

    sobran_sql = pool.fetch.call_args_list[1].args[0]
    clause_start = sobran_sql.index("(cr.file_url")
    clause_end = sobran_sql.index("AS bloqueado")
    clause_normalized = " ".join(sobran_sql[clause_start:clause_end].split())

    assert clause_normalized == (
        "(cr.file_url IS NOT NULL OR cr.is_manual_override "
        "OR cr.status IS DISTINCT FROM 'MISSING')"
    )
