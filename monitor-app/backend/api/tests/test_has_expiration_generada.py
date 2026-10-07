"""`has_expiration` es una columna GENERADA desde `expiration_policy` (HU-C1, 7a).

Es el paso "expand/contract" antes del DROP: la API ya no la lee, pero una
revisión vieja que vuelva por rollback sí. Si la columna fuera escribible, se
desincronizaría con la primera política editada desde Configuración, que es
exactamente lo que le pasó al F30-1. Generada, no puede."""
from uuid import uuid4

import asyncpg
import pytest

pytestmark = pytest.mark.integracion


async def _requisito(conn, politica: str) -> str:
    suf = uuid4().hex[:8].upper()
    return await conn.fetchval(
        """
        INSERT INTO public.compliance_requirements
            (requirement_code, name, target_entity, requirement_level,
             expiration_policy, is_active)
        VALUES ($1, $2, 'CARRIER', 'LEGAL_MANDATORY', $3, false)
        RETURNING id
        """,
        f"ZZ_TEST_GENERADA_{suf}", f"ZZ-TEST-GENERADA {suf}", politica,
    )


async def _lleva(conn, requisito) -> bool:
    return await conn.fetchval(
        "SELECT has_expiration FROM public.compliance_requirements WHERE id = $1", requisito,
    )


async def test_la_columna_vieja_sigue_a_la_politica(conexion_revertida):
    requisito = await _requisito(conexion_revertida, "REQUIRED")
    assert await _lleva(conexion_revertida, requisito) is True

    for politica, esperado in [("OPTIONAL", True), ("NONE", False), ("REQUIRED", True)]:
        await conexion_revertida.execute(
            "UPDATE public.compliance_requirements SET expiration_policy = $2 WHERE id = $1",
            requisito, politica,
        )
        assert await _lleva(conexion_revertida, requisito) is esperado, politica


async def test_nadie_puede_escribir_la_columna_vieja(conexion_revertida):
    requisito = await _requisito(conexion_revertida, "NONE")
    with pytest.raises(asyncpg.PostgresError):
        async with conexion_revertida.transaction():
            await conexion_revertida.execute(
                "UPDATE public.compliance_requirements SET has_expiration = true WHERE id = $1",
                requisito,
            )
