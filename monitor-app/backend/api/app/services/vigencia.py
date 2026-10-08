"""Guardar la vigencia de un tipo de documento (HU-C1, entrega 2b).

La vigencia es el tipo (`compliance_requirements.expiration_policy`) y sus
parámetros (la regla base de `compliance_requirement_rules`). Se escriben
juntos y en la transacción de quien llama; la coherencia entre los dos la
valida la base al confirmar (`validar_vigencia_de_requisito`, CONSTRAINT
TRIGGER diferido).

Versionado (HU-C1, regla 6: cambiar la política no reescribe lo aprobado):
- la primera regla rige desde siempre (`-infinity`);
- cambiar los parámetros que DEFINEN el vencimiento (meses, frecuencia, día
  tope, de qué mes es) en un tipo EN USO crea una versión que rige desde hoy,
  y lo anterior se sigue evaluando con la regla vieja; dos cambios el mismo
  día dejan una sola versión de hoy;
- el aviso y la gracia rigen DE INMEDIATO en todas las versiones (decisión
  del usuario, 08/10): cuándo avisar no reescribe lo aprobado, y versionarlo
  dejaba el F30-1 ya cargado avisando con los días viejos;
- sin nada cargado no hay pasado que proteger: se corrige la regla;
- cambiar de TIPO reinicia la regla, porque los documentos del tipo anterior no
  traen los datos del nuevo (un "no vence" no tiene fecha de emisión).

Las ventanas por cliente (reglas con shipper_id) no se tocan acá.
"""
from __future__ import annotations

from typing import Optional

from ..schemas.requirement import VigenciaBody

# Los que definen CUÁNDO vence un documento: se versionan (regla 6).
VERSIONADOS = ("validity_months", "frequency_months", "cutoff_day", "period_offset_months")
# Cuándo avisar y cuánto tolerar: rigen de inmediato, en todas las versiones.
INMEDIATOS = ("warning_days", "grace_days")
PARAMETROS = VERSIONADOS + INMEDIATOS
_COLUMNAS = ", ".join(PARAMETROS)

# La regla base que rige HOY para un requisito: la versión más reciente que
# ya empezó. Es lo que muestra el catálogo y lo que compara el guardado.
SQL_REGLA_BASE_VIGENTE = f"""
    SELECT {_COLUMNAS}
    FROM public.compliance_requirement_rules
    WHERE requirement_id = $1 AND shipper_id IS NULL
      AND vigente_desde <= public.hoy_chile()
    ORDER BY vigente_desde DESC
    LIMIT 1
"""


def _necesita_regla(v: VigenciaBody) -> bool:
    """Los tipos sin parámetros solo llevan regla si cambian el aviso o la
    gracia; si no, rige el aviso general y no hay nada que guardar."""
    return (v.politica in ("ISSUE_PLUS_MONTHS", "CALENDAR_PERIOD")
            or v.warning_days is not None or v.grace_days != 0)


def _parametros(v: VigenciaBody) -> dict:
    return {campo: getattr(v, campo) for campo in PARAMETROS}


async def regla_base_vigente(conn, requirement_id: str) -> Optional[dict]:
    fila = await conn.fetchrow(SQL_REGLA_BASE_VIGENTE, requirement_id)
    return dict(fila) if fila else None


async def en_uso(conn, requirement_id: str) -> bool:
    """Si algún documento de este tipo ya se cargó: entonces hay un pasado
    que la regla nueva no puede reescribir."""
    return await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM public.compliance_records "
        "WHERE requirement_id = $1 AND file_url IS NOT NULL)",
        requirement_id,
    )


async def guardar_vigencia(conn, requirement_id: str, v: VigenciaBody) -> dict:
    """Escribe el tipo y su regla base según el versionado del módulo.

    Devuelve `{"antes": {...}, "despues": {...}, "rige_desde_hoy": bool}` con
    el tipo y los parámetros, para la auditoría y la vista previa."""
    politica_actual = await conn.fetchval(
        "SELECT expiration_policy FROM public.compliance_requirements WHERE id = $1",
        requirement_id,
    )
    regla_actual = await regla_base_vigente(conn, requirement_id)
    antes = {"politica": politica_actual, **(regla_actual or {})}
    nueva = _parametros(v) if _necesita_regla(v) else None
    despues = {"politica": v.politica, **(nueva or {})}
    rige_desde_hoy = False

    if politica_actual != v.politica:
        await conn.execute(
            "UPDATE public.compliance_requirements SET expiration_policy = $2 WHERE id = $1",
            requirement_id, v.politica,
        )

    if nueva is None:
        await conn.execute(
            "DELETE FROM public.compliance_requirement_rules "
            "WHERE requirement_id = $1 AND shipper_id IS NULL",
            requirement_id,
        )
    elif politica_actual != v.politica or regla_actual is None:
        # Tipo nuevo, o primera regla: rige desde siempre.
        await conn.execute(
            "DELETE FROM public.compliance_requirement_rules "
            "WHERE requirement_id = $1 AND shipper_id IS NULL",
            requirement_id,
        )
        await conn.execute(
            f"INSERT INTO public.compliance_requirement_rules (requirement_id, {_COLUMNAS}) "
            f"VALUES ($1, $2, $3, $4, $5, $6, $7)",
            requirement_id, *nueva.values(),
        )
    elif nueva != regla_actual:
        cambia_cuando_vence = any(nueva[c] != regla_actual[c] for c in VERSIONADOS)
        if cambia_cuando_vence and await en_uso(conn, requirement_id):
            rige_desde_hoy = True
            await conn.execute(
                f"""
                INSERT INTO public.compliance_requirement_rules
                    (requirement_id, vigente_desde, {_COLUMNAS})
                VALUES ($1, public.hoy_chile(), $2, $3, $4, $5, $6, $7)
                ON CONFLICT (requirement_id, shipper_id, vigente_desde) DO UPDATE SET
                    {", ".join(f"{c} = EXCLUDED.{c}" for c in PARAMETROS)}
                """,
                requirement_id, *nueva.values(),
            )
        elif cambia_cuando_vence:
            # Sin nada cargado no hay pasado: se corrige la versión vigente.
            await conn.execute(
                f"""
                UPDATE public.compliance_requirement_rules SET
                    {", ".join(f"{c} = ${i}" for i, c in enumerate(VERSIONADOS, start=2))}
                WHERE requirement_id = $1 AND shipper_id IS NULL
                  AND vigente_desde = (
                      SELECT max(vigente_desde) FROM public.compliance_requirement_rules
                      WHERE requirement_id = $1 AND shipper_id IS NULL
                        AND vigente_desde <= public.hoy_chile())
                """,
                requirement_id, *(nueva[c] for c in VERSIONADOS),
            )
        # El aviso y la gracia, en TODAS las versiones de la regla base.
        await conn.execute(
            "UPDATE public.compliance_requirement_rules SET warning_days = $2, grace_days = $3 "
            "WHERE requirement_id = $1 AND shipper_id IS NULL",
            requirement_id, nueva["warning_days"], nueva["grace_days"],
        )

    return {"antes": antes, "despues": despues, "rige_desde_hoy": rige_desde_hoy}
