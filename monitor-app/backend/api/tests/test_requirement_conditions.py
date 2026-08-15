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
    contra Postgres, asi que esto NO evalua filas reales, solo confirma que
    el TEXTO de la clausula sigue siendo D13 y no, por ejemplo, un AND (que
    dejaria pasar un registro con archivo pero sin override y en MISSING) o
    una condicion invertida. La evaluacion contra datos reales de esta
    clausula se hizo a mano vía MCP de Supabase (ver reporte de la Ronda de
    arreglo 1: MANTENCION_FRIO con bloqueados=0 y, por la revision,
    REVISION_TECNICA con bloqueados=2 sobre datos reales) -- no hay forma de
    ejercitarla con pytest sin una conexion real a Postgres, que este
    sandbox no tiene (ver AGENTLOG / reference_sandbox_cannot_reach_supabase_db_directly)."""
    pool = AsyncMock()
    pool.fetchrow.return_value = {"target_entity": "ASSET"}
    pool.fetch.return_value = []

    await calcular_diferencias(pool, "req-1")

    sobran_sql = pool.fetch.call_args_list[1].args[0]
    clause_start = sobran_sql.index("(cr.file_url")
    clause_end = sobran_sql.index("AS bloqueado")
    clause = sobran_sql[clause_start:clause_end]

    assert "cr.file_url IS NOT NULL" in clause
    assert "cr.is_manual_override" in clause
    assert "cr.status <> 'MISSING'" in clause
    # las tres deben estar unidas por OR: si alguna vez se cambia a AND, un
    # registro con archivo pero sin override y en MISSING dejaria de
    # bloquearse -- exactamente lo que D13 prohibe.
    assert clause.count(" OR ") == 2
    assert " AND " not in clause
