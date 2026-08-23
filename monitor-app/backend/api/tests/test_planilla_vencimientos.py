"""La planilla de vencimientos, ejercitada contra Postgres de verdad.

POR QUE ACA Y NO CON AsyncMock. Un mock devuelve las claves que se le dicen
que devuelva, asi que nunca contradice al SQL. En este mismo router eso ya
dejo pasar un 500 con las 916 y las 1.292 en verde (renombrar un documento,
21/08). La planilla escribe con `unnest` sobre arreglos y lee con un
`ANY($1::uuid[])`: si alguno de esos casts esta mal, un mock no se entera.

COMO SE PROTEGE LA BASE. Es la unica base que hay, o sea produccion. Cada test
recibe `conexion_revertida`, una conexion ya adentro de una transaccion que el
fixture revierte en un `finally`, y los datos los crea el propio test ahi
adentro. Ademas `guardia_de_produccion` toma la huella de
public.compliance_records antes y despues de la sesion.

    venv/bin/python -m pytest tests/test_planilla_vencimientos.py -q
"""
from __future__ import annotations

import io
import re
from datetime import date, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException, UploadFile

from app.routers.compliance import (
    _filas_de_planilla,
    _planilla_a_csv,
    cargar_planilla_de_vencimientos,
    resumen_de_planilla_de_vencimientos,
)
from app.services.plantilla_vencimientos import (
    COLUMNAS,
    COLUMNA_EDITABLE,
    COLUMNA_LLAVE,
    FUENTE_AUDITORIA,
    SQL_APLICAR,
    SQL_AUDITAR,
)
from tests.conftest import PoolDeUnaConexion, _usuario_real

pytestmark = pytest.mark.integracion

PREFIJO = "ZZ-TEST-PLANILLA"


# ── Andamiaje ────────────────────────────────────────────────────────────────


async def _empresa_activa(conn) -> str:
    """Una empresa ACTIVE. Al insertarla, `trg_reconcile_new_carrier` le siembra
    sus compliance_records en MISSING — o sea que las filas de la planilla las
    produce el trigger real, no un INSERT a mano que podria no parecerse."""
    suf = uuid4().hex[:10]
    return await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id, operational_status) "
        "VALUES ($1, $2, 'ACTIVE') RETURNING id",
        f"{PREFIJO} {suf}", f"{PREFIJO}-{suf}",
    )


async def _registros_de(conn, empresa, *, con_vencimiento: bool) -> list:
    return await conn.fetch(
        """
        SELECT cr.id::text AS id, req.name AS documento, cr.expiration_date
        FROM public.compliance_records cr
        JOIN public.compliance_requirements req ON req.id = cr.requirement_id
        WHERE cr.entity_type = 'CARRIER' AND cr.entity_id = $1
          AND cr.is_current = true AND req.is_active = true
          AND req.has_expiration = $2
        ORDER BY req.name
        """,
        empresa, con_vencimiento,
    )


def _csv_con(filas: list[dict]) -> bytes:
    """Escribe con el MISMO escritor que baja la planilla. Es el punto: el test
    no inventa un formato, usa el que la aplicacion produce."""
    return _planilla_a_csv(filas)


def _subir(contenido: bytes) -> UploadFile:
    return UploadFile(file=io.BytesIO(contenido), filename="vencimientos.csv")


async def _fila_de_planilla(pool, registro_id: str) -> dict:
    """La fila real que la planilla emitiria para ese registro."""
    for fila in await _filas_de_planilla(pool, "todas"):
        if fila[COLUMNA_LLAVE] == registro_id:
            return fila
    raise AssertionError(f"la planilla no trajo el registro {registro_id}")


# ── Los tests ────────────────────────────────────────────────────────────────


async def test_la_planilla_solo_trae_documentos_que_piden_fecha(conexion_revertida):
    """Un documento sin vencimiento en una planilla de fechas es una celda que
    invita a llenarse para despues ser rechazada."""
    pool = PoolDeUnaConexion(conexion_revertida)
    empresa = await _empresa_activa(conexion_revertida)

    con_fecha = await _registros_de(conexion_revertida, empresa, con_vencimiento=True)
    sin_fecha = await _registros_de(conexion_revertida, empresa, con_vencimiento=False)
    assert con_fecha and sin_fecha, "la empresa sintetica tiene que tener de los dos"

    ids_en_planilla = {f[COLUMNA_LLAVE] for f in await _filas_de_planilla(pool, "activas")}

    assert {r["id"] for r in con_fecha} <= ids_en_planilla
    assert not ({r["id"] for r in sin_fecha} & ids_en_planilla), (
        "entraron documentos que no llevan vencimiento: "
        f"{sorted(r['documento'] for r in sin_fecha if r['id'] in ids_en_planilla)}"
    )


