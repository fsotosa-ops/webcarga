from app.services.requirement_conditions import SQL_ENTIDADES_QUE_APLICAN


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