async def test_el_ida_y_vuelta_cierra(conexion_revertida):
    """LA invariante de este trabajo: lo que el escritor produce, el parser lo
    lee. Se escribe la planilla de verdad, se completa una celda, y se sube el
    mismo archivo."""
    pool = PoolDeUnaConexion(conexion_revertida)
    usuario = await _usuario_real(conexion_revertida)
    empresa = await _empresa_activa(conexion_revertida)
    objetivo = (await _registros_de(conexion_revertida, empresa, con_vencimiento=True))[0]
    vence = date.today() + timedelta(days=120)

    fila = await _fila_de_planilla(pool, objetivo["id"])
    fila[COLUMNA_EDITABLE] = vence.strftime("%d-%m-%Y")

    resultado = await cargar_planilla_de_vencimientos(
        file=_subir(_csv_con([fila])), dry_run=False, pool=pool, user=usuario,
    )

    assert resultado["cambian"] == 1 and resultado["aplicado"] is True
    assert resultado["total_errores"] == 0, resultado["errores"]

    guardado = await conexion_revertida.fetchrow(
        "SELECT expiration_date, is_manual_override, overridden_by "
        "FROM public.compliance_records WHERE id = $1::uuid",
        objetivo["id"],
    )
    assert guardado["expiration_date"] == vence
    assert guardado["is_manual_override"] is True, (
        "sin is_manual_override, la proxima corrida de Mage pisa la fecha cargada"
    )
    assert str(guardado["overridden_by"]) == usuario["sub"]


async def test_la_fecha_no_aprueba_el_documento(conexion_revertida):
    """El estandar de la industria son dos ejes: evidencia y vigencia. Cargar la
    fecha mueve la vigencia y NO puede tocar la evidencia — si el status pasara
    a aprobado, la empresa se pondria en verde sin que nadie haya visto el
    papel."""
    pool = PoolDeUnaConexion(conexion_revertida)
    usuario = await _usuario_real(conexion_revertida)
    empresa = await _empresa_activa(conexion_revertida)
    objetivo = (await _registros_de(conexion_revertida, empresa, con_vencimiento=True))[0]

    antes = await conexion_revertida.fetchval(
        "SELECT status FROM public.compliance_records WHERE id = $1::uuid", objetivo["id"]
    )
    fila = await _fila_de_planilla(pool, objetivo["id"])
    fila[COLUMNA_EDITABLE] = (date.today() + timedelta(days=60)).strftime("%d-%m-%Y")
    await cargar_planilla_de_vencimientos(
        file=_subir(_csv_con([fila])), dry_run=False, pool=pool, user=usuario,
    )

    despues = await conexion_revertida.fetchrow(
        "SELECT status, file_url FROM public.compliance_records WHERE id = $1::uuid",
        objetivo["id"],
    )
    assert despues["status"] == antes == "MISSING"
    assert despues["file_url"] is None


async def test_dry_run_cuenta_y_no_escribe(conexion_revertida):
    pool = PoolDeUnaConexion(conexion_revertida)
    usuario = await _usuario_real(conexion_revertida)
    empresa = await _empresa_activa(conexion_revertida)
    objetivo = (await _registros_de(conexion_revertida, empresa, con_vencimiento=True))[0]

    fila = await _fila_de_planilla(pool, objetivo["id"])
    fila[COLUMNA_EDITABLE] = (date.today() + timedelta(days=90)).strftime("%d-%m-%Y")

    vista = await cargar_planilla_de_vencimientos(
        file=_subir(_csv_con([fila])), dry_run=True, pool=pool, user=usuario,
    )

    assert vista["cambian"] == 1 and vista["aplicado"] is False
    sigue_vacia = await conexion_revertida.fetchval(
        "SELECT expiration_date FROM public.compliance_records WHERE id = $1::uuid",
        objetivo["id"],
    )
    assert sigue_vacia is None, "el dry_run escribio"


async def test_la_fila_vacia_no_se_toca(conexion_revertida):
    """Es lo que permite bajar la planilla entera y llenar solo lo que se sabe.
    Una fila en blanco no puede borrar una fecha que ya estaba."""
    pool = PoolDeUnaConexion(conexion_revertida)
    usuario = await _usuario_real(conexion_revertida)
    empresa = await _empresa_activa(conexion_revertida)
    registros = await _registros_de(conexion_revertida, empresa, con_vencimiento=True)
    ya_tiene, a_llenar = registros[0], registros[1]
    previa = date.today() + timedelta(days=200)
    await conexion_revertida.execute(
        "UPDATE public.compliance_records SET expiration_date = $2 WHERE id = $1::uuid",
        ya_tiene["id"], previa,
    )

    fila_vacia = await _fila_de_planilla(pool, ya_tiene["id"])
    fila_vacia[COLUMNA_EDITABLE] = ""
    fila_llena = await _fila_de_planilla(pool, a_llenar["id"])
    fila_llena[COLUMNA_EDITABLE] = (date.today() + timedelta(days=30)).strftime("%d-%m-%Y")

    resultado = await cargar_planilla_de_vencimientos(
        file=_subir(_csv_con([fila_vacia, fila_llena])),
        dry_run=False, pool=pool, user=usuario,
    )

    assert resultado["vacias"] == 1 and resultado["cambian"] == 1
    intacta = await conexion_revertida.fetchval(
        "SELECT expiration_date FROM public.compliance_records WHERE id = $1::uuid",
        ya_tiene["id"],
    )
    assert intacta == previa, "la fila en blanco borro una fecha que ya estaba"


async def test_no_acepta_fecha_en_un_documento_que_no_vence(conexion_revertida):
    pool = PoolDeUnaConexion(conexion_revertida)
    usuario = await _usuario_real(conexion_revertida)
    empresa = await _empresa_activa(conexion_revertida)
    sin_vencimiento = (await _registros_de(conexion_revertida, empresa, con_vencimiento=False))[0]

    fila = {c["csv_key"]: "" for c in COLUMNAS}
    fila[COLUMNA_LLAVE] = sin_vencimiento["id"]
    fila[COLUMNA_EDITABLE] = "01-01-2027"

    with pytest.raises(HTTPException) as caso:
        await cargar_planilla_de_vencimientos(
            file=_subir(_csv_con([fila])), dry_run=False, pool=pool, user=usuario,
        )
    assert caso.value.status_code == 422
    assert "no lleva fecha de vencimiento" in str(caso.value.detail)


async def test_se_escribe_en_una_sola_pasada_y_queda_auditado(conexion_revertida):
    """`trg_refresh_view_on_compliance` refresca una vista materializada POR
    STATEMENT sobre compliance_records: de a una, 1.326 filas son 1.326
    refrescos. El RETURNING prueba que las tres filas salieron de UNA sentencia,
    y la auditoria que la pasada quedo registrada."""
    pool = PoolDeUnaConexion(conexion_revertida)
    usuario = await _usuario_real(conexion_revertida)
    empresa = await _empresa_activa(conexion_revertida)
    tres = (await _registros_de(conexion_revertida, empresa, con_vencimiento=True))[:3]
    assert len(tres) == 3

    filas = []
    for numero, registro in enumerate(tres, start=1):
        fila = await _fila_de_planilla(pool, registro["id"])
        fila[COLUMNA_EDITABLE] = (date.today() + timedelta(days=30 * numero)).strftime("%d-%m-%Y")
        filas.append(fila)

    auditoria_antes = await conexion_revertida.fetchval(
        "SELECT count(*) FROM public.audit_log WHERE source = $1", FUENTE_AUDITORIA
    )
    resultado = await cargar_planilla_de_vencimientos(
        file=_subir(_csv_con(filas)), dry_run=False, pool=pool, user=usuario,
    )
    assert resultado["cambian"] == 3

    auditoria_despues = await conexion_revertida.fetchval(
        "SELECT count(*) FROM public.audit_log WHERE source = $1", FUENTE_AUDITORIA
    )
    assert auditoria_despues - auditoria_antes == 3


@pytest.mark.parametrize(
    "sql, argumentos_que_pasa_el_endpoint",
    [(SQL_APLICAR, 3), (SQL_AUDITAR, 6)],
)
def test_los_placeholders_coinciden_con_los_argumentos(sql, argumentos_que_pasa_el_endpoint):
    """Sustituir $n por literales para probar una consulta no prueba el binding.
    Un placeholder de mas o de menos revienta recien en produccion, con un
    'the server expects N arguments' que no dice cual falta."""
    mayor = max(int(n) for n in re.findall(r"\$(\d+)", sql))
    assert mayor == argumentos_que_pasa_el_endpoint


def test_la_planilla_baja_con_bom(conexion_revertida=None):
    """Sin BOM, Excel es-CL abre "Revision Tecnica" con las tildes rotas y la
    persona devuelve un archivo con los nombres ya corrompidos."""
    contenido = _planilla_a_csv([{c["csv_key"]: "x" for c in COLUMNAS}])
    assert contenido.startswith(b"\xef\xbb\xbf")
    assert contenido.decode("utf-8-sig").splitlines()[0] == ";".join(
        c["csv_key"] for c in COLUMNAS
    )
