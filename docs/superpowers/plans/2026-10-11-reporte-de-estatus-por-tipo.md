# Reporte de estatus por tipo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El reporte de estatus del día (Cierre › Reporte) se ve por tipo de operación —selector Tractoreo | Equipo
Completo arriba— en seis secciones nombradas por la pregunta que responden, con la tabla de Asignados como árbol
plegable Cliente → Origen → Empresa (minuta 09/10, ítems 8 y 14).

**Architecture:** El backend reorganiza en Python, por tipo, las mismas filas que ya arma (`_build_asset_rows`,
`_build_driver_rows`) y devuelve `by_operation_type` con claves en inglés; las claves `section*` se retiran. El
frontend arma el árbol de Asignados en un solo módulo (`lib/reporte/arbolDeAsignados.ts`) que usan la pantalla y el
Excel; "Copiar estatus" copia el DOM a la vista, así que copia lo mismo que se ve. El componente actual (622 líneas,
8 pestañas) se parte en un armazón y dos archivos de secciones.

**Tech Stack:** FastAPI + asyncpg (pytest), Next.js + React Query + Tailwind (vitest + Testing Library),
`write-excel-file` 4.1.1 (celdas `{ value, fontWeight: 'bold' }`).

**Spec:** `docs/superpowers/specs/2026-10-11-reporte-de-estatus-por-tipo-design.md`

## Global Constraints

- Claves nuevas de la API en inglés, exactamente las de §3 del spec (`by_operation_type`, `summary`, `assigned`,
  `worked_without_assignment`, `second_legs`, `not_working`, `carriers` y sus campos). Código interno Python/TS y
  textos de la UI en español.
- UI en español neutral, nunca voseo (`lib/copy/espanol-neutral.test.ts` lo revisa). Cero emojis: solo `lucide-react`.
- No agregar tamaños de letra ni colores nuevos: reutilizar las clases que ya usa `StatusReportSection.tsx`
  (`text-xs`, `text-[10px]`, `text-[11px]`, `text-gray-*`, `text-accent`, `text-dato`, `text-informativo`, `text-etiqueta`).
- Sin migraciones ni cambios en dbt/Mage: la única consulta que cambia es `_TODAY_TRIPS_SQL` (agrega el conductor).
- Tests por tarea: solo los del área tocada (`venv/bin/python -m pytest tests/test_status_report.py ...` en
  `monitor-app/backend/api`; `npx vitest run <archivos>` y `npx tsc --noEmit` en `monitor-app/frontend`). **No** correr
  la suite completa del backend ni `npm run build` por tarea; la suite completa corre una sola vez, en segundo plano,
  antes del push (Task 5).
- El reporte es de lectura con `operations.read`, como hoy; no se agrega permiso.

## Review Focus

1. **Ventana de despliegue con frontend viejo y backend nuevo.** Backend y frontend se despliegan por separado desde
   el mismo push; si el backend llega primero, el frontend viejo lee `data.section1_resumen.…` y revienta. El spec
   cubre solo el caso inverso ("Actualizando el reporte…"). Ruling del plan: se acepta en dev (ventana de minutos, el
   reporte se mira una vez al día); el reviewer debe confirmar que el frontend NUEVO nunca revienta con ninguna de las
   dos formas (Task 4, test "formato viejo").
2. **Cambiar de tipo o de cliente con el árbol plegado.** Una persona pliega "Walmart" en Tractoreo, cambia a Equipo
   Completo y vuelve: el árbol no puede quedar con un estado inicial calculado para otros datos (clase de bug "draft sin
   resincronizar"). El estado guarda solo lo que la persona tocó (`plegados`/`desplegados`), nunca un default copiado
   de los datos; test en Task 4.
3. **Línea sin motivo.** Un tracto o conductor en `SIN_RESOLVER` no tiene motivo: sin columna propia, el total de la
   fila no cuadra con la suma de las columnas visibles. Se cuenta en "Sin motivo", al final; test en Task 1.
4. **Nombres de hoja de Excel.** Excel rechaza nombres de más de 31 caracteres ("Segundas vueltas · Eq. Completo" mide
   31 justo); test en Task 3 que recorre todas las hojas.
5. **Cliente filtrado sin datos de un tipo.** Con "Sodimac" filtrado, Equipo Completo puede quedar sin asignados: cada
   sección muestra su mensaje vacío, nunca una tabla con encabezados y cero filas; test en Task 4.

## Rulings tomados al escribir el plan

- **"Sin motivo".** Las filas sin motivo cuentan en una columna "Sin motivo", siempre la última de `reasons`.
- **`summary.not_working` cuenta equipos, no conductores.** Son los equipos del tipo sin carga con categoría
  `NO_TRABAJANDO` o `SIN_RESOLVER`; así `assigned` + trabajaron sin asignación + `not_working` dan el total del tipo. En
  Tractoreo, la sección "No trabajaron" sigue por conductor (spec §3), y la pantalla lo dice: "Por conductor".
- **Se retiran del reporte** los viajes multi-día (`multi_dia_activos`) y el total con "Sin clasificar": el spec no los
  incluye en Resumen. Los equipos sin tipo no entran en ninguno de los dos.
- **`sumar` se muda a `lib/reporte/sumar.ts`.** Si quedara en `exportarReporte.ts`, ese archivo importaría el árbol y
  el árbol importaría `sumar` de vuelta: dependencia circular.
- **Columnas en 0.** Las de motivo se garantizan en el backend: `reasons` trae solo motivos con casos, calculados
  después del filtro de cliente. Las cuatro de zona (RM, Z0, Región, Sin clasificar) se dibujan siempre, como en el CSV
  de Pablo.
- **Pruebas del backend.** El spec pide integración con ROLLBACK y datos sintéticos. El archivo de tests ya prueba las
  funciones puras más el endpoint con el pool simulado; se sigue ese patrón. A Postgres de verdad se lleva solo lo que
  cambia en SQL, preparando `_TODAY_TRIPS_SQL` con `conexion_revertida` (Task 1).

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `monitor-app/backend/api/app/routers/status_report.py` (modificar) | Construye `by_operation_type`. Retira las funciones `_section*` y los cross-tabs viejos |
| `monitor-app/backend/api/tests/test_status_report.py` (reescribir las secciones) | Builders puros y contrato del endpoint |
| `monitor-app/backend/api/tests/test_reporte_de_estatus_integracion.py` (nuevo) | `_TODAY_TRIPS_SQL` compila contra Postgres y trae `driver_name` |
| `monitor-app/frontend/lib/types.ts` (modificar) | `OperationTypeReport` y compañía. Retira `ZoneCrossTab`, `MotivoCrossTab`, `VueltaRow`, `DriverDetailRow` |
| `monitor-app/frontend/lib/reporte/sumar.ts` (nuevo) | `sumar`, movido desde `exportarReporte.ts` |
| `monitor-app/frontend/lib/reporte/tiposDeOperacion.ts` (nuevo) | Las dos claves de tipo con su etiqueta larga y corta |
| `monitor-app/frontend/lib/reporte/arbolDeAsignados.ts` (+ `.test.ts`) (nuevo) | Árbol Cliente → Origen → Empresa con subtotales, y sus filas en orden de lectura |
| `monitor-app/frontend/lib/reporte/exportarReporte.ts` (+ `.test.ts`) (reescribir) | Hojas del Excel: sección × tipo, más Dotación |
| `monitor-app/frontend/components/dashboard/sections/reporte/TablaDeAsignados.tsx` (nuevo) | El árbol plegable en pantalla |
| `monitor-app/frontend/components/dashboard/sections/reporte/SeccionesDelReporte.tsx` (nuevo) | Resumen, Asignados, Segundas vueltas, No trabajaron, Empresas, el mensaje vacío y la tabla de motivos |
| `monitor-app/frontend/components/dashboard/sections/StatusReportSection.tsx` (reescribir) | Armazón: selector, pestañas, filtro, acciones, estados, resumen imprimible, copiar |
| `monitor-app/frontend/components/dashboard/sections/StatusReportSection.test.tsx` (reescribir) | Comportamiento de la pantalla |

---

### Task 1: Backend — el reporte por tipo de operación

**Files:**
- Modify: `monitor-app/backend/api/app/routers/status_report.py`
- Test: `monitor-app/backend/api/tests/test_status_report.py`
- Create: `monitor-app/backend/api/tests/test_reporte_de_estatus_integracion.py`

**Interfaces:**
- Consumes: `_build_asset_rows`, `_build_driver_rows`, `_filter_by_client`, `_zone_bucket`, `_SQL_MOTIVOS_DEL_GRUPO`,
  `_SQL_ETIQUETA_SIN_CONDUCTOR`, `compute_fleet_driver_gap`, `frescura_del_dia` (todos existentes).
- Produces: `GET /api/v1/status-report` devuelve
  `{business_date, client_filter, calculado_a, pendiente_desde, by_operation_type: {tractoreo, equipo_completo}}` con el
  `OperationTypeReport` de spec §3. Funciones nuevas (Python, internas):
  `_motivos_que_ocurrieron(catalogo: list[str], ocurridos: Iterable[str]) -> list[str]`,
  `_por_motivo(filas: list[dict]) -> list[dict]`, `_resumen_del_tipo(rows) -> dict`, `_asignados(rows) -> list[dict]`,
  `_cargaron_en_otro_origen(rows) -> list[dict]`, `_trabajaron_sin_asignacion(rows, catalogo) -> dict`,
  `_segundas_vueltas(rows) -> list[dict]`, `_no_trabajaron_por_conductor(driver_rows, catalogo, *, faltantes, sin_conductor) -> dict`,
  `_no_trabajaron_por_equipo(rows, catalogo) -> dict`, `_empresas(rows) -> list[dict]`,
  `_reporte_del_tipo(rows, *, no_trabajaron, catalogo_sin_asignacion) -> dict`.

- [ ] **Step 1: Reemplazar los tests de secciones por los del contrato nuevo**

En `tests/test_status_report.py`:
- Reemplaza el bloque `from app.routers.status_report import (...)` por el de abajo.
- Agrega `"driver_name": "Juan Pérez"` a la base de `_row` y quita `"dias_en_curso": 0`.
- Borra estos tests:
  - `test_summary_…`, `test_section1_…`, `test_section2_…`, `test_section3_…`, `test_section4_…` (los tres);
  - `test_section5_…`, `test_section_tractoreo_por_empresa_…`, `test_section6_…`;
  - `test_get_status_report_returns_all_sections_with_empty_roster`, `test_get_status_report_includes_section4_driver_detail`;
  - `test_las_columnas_de_motivo_…`, `test_la_asistencia_…`, `test_quien_no_trabajo_…`, `test_el_desvio_…`, `test_sin_cd_base_…`;
  - `test_seccion2_…` (los dos), `test_un_origen_con_solo_…`, `test_seccion4_suma_…`, `test_sin_el_motivo_…`;
  - la constante `MOTIVOS_SIN_CARGA`.
- Se conservan:
  - `frescura`, `_row`, `_driver_row`, `_faltante`;
  - `test_zone_bucket_…`, `test_filter_by_client_…`, `test_get_status_report_requires_valid_fecha`;
  - `test_build_driver_rows_…` (los dos), `test_roster_sql_lee_el_codigo_no_la_etiqueta`.

Al final del archivo, agrega:

```python
from app.routers.status_report import (
    _asignados,
    _build_driver_rows,
    _cargaron_en_otro_origen,
    _empresas,
    _filter_by_client,
    _motivos_que_ocurrieron,
    _no_trabajaron_por_conductor,
    _no_trabajaron_por_equipo,
    _resumen_del_tipo,
    _segundas_vueltas,
    _trabajaron_sin_asignacion,
    _zone_bucket,
    router,
)
```

```python
# ── Spec 2026-10-11: el reporte por tipo de operación ────────────────────────
# Cada tipo trae las mismas seis claves y se arma con las mismas funciones; el
# endpoint solo decide qué filas le tocan a cada uno.

def test_los_motivos_son_solo_los_que_ocurrieron_en_el_orden_del_catalogo():
    """Antes salían todos los del catálogo: 16 columnas, casi todas en 0."""
    assert _motivos_que_ocurrieron(
        ["Panne", "Vacaciones", "Licencia"], ["Licencia", "Panne", "Panne"],
    ) == ["Panne", "Licencia"]


def test_un_motivo_retirado_que_ocurrio_va_despues_y_sin_motivo_al_final():
    assert _motivos_que_ocurrieron(
        ["Panne"], ["Sin motivo", "En abstención", "Panne"],
    ) == ["Panne", "En abstención", "Sin motivo"]


def test_resumen_del_tipo_separa_asignados_de_los_que_no_trabajaron():
    rows = [
        _row(asset_id="a1"),
        _row(asset_id="a2", con_carga=False, category="TRABAJANDO_SIN_ASIGNACION",
             unassigned_reason_label="Esperando carga"),
        _row(asset_id="a3", con_carga=False, category="NO_TRABAJANDO", unassigned_reason_label="Panne"),
        _row(asset_id="a4", con_carga=False, category="SIN_RESOLVER", unassigned_reason_label=None),
    ]
    resumen = _resumen_del_tipo(rows)
    assert {k: resumen[k] for k in ("total", "assigned", "not_working", "utilization_pct")} == {
        "total": 4, "assigned": 1, "not_working": 2, "utilization_pct": 25.0,
    }
    assert resumen["by_client"] == [{"client_name": "Walmart", "assigned": 1}]


def test_resumen_agrupa_la_asistencia_por_el_origen_habitual_y_no_por_donde_cargo():
    """Alguien de Peñón que hoy cargó en Quilicura es asistencia de PEÑÓN."""
    rows = [
        _row(asset_id="a1", home_cd="CD El Peñón", origin_cd="CD Quilicura"),
        _row(asset_id="a2", home_cd="CD El Peñón", origin_cd=None, con_carga=False, category="NO_TRABAJANDO"),
        _row(asset_id="a3", home_cd=None, origin_cd="CD El Peñón"),
    ]
    assert _resumen_del_tipo(rows)["by_home_origin"] == [
        {"origin": "CD El Peñón", "enrolled": 2, "assigned": 1},
        {"origin": "Sin origen", "enrolled": 1, "assigned": 1},
    ]


def test_resumen_de_un_tipo_sin_equipos_no_divide_por_cero():
    assert _resumen_del_tipo([])["utilization_pct"] == 0.0


def test_asignados_cruza_cliente_origen_real_y_empresa_por_zona():
    rows = [
        _row(asset_id="a1", client_name="Walmart", origin_cd="CD Lo Aguirre", destination_zone="RM"),
        _row(asset_id="a2", client_name="Walmart", origin_cd="CD Lo Aguirre", destination_zone="Región"),
        _row(asset_id="a3", client_name="Walmart", origin_cd="CD Quilicura", destination_zone="Z0"),
        _row(asset_id="a4", client_name=None, origin_cd=None, destination_zone="Sin clasificar"),
        # Sin carga: no entra en asignados.
        _row(asset_id="a5", con_carga=False, category="NO_TRABAJANDO"),
    ]
    assert _asignados(rows) == [
        {"client_name": "Sin cliente", "origin": "Sin origen", "carrier_name": "Transportes Sur",
         "rm": 0, "z0": 0, "region": 0, "unclassified": 1, "total": 1},
        {"client_name": "Walmart", "origin": "CD Lo Aguirre", "carrier_name": "Transportes Sur",
         "rm": 1, "z0": 0, "region": 1, "unclassified": 0, "total": 2},
        {"client_name": "Walmart", "origin": "CD Quilicura", "carrier_name": "Transportes Sur",
         "rm": 0, "z0": 1, "region": 0, "unclassified": 0, "total": 1},
    ]


def test_cargaron_en_otro_origen_solo_cuando_hay_con_que_comparar():
    rows = [
        _row(asset_id="a1", tractor_plate="AAAA11", home_cd="CD El Peñón", origin_cd="CD Quilicura"),
        _row(asset_id="a2", tractor_plate="BBBB22", home_cd="CD El Peñón", origin_cd="CD El Peñón"),
        _row(asset_id="a3", tractor_plate="CCCC33", home_cd=None, origin_cd="CD Quilicura"),
        _row(asset_id="a4", tractor_plate="DDDD44", home_cd="CD El Peñón", origin_cd=None, con_carga=False),
    ]
    assert _cargaron_en_otro_origen(rows) == [{
        "tractor_plate": "AAAA11", "carrier_name": "Transportes Sur", "home_origin": "CD El Peñón",
        "origin": "CD Quilicura", "client_name": "Walmart",
    }]


def test_trabajaron_sin_asignacion_por_origen_habitual_y_motivo():
    rows = [
        _row(asset_id="a1"),
        _row(asset_id="a2", home_cd="CD Quilicura", con_carga=False, category="TRABAJANDO_SIN_ASIGNACION",
             unassigned_reason_label="Se retira sin carga"),
        _row(asset_id="a3", con_carga=False, category="NO_TRABAJANDO", unassigned_reason_label="Panne"),
    ]
    seccion = _trabajaron_sin_asignacion(rows, ["Esperando carga", "Se retira sin carga"])
    assert seccion == {
        "reasons": ["Se retira sin carga"],
        "rows": [{"origin": "CD Quilicura", "carrier_name": "Transportes Sur",
                  "counts": {"Se retira sin carga": 1}, "total": 1}],
    }


def test_segundas_vueltas_por_patente_con_su_conductor():
    rows = [
        _row(asset_id="a1", tractor_plate="AAAA11", vueltas=2, driver_name="Ana Soto", destination_zone="Z0"),
        _row(asset_id="a2", tractor_plate="BBBB22", vueltas=1),
        _row(asset_id="a3", tractor_plate="CCCC33", vueltas=0, con_carga=False),
    ]
    assert _segundas_vueltas(rows) == [{
        "tractor_plate": "AAAA11", "carrier_name": "Transportes Sur", "driver_name": "Ana Soto",
        "origin": "CD Lo Aguirre", "destination_zone": "Z0", "legs": 2,
    }]


def test_no_trabajaron_en_tractoreo_va_por_conductor_y_suma_el_faltante_en_sin_conductor():
    driver_rows = [
        _driver_row(driver_id="d1", home_cd="CD El Peñón", unassigned_reason_label="Panne"),
        _driver_row(driver_id="d2", full_name="Eva Ríos", home_cd=None, unassigned_reason_label=None),
    ]
    seccion = _no_trabajaron_por_conductor(
        driver_rows, ["Panne", "Vacaciones", "Sin conductor"],
        faltantes=[_faltante("Transportes Sur", 3, 1), _faltante("Sobra Spa", 1, 2)],
        sin_conductor="Sin conductor",
    )
    assert seccion["reasons"] == ["Panne", "Sin conductor", "Sin motivo"]
    assert seccion["by_reason"] == [
        {"origin": "CD El Peñón", "carrier_name": "Transportes Sur", "counts": {"Panne": 1}, "total": 1},
        {"origin": "Sin origen", "carrier_name": "Transportes Sur",
         "counts": {"Sin motivo": 1, "Sin conductor": 2}, "total": 3},
    ]
    assert seccion["detail"] == [
        {"name": "Eva Ríos", "carrier_name": "Transportes Sur", "home_origin": None,
         "reason": "Sin motivo", "tractor_plate": "ABCD12"},
        {"name": "Juan Pérez", "carrier_name": "Transportes Sur", "home_origin": "CD El Peñón",
         "reason": "Panne", "tractor_plate": "ABCD12"},
    ]


def test_sin_el_motivo_sin_conductor_activo_no_inventa_la_columna():
    seccion = _no_trabajaron_por_conductor(
        [], ["Panne"], faltantes=[_faltante("Transportes Sur", 3, 1)], sin_conductor="Sin conductor")
    assert seccion == {"reasons": [], "by_reason": [], "detail": []}


def test_no_trabajaron_en_equipo_completo_lista_equipos():
    rows = [
        _row(asset_id="a1", tractor_plate="EQUI01", con_carga=False, category="NO_TRABAJANDO",
             unassigned_reason_label="Panne", home_cd="CD Lo Aguirre"),
        # Trabajó sin asignación: no es "no trabajó".
        _row(asset_id="a2", tractor_plate="EQUI02", con_carga=False, category="TRABAJANDO_SIN_ASIGNACION",
             unassigned_reason_label="Esperando carga"),
        _row(asset_id="a3", tractor_plate="EQUI03"),
    ]
    seccion = _no_trabajaron_por_equipo(rows, ["Panne"])
    assert seccion["reasons"] == ["Panne"]
    assert seccion["detail"] == [{"name": "EQUI01", "carrier_name": "Transportes Sur",
                                  "home_origin": "CD Lo Aguirre", "reason": "Panne", "tractor_plate": "EQUI01"}]


def test_empresas_ordena_por_utilizacion():
    rows = [
        _row(asset_id="a1", carrier_name="Norte"), _row(asset_id="a2", carrier_name="Norte", con_carga=False),
        _row(asset_id="a3", carrier_name="Sur"),
    ]
    assert _empresas(rows) == [
        {"carrier_name": "Sur", "enrolled": 1, "assigned": 1, "unassigned": 0, "utilization_pct": 100.0},
        {"carrier_name": "Norte", "enrolled": 2, "assigned": 1, "unassigned": 1, "utilization_pct": 50.0},
    ]


SEIS_CLAVES = {"summary", "assigned", "worked_without_assignment", "second_legs", "not_working", "carriers"}


def _cliente_http(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    return TestClient(app)


def test_get_status_report_devuelve_los_dos_tipos_con_sus_seis_claves():
    pool = AsyncMock()
    conn = AsyncMock()
    conn.fetch.return_value = []
    wire_transactional_conn(pool, conn)
    pool.fetch.return_value = []

    res = _cliente_http(pool).get("/api/v1/status-report?fecha=2026-08-02")

    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"business_date", "client_filter", "calculado_a", "pendiente_desde", "by_operation_type"}
    assert set(body["by_operation_type"]) == {"tractoreo", "equipo_completo"}
    for tipo in body["by_operation_type"].values():
        assert set(tipo) == SEIS_CLAVES


def test_cada_equipo_cuenta_solo_en_su_tipo_y_los_asignados_cuadran_con_el_resumen():
    from app.services.cierre_lineas import GRUPO_NO_TRABAJANDO

    asset_rows = [
        _row(asset_id="t1", tractor_plate="TRAC01", categories=["TRACTOREO"]),
        _row(asset_id="t2", tractor_plate="TRAC02", categories=["TRACTOREO"], client_name="Sodimac"),
        _row(asset_id="e1", tractor_plate="EQUI01", categories=["EQUIPO_COMPLETO"], con_carga=False,
             category="NO_TRABAJANDO", unassigned_reason_label="Panne"),
        _row(asset_id="s1", tractor_plate="SINC01", categories=["SIN_CLASIFICAR"]),
    ]

    async def catalogo(sql, *args):
        return [{"label": "Panne"}, {"label": "Vacaciones"}] if args and args[0] == GRUPO_NO_TRABAJANDO else []

    pool = AsyncMock()
    pool.fetch.side_effect = catalogo
    pool.fetchval.return_value = None
    with patch("app.routers.status_report._build_asset_rows", AsyncMock(return_value=asset_rows)), \
         patch("app.routers.status_report._build_driver_rows", AsyncMock(return_value=[])), \
         patch("app.routers.status_report.compute_fleet_driver_gap", AsyncMock(return_value=[])):
        body = _cliente_http(pool).get("/api/v1/status-report?fecha=2026-08-02").json()

    tractoreo = body["by_operation_type"]["tractoreo"]
    equipo = body["by_operation_type"]["equipo_completo"]
    assert tractoreo["summary"]["total"] == 2 and equipo["summary"]["total"] == 1
    assert sum(r["total"] for r in tractoreo["assigned"]["rows"]) == tractoreo["summary"]["assigned"] == 2
    assert [d["name"] for d in equipo["not_working"]["detail"]] == ["EQUI01"]
    assert equipo["not_working"]["reasons"] == ["Panne"]
    assert tractoreo["not_working"]["detail"] == []


def test_el_filtro_de_cliente_deja_a_los_sin_carga_y_saca_a_los_de_otro_cliente():
    asset_rows = [
        _row(asset_id="t1", client_name="Walmart"),
        _row(asset_id="t2", client_name="Sodimac"),
        _row(asset_id="t3", con_carga=False, client_name=None, category="NO_TRABAJANDO"),
    ]
    pool = AsyncMock()
    pool.fetch.return_value = []
    pool.fetchval.return_value = None
    with patch("app.routers.status_report._build_asset_rows", AsyncMock(return_value=asset_rows)), \
         patch("app.routers.status_report._build_driver_rows", AsyncMock(return_value=[])), \
         patch("app.routers.status_report.compute_fleet_driver_gap", AsyncMock(return_value=[])):
        body = _cliente_http(pool).get("/api/v1/status-report?fecha=2026-08-02&client=Walmart").json()

    resumen = body["by_operation_type"]["tractoreo"]["summary"]
    assert (resumen["total"], resumen["assigned"]) == (2, 1)
```

Crea `tests/test_reporte_de_estatus_integracion.py`:

```python
"""La única consulta que cambió en el rediseño del reporte (spec 2026-10-11):
el conductor del viaje, para "Segundas vueltas". Se prepara contra Postgres de
verdad para fijar que compila y trae la columna, sin depender de qué viajes
haya ese día."""
import pytest

from app.routers.status_report import _TODAY_TRIPS_SQL

pytestmark = pytest.mark.integracion


async def test_los_viajes_del_dia_traen_el_conductor_resuelto(conexion_revertida):
    sentencia = await conexion_revertida.prepare(_TODAY_TRIPS_SQL)
    columnas = [a.name for a in sentencia.get_attributes()]
    assert "driver_name" in columnas
    assert "planning_date" not in columnas, "días en curso salió del reporte"
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_status_report.py tests/test_reporte_de_estatus_integracion.py -q 2>&1 | tail -15`
Expected: falla la colección con `ImportError: cannot import name '_asignados'`. Es la falla correcta: las funciones todavía
no existen.

- [ ] **Step 3: Implementar**

En `app/routers/status_report.py`:

1. **Docstring del módulo.** Reemplaza el párrafo inicial ("Fase 5 (HU-04): Reporte de estatus del día — 6 secciones…")
   por este texto, y deja el resto del docstring:
   ```
   Reporte de estatus del día (HU-04), por tipo de operación (spec 2026-10-11,
   minuta 09/10 ítems 8 y 14): `by_operation_type.{tractoreo,equipo_completo}`
   con las mismas seis claves cada uno. Se construye sobre el mismo modelo
   equipo-céntrico del Cierre del Día. Reusa:
   ```
   Borra también el párrafo "Tarea 6 (plan 2.3…)" del final del docstring, que describe las secciones viejas.

2. **`_TODAY_TRIPS_SQL`: conductor sí, `planning_date` no.**
   - En el comentario de arriba de la consulta, cambia "Trae también planning_date (para 'días en curso' de la
     Sección 1)" por "Trae también el conductor resuelto (para 'Segundas vueltas')".
   - En la consulta, reemplaza `    t.planning_date,` por `    d.full_name AS driver_name,`.
   - Después de `JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id`, agrega
     `LEFT JOIN public.drivers d ON d.id = vfr.resolved_driver_id`.

3. **`_build_asset_rows`.**
   - Borra `dias_en_curso = None` y el bloque `if latest["planning_date"]: ...`.
   - En el dict de la fila, reemplaza `"dias_en_curso": dias_en_curso,` por:
     `"driver_name": latest["driver_name"] if latest else None,`
   - Cambia "derivan las 6 secciones" por "derivan las secciones de cada tipo".

4. **Borra las funciones viejas de sección.** Borra todo, desde `def _summary` hasta el final del archivo, **salvo**:
   - `_filter_by_client` (queda arriba de `_summary`);
   - `_SQL_ETIQUETA_SIN_CONDUCTOR`, `_SQL_MOTIVOS_DEL_GRUPO` y su comentario.

   En lugar de lo borrado, pega lo siguiente:

```python
_SIN_MOTIVO = "Sin motivo"
_TRABAJO_SIN_ASIGNACION = "TRABAJANDO_SIN_ASIGNACION"
# Quien no trabajó, y quien todavía no tiene motivo: no se sabe si trabajó.
_NO_TRABAJO = ("NO_TRABAJANDO", "SIN_RESOLVER")
_TIPOS = {"tractoreo": "TRACTOREO", "equipo_completo": "EQUIPO_COMPLETO"}
_ZONA_A_CLAVE = {"RM": "rm", "Z0": "z0", "Región": "region", "Sin clasificar": "unclassified"}


def _motivo(label: str | None) -> str:
    """Una línea sin motivo cuenta en "Sin motivo": sin esa columna, el total de
    la fila no cuadraría con la suma de las que se ven."""
    return label or _SIN_MOTIVO


def _motivos_que_ocurrieron(catalogo: list[str], ocurridos: Iterable[str]) -> list[str]:
    """Las columnas de motivo: solo las que tuvieron casos ese día (spec 2026-10-11),
    en el orden del catálogo de Configuración. Después, las retiradas que
    aparezcan (un día pasado puede tener una), y "Sin motivo" al final."""
    vistos = set(ocurridos)
    columnas = [m for m in catalogo if m in vistos]
    columnas += sorted(vistos - set(catalogo) - {_SIN_MOTIVO})
    return columnas + ([_SIN_MOTIVO] if _SIN_MOTIVO in vistos else [])


def _por_motivo(filas: list[dict]) -> list[dict]:
    """Origen × empresa, con un conteo por motivo. `filas` trae
    {origin, carrier_name, reason, n}: n es 1 por persona o equipo, o el
    faltante de dotación entero."""
    acc: dict = {}
    for f in filas:
        b = acc.setdefault((f["origin"], f["carrier_name"]),
                           {"origin": f["origin"], "carrier_name": f["carrier_name"], "counts": {}, "total": 0})
        b["counts"][f["reason"]] = b["counts"].get(f["reason"], 0) + f["n"]
        b["total"] += f["n"]
    return [acc[k] for k in sorted(acc, key=lambda k: (k[0], k[1] or ""))]


def _resumen_del_tipo(rows: list[dict]) -> dict:
    """Las cuatro cifras del tipo, asignados por cliente y la asistencia por
    origen habitual. La asistencia va por el origen DECLARADO: "enrolados"
    incluye a los que no salieron, y esos no tienen origen real (HU-28)."""
    total = len(rows)
    assigned = sum(1 for r in rows if r["con_carga"])
    por_cliente: dict = {}
    por_origen: dict = {}
    for r in rows:
        if r["con_carga"]:
            cliente = r["client_name"] or "Sin cliente"
            por_cliente[cliente] = por_cliente.get(cliente, 0) + 1
        origen = r["home_cd"] or "Sin origen"
        b = por_origen.setdefault(origen, {"origin": origen, "enrolled": 0, "assigned": 0})
        b["enrolled"] += 1
        b["assigned"] += 1 if r["con_carga"] else 0
    return {
        "total": total,
        "assigned": assigned,
        "not_working": sum(1 for r in rows if not r["con_carga"] and r["category"] in _NO_TRABAJO),
        "utilization_pct": round(assigned / total * 100, 1) if total else 0.0,
        "by_client": [{"client_name": k, "assigned": v} for k, v in sorted(por_cliente.items())],
        "by_home_origin": [por_origen[k] for k in sorted(por_origen)],
    }


def _asignados(rows: list[dict]) -> list[dict]:
    """Cliente × origen REAL del viaje × empresa, por tipo de destino: la tabla
    del CSV de Pablo (minuta 09/10, ítem 14). Una fila por hoja del árbol; los
    subtotales los arma el frontend (lib/reporte/arbolDeAsignados.ts)."""
    acc: dict = {}
    for r in rows:
        if not r["con_carga"]:
            continue
        clave = (r["client_name"] or "Sin cliente", r["origin_cd"] or "Sin origen", r["carrier_name"] or "Sin empresa")
        b = acc.setdefault(clave, {"client_name": clave[0], "origin": clave[1], "carrier_name": clave[2],
                                   "rm": 0, "z0": 0, "region": 0, "unclassified": 0, "total": 0})
        b[_ZONA_A_CLAVE[r["destination_zone"] or "Sin clasificar"]] += 1
        b["total"] += 1
    return [acc[k] for k in sorted(acc)]


def _cargaron_en_otro_origen(rows: list[dict]) -> list[dict]:
    """Los que cargaron en un origen distinto al habitual (HU-28, ola 4.1).
    Declarar el origen habitual sirve para VER cuándo no calza. Sin origen
    habitual no hay con qué comparar, y sin carga no hay origen."""
    return sorted(
        (
            {"tractor_plate": r["tractor_plate"], "carrier_name": r["carrier_name"],
             "home_origin": r["home_cd"], "origin": r["origin_cd"], "client_name": r["client_name"]}
            for r in rows
            if r["con_carga"] and r["home_cd"] and r["origin_cd"] and r["home_cd"] != r["origin_cd"]
        ),
        key=lambda d: (d["home_origin"], d["origin"], d["tractor_plate"] or ""),
    )


def _trabajaron_sin_asignacion(rows: list[dict], catalogo: list[str]) -> dict:
    """Los que trabajaron sin viaje (Se retira sin carga, Esperando carga…),
    en su origen habitual: no salieron a ningún lado (minuta 09/10)."""
    filas = [
        {"origin": r["home_cd"] or "Sin origen", "carrier_name": r["carrier_name"],
         "reason": _motivo(r["unassigned_reason_label"]), "n": 1}
        for r in rows if not r["con_carga"] and r["category"] == _TRABAJO_SIN_ASIGNACION
    ]
    return {"reasons": _motivos_que_ocurrieron(catalogo, (f["reason"] for f in filas)), "rows": _por_motivo(filas)}


def _segundas_vueltas(rows: list[dict]) -> list[dict]:
    """Una fila por PATENTE con 2+ vueltas: la vuelta es del tracto (minuta
    09/10). El conductor es el del último viaje del día."""
    return [
        {"tractor_plate": r["tractor_plate"], "carrier_name": r["carrier_name"], "driver_name": r["driver_name"],
         "origin": r["origin_cd"], "destination_zone": r["destination_zone"], "legs": r["vueltas"]}
        for r in rows if r["con_carga"] and r["vueltas"] >= 2
    ]


def _no_trabajaron_por_conductor(
    driver_rows: list[dict], catalogo: list[str], *, faltantes: list[dict], sin_conductor: str | None,
) -> dict:
    """Tractoreo: por CONDUCTOR (plan 2.3, Tarea 6), en su origen habitual.
    "Sin conductor" suma además el faltante de la dotación de cada empresa
    (minuta 09/10, ítem 13; la misma cuenta de la pestaña Dotación). Esos
    conductores no existen, así que van en "Sin origen". Si el motivo no está
    activo en el catálogo, no se inventa la columna."""
    filas = [
        {"origin": d["home_cd"] or "Sin origen", "carrier_name": d["carrier_name"],
         "reason": _motivo(d["unassigned_reason_label"]), "n": 1}
        for d in driver_rows
    ]
    if sin_conductor in catalogo:
        filas += [
            {"origin": "Sin origen", "carrier_name": f["business_name"], "reason": sin_conductor, "n": f["gap"]}
            for f in faltantes if f["gap"] > 0
        ]
    detail = sorted(
        ({"name": d["full_name"], "carrier_name": d["carrier_name"], "home_origin": d["home_cd"],
          "reason": _motivo(d["unassigned_reason_label"]), "tractor_plate": d["tractor_plate"]}
         for d in driver_rows),
        key=lambda d: (d["carrier_name"] or "", d["name"]),
    )
    return {"reasons": _motivos_que_ocurrieron(catalogo, (f["reason"] for f in filas)),
            "by_reason": _por_motivo(filas), "detail": detail}


def _no_trabajaron_por_equipo(rows: list[dict], catalogo: list[str]) -> dict:
    """Equipo Completo: por EQUIPO sin carga en el grupo "no trabajó", con el
    motivo de su línea del cierre."""
    sin_trabajar = [r for r in rows if not r["con_carga"] and r["category"] in _NO_TRABAJO]
    filas = [
        {"origin": r["home_cd"] or "Sin origen", "carrier_name": r["carrier_name"],
         "reason": _motivo(r["unassigned_reason_label"]), "n": 1}
        for r in sin_trabajar
    ]
    detail = sorted(
        ({"name": r["tractor_plate"], "carrier_name": r["carrier_name"], "home_origin": r["home_cd"],
          "reason": _motivo(r["unassigned_reason_label"]), "tractor_plate": r["tractor_plate"]}
         for r in sin_trabajar),
        key=lambda d: (d["carrier_name"] or "", d["name"] or ""),
    )
    return {"reasons": _motivos_que_ocurrieron(catalogo, (f["reason"] for f in filas)),
            "by_reason": _por_motivo(filas), "detail": detail}


def _empresas(rows: list[dict]) -> list[dict]:
    """Utilización por empresa del tipo, la de mayor utilización primero."""
    acc: dict = {}
    for r in rows:
        b = acc.setdefault(r["carrier_name"], {"carrier_name": r["carrier_name"], "enrolled": 0, "assigned": 0,
                                               "unassigned": 0})
        b["enrolled"] += 1
        b["assigned" if r["con_carga"] else "unassigned"] += 1
    return sorted(
        ({**b, "utilization_pct": round(b["assigned"] / b["enrolled"] * 100, 1)} for b in acc.values()),
        key=lambda b: b["utilization_pct"], reverse=True,
    )


def _reporte_del_tipo(rows: list[dict], *, no_trabajaron: dict, catalogo_sin_asignacion: list[str]) -> dict:
    return {
        "summary": _resumen_del_tipo(rows),
        "assigned": {"rows": _asignados(rows), "other_origin": _cargaron_en_otro_origen(rows)},
        "worked_without_assignment": _trabajaron_sin_asignacion(rows, catalogo_sin_asignacion),
        "second_legs": _segundas_vueltas(rows),
        "not_working": no_trabajaron,
        "carriers": _empresas(rows),
    }


@router.get("")
async def get_status_report(fecha: str, client: str | None = None, pool=Depends(get_pool), _=Depends(require(Permission.OPERATIONS_READ))):
    business_date = _parse_business_date(fecha)
    rows = _filter_by_client(await _build_asset_rows(pool, business_date), client)
    por_tipo = {clave: [r for r in rows if codigo in r["categories"]] for clave, codigo in _TIPOS.items()}
    # Los conductores que no trabajaron no tienen cliente: el filtro de cliente
    # no les aplica, igual que a los equipos sin carga en _filter_by_client.
    driver_rows = await _build_driver_rows(pool, business_date)
    catalogo_no_trabajo = [r["label"] for r in await pool.fetch(_SQL_MOTIVOS_DEL_GRUPO, GRUPO_NO_TRABAJANDO)]
    catalogo_sin_asignacion = [
        r["label"] for r in await pool.fetch(_SQL_MOTIVOS_DEL_GRUPO, GRUPO_TRABAJANDO_SIN_ASIGNACION)
    ]
    no_trabajaron = {
        "tractoreo": _no_trabajaron_por_conductor(
            driver_rows, catalogo_no_trabajo, faltantes=await compute_fleet_driver_gap(pool),
            sin_conductor=await pool.fetchval(_SQL_ETIQUETA_SIN_CONDUCTOR),
        ),
        "equipo_completo": _no_trabajaron_por_equipo(por_tipo["equipo_completo"], catalogo_no_trabajo),
    }
    return {
        "business_date": business_date.isoformat(),
        "client_filter": client,
        "by_operation_type": {
            clave: _reporte_del_tipo(
                por_tipo[clave], no_trabajaron=no_trabajaron[clave], catalogo_sin_asignacion=catalogo_sin_asignacion,
            )
            for clave in _TIPOS
        },
        **await frescura_del_dia(pool, business_date),
    }
```

   Agrega `from collections.abc import Iterable` a los imports.

5. **Docstring de `_build_driver_rows`.** Cambia la frase "con_carga queda fijo en False: es un campo 'de
   compatibilidad' para que _cross_tab_by_motivo … sin modificarla." por:
   "con_carga queda fijo en False: estas filas son, por definición, conductores sin carga."

- [ ] **Step 4: Correr los tests y verlos pasar**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_status_report.py tests/test_reporte_de_estatus_integracion.py -q 2>&1 | tail -15`
Expected: todos PASS. El de integración pasa o queda SKIPPED si no hay credenciales; si sale SKIPPED, exporta
`SUPABASE_DB_PASSWORD` como en las tareas anteriores y vuelve a correrlo hasta que pase.

Run: `cd monitor-app/backend/api && grep -n -E "_section[0-9_]|_cross_tab|_columnas_de_motivo|dias_en_curso|section1_resumen" app/routers/status_report.py tests/test_status_report.py`
Expected: sin resultados.

- [ ] **Step 5: Verificar que una mutación hace fallar los tests**

Cambia temporalmente en `_resumen_del_tipo` `r["category"] in _NO_TRABAJO` por `True`, corre
`venv/bin/python -m pytest tests/test_status_report.py -q -k resumen_del_tipo` (Expected: FAIL), y revierte el cambio.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api/app/routers/status_report.py monitor-app/backend/api/tests/test_status_report.py monitor-app/backend/api/tests/test_reporte_de_estatus_integracion.py
git commit -m "feat(reporte): estatus del día por tipo de operación, claves en inglés (minuta 09/10, ítems 8 y 14)"
```

---

### Task 2: Frontend — tipos y árbol de asignados

**Files:**
- Modify: `monitor-app/frontend/lib/types.ts` (bloque "Reporte de estatus del día", ~1648-1754)
- Create: `monitor-app/frontend/lib/reporte/sumar.ts`
- Create: `monitor-app/frontend/lib/reporte/tiposDeOperacion.ts`
- Create: `monitor-app/frontend/lib/reporte/arbolDeAsignados.ts`
- Test: `monitor-app/frontend/lib/reporte/arbolDeAsignados.test.ts`

**Interfaces:**
- Consumes: el contrato JSON de Task 1.
- Produces:
  - **Tipos:** `OperationTypeKey`, `AssignedRow`, `ReasonRow`, `OperationTypeReport` y `StatusReport` con
    `by_operation_type?`.
  - **`sumar.ts`:** `sumar<T>(filas: T[], valor: (f: T) => number | undefined): number`.
  - **`tiposDeOperacion.ts`:** `TipoDeOperacion = { clave: OperationTypeKey; etiqueta: string; corta: string }` y
    `TIPOS_DE_OPERACION: TipoDeOperacion[]`.
  - **`arbolDeAsignados.ts`:**
    - `Cifras`, `COLUMNAS_DE_ZONA` y `ArbolDeAsignados`;
    - `FilaDelArbol = { nivel: 0 | 1 | 2; clave: string; etiqueta: string; cifras: Cifras; plegable: boolean }`;
    - `arbolDeAsignados(rows: AssignedRow[]): ArbolDeAsignados`;
    - `filasDelArbol(arbol, estaAbierto?: (clave: string, nivel: 0 | 1) => boolean): FilaDelArbol[]`. Sin
      `estaAbierto`, todo va abierto: así lo usa el Excel.

- [ ] **Step 1: Escribir el test que falla**

`lib/reporte/arbolDeAsignados.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { AssignedRow } from '@/lib/types'
import { arbolDeAsignados, filasDelArbol } from './arbolDeAsignados'

const fila = (client_name: string, origin: string, carrier_name: string, rm: number, region = 0): AssignedRow => ({
  client_name, origin, carrier_name, rm, z0: 0, region, unclassified: 0, total: rm + region,
})

// Ordenadas como las manda la API: cliente, origen, empresa.
const ROWS = [
  fila('Sodimac', 'CD Quilicura', 'Norte Spa', 1),
  fila('Walmart', 'CD Lo Aguirre', 'Norte Spa', 2, 1),
  fila('Walmart', 'CD Lo Aguirre', 'Transportes Sur', 3),
  fila('Walmart', 'CD Quilicura', 'Transportes Sur', 1),
]

describe('arbolDeAsignados', () => {
  it('suma cada cliente y cada origen con sus hijos, y el total con todo', () => {
    const arbol = arbolDeAsignados(ROWS)
    const walmart = arbol.clientes.find(c => c.client_name === 'Walmart')!
    expect(walmart.cifras).toEqual({ rm: 6, z0: 0, region: 1, unclassified: 0, total: 7 })
    expect(walmart.origenes.map(o => [o.origin, o.cifras.total])).toEqual([['CD Lo Aguirre', 6], ['CD Quilicura', 1]])
    expect(arbol.total.total).toBe(8)
  })

  it('sin estado de apertura lista todo en orden de lectura (el Excel)', () => {
    const filas = filasDelArbol(arbolDeAsignados(ROWS))
    expect(filas.map(f => `${f.nivel}:${f.etiqueta}`)).toEqual([
      '0:Sodimac', '1:CD Quilicura', '2:Norte Spa',
      '0:Walmart', '1:CD Lo Aguirre', '2:Norte Spa', '2:Transportes Sur', '1:CD Quilicura', '2:Transportes Sur',
    ])
  })

  it('un cliente cerrado esconde sus orígenes y un origen cerrado sus empresas', () => {
    const arbol = arbolDeAsignados(ROWS)
    const soloWalmartAbierto = (clave: string, nivel: 0 | 1) => nivel === 0 && clave === 'Walmart'
    expect(filasDelArbol(arbol, soloWalmartAbierto).map(f => f.etiqueta))
      .toEqual(['Sodimac', 'Walmart', 'CD Lo Aguirre', 'CD Quilicura'])
  })

  it('el mismo origen en dos clientes son dos nodos distintos', () => {
    const claves = filasDelArbol(arbolDeAsignados(ROWS)).filter(f => f.nivel === 1).map(f => f.clave)
    expect(new Set(claves).size).toBe(claves.length)
  })

  it('sin filas no hay clientes y el total es cero', () => {
    const arbol = arbolDeAsignados([])
    expect(arbol.clientes).toEqual([])
    expect(arbol.total.total).toBe(0)
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd monitor-app/frontend && npx vitest run lib/reporte/arbolDeAsignados.test.ts`
Expected: FAIL con "Failed to resolve import './arbolDeAsignados'".

- [ ] **Step 3: Implementar**

En `lib/types.ts`, reemplaza el bloque desde `// ── Reporte de estatus del día, 6 secciones (Fase 5, HU-04) ──` hasta el `}` que
cierra `StatusReport` (justo antes de `// ── Bandeja de documentos sin clasificar (HU-01)`). Lo nuevo:

```ts
// ── Reporte de estatus del día, por tipo de operación (spec 2026-10-11) ─────

/** Tabla Empresa/Enrolados/Asignados/No asignados/% utilización, igual para los dos tipos. */
export type CarrierUtilizationRow = {
  carrier_name:     string
  enrolled:         number
  assigned:         number
  unassigned:       number
  utilization_pct:  number
}

export type OperationTypeKey = 'tractoreo' | 'equipo_completo'

/** Una hoja del árbol de Asignados: cliente × origen real del viaje × empresa. */
export type AssignedRow = {
  client_name:  string
  origin:       string
  carrier_name: string
  rm:           number
  z0:           number
  region:       number
  unclassified: number
  total:        number
}

/** Origen × empresa con un conteo por motivo; `counts` trae solo los motivos con casos. */
export type ReasonRow = {
  origin:       string
  carrier_name: string | null
  counts:       Record<string, number>
  total:        number
}

export type OperationTypeReport = {
  summary: {
    total:           number
    assigned:        number
    /** Equipos del tipo que no trabajaron (o sin motivo todavía). */
    not_working:     number
    utilization_pct: number
    by_client:       { client_name: string; assigned: number }[]
    /** Enrolados vs asignados por origen habitual declarado (HU-28). */
    by_home_origin:  { origin: string; enrolled: number; assigned: number }[]
  }
  assigned: {
    rows: AssignedRow[]
    other_origin: {
      tractor_plate: string | null
      carrier_name:  string | null
      home_origin:   string
      origin:        string
      client_name:   string | null
    }[]
  }
  worked_without_assignment: { reasons: string[]; rows: ReasonRow[] }
  second_legs: {
    tractor_plate:    string
    carrier_name:     string
    driver_name:      string | null
    origin:           string | null
    destination_zone: string | null
    legs:             number
  }[]
  not_working: {
    reasons:   string[]
    by_reason: ReasonRow[]
    /** Tractoreo: un conductor por fila. Equipo Completo: un equipo (`name` es la patente). */
    detail: {
      name:          string
      carrier_name:  string | null
      home_origin:   string | null
      reason:        string
      tractor_plate: string | null
    }[]
  }
  carriers: CarrierUtilizationRow[]
}

export type StatusReport = {
  business_date: string
  client_filter: string | null
  /** Spec 2026-10-10: cuándo se calcularon las líneas del día, y desde cuándo hay
   *  cambios esperando al ejecutor (null = al día). */
  calculado_a?:     string | null
  pendiente_desde?: string | null
  /** Opcional: un backend anterior al rediseño no lo manda (despliegues separados). */
  by_operation_type?: Record<OperationTypeKey, OperationTypeReport>
}
```

Run: `cd monitor-app/frontend && grep -rn -E "ZoneCrossTab|MotivoCrossTab|VueltaRow|DriverDetailRow" app components lib hooks`
Expected: solo `StatusReportSection.tsx`, su test y `exportarReporte.ts`, que se reescriben en Tasks 3 y 4. Si sale
otro archivo, detente y revisa.

`lib/reporte/sumar.ts`:

```ts
/** Suma de una columna numérica: el pie de cada tabla del reporte (minuta 09/10,
 *  ítem 9), para que el número se compare de frente con el Excel de operaciones.
 *  Una sola definición para la pantalla, el árbol y el Excel. */
export function sumar<T>(filas: T[], valor: (fila: T) => number | undefined): number {
  return filas.reduce((acc, f) => acc + (valor(f) ?? 0), 0)
}
```

`lib/reporte/tiposDeOperacion.ts`:

```ts
import type { OperationTypeKey } from '@/lib/types'

export type TipoDeOperacion = { clave: OperationTypeKey; etiqueta: string; corta: string }

/** Los dos cortes del reporte, en el orden del selector. `corta` es para los
 *  nombres de hoja del Excel, que no pueden pasar de 31 caracteres. */
export const TIPOS_DE_OPERACION: TipoDeOperacion[] = [
  { clave: 'tractoreo', etiqueta: 'Tractoreo', corta: 'Tractoreo' },
  { clave: 'equipo_completo', etiqueta: 'Equipo Completo', corta: 'Eq. Completo' },
]
```

`lib/reporte/arbolDeAsignados.ts`:

```ts
import type { AssignedRow } from '@/lib/types'
import { sumar } from './sumar'

export type Cifras = Pick<AssignedRow, 'rm' | 'z0' | 'region' | 'unclassified' | 'total'>

/** Las columnas de zona, en el orden del CSV de Pablo. */
export const COLUMNAS_DE_ZONA = [
  { clave: 'rm', etiqueta: 'RM' },
  { clave: 'z0', etiqueta: 'Z0' },
  { clave: 'region', etiqueta: 'Región' },
  { clave: 'unclassified', etiqueta: 'Sin clasificar' },
  { clave: 'total', etiqueta: 'Total' },
] as const satisfies readonly { clave: keyof Cifras; etiqueta: string }[]

type NodoEmpresa = { carrier_name: string; cifras: Cifras }
type NodoOrigen = { clave: string; origin: string; cifras: Cifras; empresas: NodoEmpresa[] }
type NodoCliente = { clave: string; client_name: string; cifras: Cifras; origenes: NodoOrigen[] }
export type ArbolDeAsignados = { clientes: NodoCliente[]; total: Cifras }

export type FilaDelArbol = { nivel: 0 | 1 | 2; clave: string; etiqueta: string; cifras: Cifras; plegable: boolean }

function cifrasDe(filas: AssignedRow[]): Cifras {
  return {
    rm: sumar(filas, f => f.rm), z0: sumar(filas, f => f.z0), region: sumar(filas, f => f.region),
    unclassified: sumar(filas, f => f.unclassified), total: sumar(filas, f => f.total),
  }
}

/** Agrupa conservando el orden de llegada: la API ya manda las filas ordenadas. */
function agrupar(filas: AssignedRow[], clave: (f: AssignedRow) => string): [string, AssignedRow[]][] {
  const grupos = new Map<string, AssignedRow[]>()
  for (const f of filas) grupos.set(clave(f), [...(grupos.get(clave(f)) ?? []), f])
  return [...grupos]
}

/** Cliente → Origen del viaje → Empresa, con subtotales: la tabla dinámica que
 *  describió Pablo. Una sola definición para la pantalla y el Excel, así los dos
 *  dan los mismos números. */
export function arbolDeAsignados(rows: AssignedRow[]): ArbolDeAsignados {
  const clientes = agrupar(rows, r => r.client_name).map(([cliente, delCliente]) => ({
    clave: cliente,
    client_name: cliente,
    cifras: cifrasDe(delCliente),
    origenes: agrupar(delCliente, r => r.origin).map(([origen, delOrigen]) => ({
      // El mismo origen bajo dos clientes son dos nodos: la clave lleva al cliente.
      clave: `${cliente}\u0000${origen}`,
      origin: origen,
      cifras: cifrasDe(delOrigen),
      empresas: delOrigen.map(f => ({ carrier_name: f.carrier_name, cifras: cifrasDe([f]) })),
    })),
  }))
  return { clientes, total: cifrasDe(rows) }
}

/** Las filas en orden de lectura. `estaAbierto` dice si un cliente (nivel 0) o un
 *  origen (nivel 1) muestra su detalle; sin él, todo abierto. */
export function filasDelArbol(
  arbol: ArbolDeAsignados, estaAbierto: (clave: string, nivel: 0 | 1) => boolean = () => true,
): FilaDelArbol[] {
  const filas: FilaDelArbol[] = []
  for (const c of arbol.clientes) {
    filas.push({ nivel: 0, clave: c.clave, etiqueta: c.client_name, cifras: c.cifras, plegable: true })
    if (!estaAbierto(c.clave, 0)) continue
    for (const o of c.origenes) {
      filas.push({ nivel: 1, clave: o.clave, etiqueta: o.origin, cifras: o.cifras, plegable: true })
      if (!estaAbierto(o.clave, 1)) continue
      for (const e of o.empresas) {
        filas.push({ nivel: 2, clave: `${o.clave}\u0000${e.carrier_name}`, etiqueta: e.carrier_name,
                     cifras: e.cifras, plegable: false })
      }
    }
  }
  return filas
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `cd monitor-app/frontend && npx vitest run lib/reporte/arbolDeAsignados.test.ts`
Expected: 5/5 PASS. (`tsc` todavía falla en `StatusReportSection.tsx` y `exportarReporte.ts`; los arreglan Tasks 3 y 4.)

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/lib/types.ts monitor-app/frontend/lib/reporte/sumar.ts monitor-app/frontend/lib/reporte/tiposDeOperacion.ts monitor-app/frontend/lib/reporte/arbolDeAsignados.ts monitor-app/frontend/lib/reporte/arbolDeAsignados.test.ts
git commit -m "feat(reporte): tipos por tipo de operación y árbol Cliente → Origen → Empresa"
```

---

### Task 3: Excel — una hoja por sección y tipo, más Dotación

**Files:**
- Modify (reescribir): `monitor-app/frontend/lib/reporte/exportarReporte.ts`
- Test: `monitor-app/frontend/lib/reporte/exportarReporte.test.ts`

**Interfaces:**
- Consumes:
  - `arbolDeAsignados`, `filasDelArbol`, `COLUMNAS_DE_ZONA` y `Cifras` (Task 2);
  - `TIPOS_DE_OPERACION` y `sumar` (Task 2);
  - `FleetDriverGapRow` (existente).
- Produces:
  - `hojasDelReporte(porTipo: Record<OperationTypeKey, OperationTypeReport>, dotacion: FleetDriverGapRow[] | undefined): HojaDeExcel[]`
  - `descargarReporteExcel(porTipo, fecha: string, dotacion): Promise<void>`
  - `HojaDeExcel = { sheet: string; data: Celda[][] }`, donde
    `Celda = string | number | null | { value: string | number; fontWeight: 'bold' }`.

- [ ] **Step 1: Escribir el test que falla**

`lib/reporte/exportarReporte.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { OperationTypeKey, OperationTypeReport } from '@/lib/types'
import { hojasDelReporte } from './exportarReporte'

function reporte(over: Partial<OperationTypeReport> = {}): OperationTypeReport {
  return {
    summary: { total: 3, assigned: 2, not_working: 1, utilization_pct: 66.7,
               by_client: [{ client_name: 'Walmart', assigned: 2 }],
               by_home_origin: [{ origin: 'CD Lo Aguirre', enrolled: 3, assigned: 2 }] },
    assigned: {
      rows: [
        { client_name: 'Walmart', origin: 'CD Lo Aguirre', carrier_name: 'Transportes Sur', rm: 1, z0: 0, region: 0, unclassified: 0, total: 1 },
        { client_name: 'Walmart', origin: 'CD Quilicura', carrier_name: 'Norte Spa', rm: 0, z0: 1, region: 0, unclassified: 0, total: 1 },
      ],
      other_origin: [],
    },
    worked_without_assignment: { reasons: [], rows: [] },
    second_legs: [],
    not_working: { reasons: ['Panne'], by_reason: [{ origin: 'CD Lo Aguirre', carrier_name: 'Transportes Sur', counts: { Panne: 1 }, total: 1 }],
                   detail: [{ name: 'Juan Pérez', carrier_name: 'Transportes Sur', home_origin: 'CD Lo Aguirre', reason: 'Panne', tractor_plate: 'ABCD12' }] },
    carriers: [{ carrier_name: 'Transportes Sur', enrolled: 3, assigned: 2, unassigned: 1, utilization_pct: 66.7 }],
    ...over,
  }
}

const POR_TIPO: Record<OperationTypeKey, OperationTypeReport> = { tractoreo: reporte(), equipo_completo: reporte() }
const negrita = (v: unknown) => typeof v === 'object' && v !== null && (v as { fontWeight?: string }).fontWeight === 'bold'
const valor = (v: unknown) => (typeof v === 'object' && v !== null ? (v as { value: unknown }).value : v)

describe('hojasDelReporte', () => {
  it('trae los dos tipos, una hoja por sección, y Dotación al final', () => {
    expect(hojasDelReporte(POR_TIPO, []).map(h => h.sheet)).toEqual([
      'Resumen · Tractoreo', 'Resumen · Eq. Completo',
      'Asignados · Tractoreo', 'Asignados · Eq. Completo',
      'Segundas vueltas · Tractoreo', 'Segundas vueltas · Eq. Completo',
      'No trabajaron · Tractoreo', 'No trabajaron · Eq. Completo',
      'Empresas · Tractoreo', 'Empresas · Eq. Completo',
      'Dotación',
    ])
  })

  it('ningún nombre de hoja pasa de 31 caracteres (Excel lo rechaza)', () => {
    for (const h of hojasDelReporte(POR_TIPO, [])) expect(h.sheet.length).toBeLessThanOrEqual(31)
  })

  it('Asignados sigue el CSV de Pablo: subtotales en negrita y total general al pie', () => {
    const hoja = hojasDelReporte(POR_TIPO, []).find(h => h.sheet === 'Asignados · Tractoreo')!
    expect(hoja.data[0].map(valor)).toEqual(['Cliente', 'Origen', 'Empresa', 'RM', 'Z0', 'Región', 'Sin clasificar', 'Total'])
    const cliente = hoja.data[1]
    expect(valor(cliente[0])).toBe('Walmart')
    expect(negrita(cliente[0]) && negrita(cliente[7])).toBe(true)
    expect(valor(cliente[7])).toBe(2)
    const empresa = hoja.data.find(f => f[2] === 'Transportes Sur')!
    expect(negrita(empresa[7])).toBe(false)
    const pie = hoja.data[hoja.data.length - 1]
    expect(pie.map(valor)).toEqual(['Total', null, null, 1, 1, 0, 0, 2])
  })

  it('No trabajaron dice "Conductor" en Tractoreo y "Equipo" en Equipo Completo', () => {
    const hojas = hojasDelReporte(POR_TIPO, [])
    const encabezados = (nombre: string) => hojas.find(h => h.sheet === nombre)!.data.map(f => valor(f[0]))
    expect(encabezados('No trabajaron · Tractoreo')).toContain('Conductor')
    expect(encabezados('No trabajaron · Eq. Completo')).toContain('Equipo')
  })

  it('Dotación lista el desbalance por empresa', () => {
    const hoja = hojasDelReporte(POR_TIPO, [
      { carrier_id: 'c1', business_name: 'Transportes Sur', n_tractos: 3, n_conductores: 1, gap: 2 },
    ]).find(h => h.sheet === 'Dotación')!
    expect(hoja.data.map(f => f.map(valor))).toContainEqual(['Transportes Sur', 3, 1, 2])
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd monitor-app/frontend && npx vitest run lib/reporte/exportarReporte.test.ts`
Expected: FAIL. El primer test recibe nombres de hoja viejos, o revienta leyendo `section1_resumen` de `undefined`.

- [ ] **Step 3: Implementar**

Reemplaza todo `lib/reporte/exportarReporte.ts` por:

```ts
import type { FleetDriverGapRow, OperationTypeKey, OperationTypeReport, ReasonRow } from '@/lib/types'
import { COLUMNAS_DE_ZONA, arbolDeAsignados, filasDelArbol, type Cifras } from './arbolDeAsignados'
import { sumar } from './sumar'
import { TIPOS_DE_OPERACION } from './tiposDeOperacion'

type Valor = string | number | null
type Celda = Valor | { value: string | number; fontWeight: 'bold' }
type Fila = Celda[]

/** Una hoja del .xlsx: nombre y filas. */
export type HojaDeExcel = { sheet: string; data: Fila[] }

/** Una fila de encabezado o de subtotal. */
const negrita = (fila: Valor[]): Fila =>
  fila.map(v => (v === null || v === '' ? null : { value: v, fontWeight: 'bold' as const }))

const zonas = (c: Cifras): number[] => COLUMNAS_DE_ZONA.map(z => c[z.clave])

function tablaDeMotivos(reasons: string[], rows: ReasonRow[]): Fila[] {
  return [
    negrita(['Origen', 'Empresa', ...reasons, 'Total']),
    ...rows.map(r => [r.origin, r.carrier_name, ...reasons.map(m => r.counts[m] ?? 0), r.total]),
    negrita(['Total', null, ...reasons.map(m => sumar(rows, r => r.counts[m])), sumar(rows, r => r.total)]),
  ]
}

function resumen(r: OperationTypeReport): Fila[] {
  const s = r.summary
  return [
    ['Equipos activos', s.total], ['Asignados', s.assigned], ['No trabajaron', s.not_working],
    ['% utilización', s.utilization_pct], [],
    negrita(['Cliente', 'Asignados']),
    ...s.by_client.map(c => [c.client_name, c.assigned]),
    negrita(['Total', sumar(s.by_client, c => c.assigned)]), [],
    negrita(['Origen habitual', 'Enrolados', 'Asignados']),
    ...s.by_home_origin.map(o => [o.origin, o.enrolled, o.assigned]),
    negrita(['Total', sumar(s.by_home_origin, o => o.enrolled), sumar(s.by_home_origin, o => o.assigned)]),
  ]
}

/** El CSV de Pablo: Cliente, Origen, Empresa y las zonas; los subtotales de
 *  cliente y origen en negrita, el total general al pie. */
function asignados(r: OperationTypeReport): Fila[] {
  const arbol = arbolDeAsignados(r.assigned.rows)
  const cuerpo = filasDelArbol(arbol).map(f => {
    const fila: Valor[] = [f.nivel === 0 ? f.etiqueta : null, f.nivel === 1 ? f.etiqueta : null,
                           f.nivel === 2 ? f.etiqueta : null, ...zonas(f.cifras)]
    return f.nivel < 2 ? negrita(fila) : fila
  })
  const sinAsignacion = r.worked_without_assignment
  const otroOrigen = r.assigned.other_origin
  return [
    negrita(['Cliente', 'Origen', 'Empresa', ...COLUMNAS_DE_ZONA.map(z => z.etiqueta)]),
    ...cuerpo,
    negrita(['Total', null, null, ...zonas(arbol.total)]),
    ...(sinAsignacion.rows.length > 0
      ? [[], negrita(['Trabajaron sin asignación']), ...tablaDeMotivos(sinAsignacion.reasons, sinAsignacion.rows)]
      : []),
    ...(otroOrigen.length > 0
      ? [[], negrita(['Cargaron en otro origen']),
         negrita(['Patente', 'Empresa', 'Origen habitual', 'Cargó en', 'Cliente']),
         ...otroOrigen.map(d => [d.tractor_plate, d.carrier_name, d.home_origin, d.origin, d.client_name])]
      : []),
  ]
}

function segundasVueltas(r: OperationTypeReport): Fila[] {
  return [
    negrita(['Patente', 'Empresa', 'Conductor', 'Origen del viaje', 'Tipo de destino', 'Vueltas']),
    ...r.second_legs.map(v => [v.tractor_plate, v.carrier_name, v.driver_name, v.origin, v.destination_zone, v.legs]),
  ]
}

function noTrabajaron(r: OperationTypeReport, clave: OperationTypeKey): Fila[] {
  const nw = r.not_working
  const detalle = clave === 'tractoreo'
    ? [negrita(['Conductor', 'Empresa', 'Origen habitual', 'Motivo', 'Tracto habitual']),
       ...nw.detail.map(d => [d.name, d.carrier_name, d.home_origin, d.reason, d.tractor_plate])]
    : [negrita(['Equipo', 'Empresa', 'Origen habitual', 'Motivo']),
       ...nw.detail.map(d => [d.name, d.carrier_name, d.home_origin, d.reason])]
  return [...tablaDeMotivos(nw.reasons, nw.by_reason), [], ...detalle]
}

function empresas(r: OperationTypeReport): Fila[] {
  return [
    negrita(['Empresa', 'Enrolados', 'Asignados', 'No asignados', '% utilización']),
    ...r.carriers.map(c => [c.carrier_name, c.enrolled, c.assigned, c.unassigned, c.utilization_pct]),
  ]
}

const SECCIONES: { nombre: string; filas: (r: OperationTypeReport, clave: OperationTypeKey) => Fila[] }[] = [
  { nombre: 'Resumen', filas: resumen },
  { nombre: 'Asignados', filas: asignados },
  { nombre: 'Segundas vueltas', filas: segundasVueltas },
  { nombre: 'No trabajaron', filas: noTrabajaron },
  { nombre: 'Empresas', filas: empresas },
]

/** El reporte del día como hojas de Excel. Trae los dos tipos aunque se esté
 *  viendo uno, porque Operaciones lo cruza con su planilla (spec 2026-10-11, §4). */
export function hojasDelReporte(
  porTipo: Record<OperationTypeKey, OperationTypeReport>, dotacion: FleetDriverGapRow[] | undefined,
): HojaDeExcel[] {
  const hojas: HojaDeExcel[] = SECCIONES.flatMap(s => TIPOS_DE_OPERACION.map(t => ({
    sheet: `${s.nombre} · ${t.corta}`, data: s.filas(porTipo[t.clave], t.clave),
  })))
  hojas.push({
    sheet: 'Dotación',
    data: dotacion === undefined
      ? [['La dotación no estaba cargada al descargar']]
      : [negrita(['Empresa', 'Tractos', 'Conductores', 'Diferencia']),
         ...dotacion.map(d => [d.business_name, d.n_tractos, d.n_conductores, d.gap])],
  })
  return hojas
}

/** Baja el reporte como .xlsx (minuta 09/10, ítem 15). La librería se carga recién
 *  al hacer clic: no pesa en la pantalla para quien no exporta. */
export async function descargarReporteExcel(
  porTipo: Record<OperationTypeKey, OperationTypeReport>, fecha: string, dotacion: FleetDriverGapRow[] | undefined,
): Promise<void> {
  const { default: escribirExcel } = await import('write-excel-file/browser')
  await escribirExcel(hojasDelReporte(porTipo, dotacion)).toFile(`reporte_estatus_${fecha}.xlsx`)
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `cd monitor-app/frontend && npx vitest run lib/reporte/`
Expected: los 10 tests PASS (5 de `arbolDeAsignados`, 5 de `exportarReporte`).

Run: `cd monitor-app/frontend && npx tsc --noEmit 2>&1 | grep -v StatusReportSection | head`
Expected: sin errores fuera de `StatusReportSection*` (los arregla Task 4). Si `escribirExcel(...)` no acepta
`HojaDeExcel[]`, tipa `data` como `SheetData` (de `write-excel-file`) y anota el ruling.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/lib/reporte/exportarReporte.ts monitor-app/frontend/lib/reporte/exportarReporte.test.ts
git commit -m "feat(reporte): Excel con hojas por sección y tipo, subtotales en negrita y Dotación"
```

---

### Task 4: La pantalla — selector, seis secciones, árbol plegable y estados

**Files:**
- Create: `monitor-app/frontend/components/dashboard/sections/reporte/TablaDeAsignados.tsx`
- Create: `monitor-app/frontend/components/dashboard/sections/reporte/SeccionesDelReporte.tsx`
- Modify (reescribir): `monitor-app/frontend/components/dashboard/sections/StatusReportSection.tsx`
- Test (reescribir): `monitor-app/frontend/components/dashboard/sections/StatusReportSection.test.tsx`

**Interfaces:**
- Consumes:
  - de Tasks 2 y 3: `arbolDeAsignados`, `filasDelArbol`, `COLUMNAS_DE_ZONA`, `FilaDelArbol`, `TIPOS_DE_OPERACION`,
    `TipoDeOperacion`, `sumar`, `descargarReporteExcel(porTipo, fecha, dotacion)`;
  - existentes: `statusReportApi.get(fecha, client?)`, `carriersApi.fleetDriverGap(): Promise<{ rows: FleetDriverGapRow[] }>`,
    `FleetDriverGapCard`.
- Produces: `StatusReportSection({ fecha, shippers })`, con las mismas props de hoy, y
  `usePlegado(): Plegado` / `TablaDeAsignados({ rows, plegado })`, que son internos de la sección. La página de Cierre no cambia.

- [ ] **Step 1: Reescribir el test de la pantalla**

Reemplaza todo `StatusReportSection.test.tsx` por:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StatusReportSection } from './StatusReportSection'
import { statusReportApi } from '@/lib/api/statusReport'
import type { OperationTypeReport, StatusReport } from '@/lib/types'

const escribirExcel = vi.hoisted(() => vi.fn())
vi.mock('write-excel-file/browser', () => ({ default: escribirExcel }))

vi.mock('@/lib/api/statusReport', () => ({
  statusReportApi: { get: vi.fn() },
}))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { fleetDriverGap: vi.fn().mockResolvedValue({ rows: [{ carrier_id: 'c1', business_name: 'Transportes Sur', n_tractos: 3, n_conductores: 2, gap: 1 }] }) },
}))

const VACIO: OperationTypeReport = {
  summary: { total: 0, assigned: 0, not_working: 0, utilization_pct: 0, by_client: [], by_home_origin: [] },
  assigned: { rows: [], other_origin: [] },
  worked_without_assignment: { reasons: [], rows: [] },
  second_legs: [],
  not_working: { reasons: [], by_reason: [], detail: [] },
  carriers: [],
}

const TRACTOREO: OperationTypeReport = {
  summary: {
    total: 81, assigned: 29, not_working: 40, utilization_pct: 35.8,
    by_client: [{ client_name: 'Walmart', assigned: 29 }],
    by_home_origin: [{ origin: 'CD Lo Aguirre', enrolled: 50, assigned: 20 }],
  },
  assigned: {
    rows: [
      { client_name: 'Walmart', origin: 'CD Lo Aguirre', carrier_name: 'Transportes Sur', rm: 3, z0: 1, region: 0, unclassified: 0, total: 4 },
      { client_name: 'Walmart', origin: 'CD Quilicura', carrier_name: 'Norte Spa', rm: 0, z0: 0, region: 2, unclassified: 0, total: 2 },
    ],
    other_origin: [{ tractor_plate: 'ZZZZ99', carrier_name: 'Transportes Sur', home_origin: 'CD El Peñón', origin: 'CD Quilicura', client_name: 'Walmart' }],
  },
  worked_without_assignment: {
    reasons: ['Se retira sin carga'],
    rows: [{ origin: 'CD Lo Aguirre', carrier_name: 'Transportes Sur', counts: { 'Se retira sin carga': 2 }, total: 2 }],
  },
  second_legs: [{ tractor_plate: 'ABCD12', carrier_name: 'Transportes Sur', driver_name: 'Ana Soto', origin: 'CD Lo Aguirre', destination_zone: 'RM', legs: 2 }],
  not_working: {
    reasons: ['Panne'],
    by_reason: [{ origin: 'CD El Peñón', carrier_name: 'Otra Spa', counts: { Panne: 2 }, total: 2 }],
    detail: [{ name: 'Juan Pérez', carrier_name: 'Otra Spa', home_origin: 'CD El Peñón', reason: 'Panne', tractor_plate: 'ABCD12' }],
  },
  carriers: [{ carrier_name: 'Transportes Sur', enrolled: 5, assigned: 2, unassigned: 3, utilization_pct: 40.0 }],
}

const EQUIPO_COMPLETO: OperationTypeReport = {
  ...VACIO,
  summary: { ...VACIO.summary, total: 10, assigned: 3, not_working: 7, utilization_pct: 30.0 },
  not_working: {
    reasons: ['Panne'],
    by_reason: [{ origin: 'CD Lo Aguirre', carrier_name: 'Equipos Sur', counts: { Panne: 1 }, total: 1 }],
    detail: [{ name: 'EQUI01', carrier_name: 'Equipos Sur', home_origin: 'CD Lo Aguirre', reason: 'Panne', tractor_plate: 'EQUI01' }],
  },
  carriers: [{ carrier_name: 'Equipos Sur', enrolled: 10, assigned: 3, unassigned: 7, utilization_pct: 30.0 }],
}

const REPORT: StatusReport = {
  business_date: '2026-08-02',
  client_filter: null,
  by_operation_type: { tractoreo: TRACTOREO, equipo_completo: EQUIPO_COMPLETO },
}

function renderSection(props: Partial<Parameters<typeof StatusReportSection>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <StatusReportSection fecha="2026-08-02" {...props} />
    </QueryClientProvider>,
  )
  // El resumen imprimible duplica textos fuera de pantalla: las aserciones van acá.
  return within(screen.getByTestId('report-body'))
}

/** La tarjeta de una cifra del resumen: los mismos números se repiten en otras tablas. */
const cifra = (body: ReturnType<typeof renderSection>, titulo: string) =>
  body.getByText(titulo, { selector: 'p' }).parentElement!

async function abrir(body: ReturnType<typeof renderSection>, seccion: string) {
  await body.findByText('Equipos activos')
  fireEvent.click(body.getByRole('button', { name: seccion }))
}

beforeEach(() => {
  vi.mocked(statusReportApi.get).mockReset().mockResolvedValue(REPORT)
})

describe('StatusReportSection', () => {
  it('abre en Tractoreo › Resumen con las cuatro cifras', async () => {
    const body = renderSection()
    expect(await body.findByText('Equipos activos')).toBeInTheDocument()
    expect(cifra(body, 'Equipos activos')).toHaveTextContent('81')
    expect(cifra(body, 'Asignados')).toHaveTextContent('29')
    expect(cifra(body, 'No trabajaron')).toHaveTextContent('40')
    expect(cifra(body, 'Utilización')).toHaveTextContent('35.8%')
  })

  it('el selector cambia todas las secciones al otro tipo', async () => {
    const body = renderSection()
    await body.findByText('Equipos activos')
    fireEvent.click(body.getByRole('button', { name: 'Equipo Completo' }))
    expect(cifra(body, 'Equipos activos')).toHaveTextContent('10')
    fireEvent.click(body.getByRole('button', { name: 'Empresas' }))
    expect(body.getByText('Equipos Sur')).toBeInTheDocument()
    expect(body.queryByText('Transportes Sur')).not.toBeInTheDocument()
  })

  it('Asignados abre los clientes y deja cerrados los orígenes', async () => {
    const body = renderSection()
    await abrir(body, 'Asignados')
    expect(body.getByRole('button', { name: 'Walmart' })).toHaveAttribute('aria-expanded', 'true')
    expect(body.getByRole('button', { name: 'CD Lo Aguirre' })).toHaveAttribute('aria-expanded', 'false')
    expect(body.queryByText('Norte Spa')).not.toBeInTheDocument()
  })

  it('abrir un origen muestra sus empresas, y cerrar el cliente esconde todo lo de adentro', async () => {
    const body = renderSection()
    await abrir(body, 'Asignados')
    fireEvent.click(body.getByRole('button', { name: 'CD Quilicura' }))
    expect(body.getByText('Norte Spa')).toBeInTheDocument()
    fireEvent.click(body.getByRole('button', { name: 'Walmart' }))
    expect(body.queryByRole('button', { name: 'CD Quilicura' })).not.toBeInTheDocument()
    expect(body.queryByText('Norte Spa')).not.toBeInTheDocument()
  })

  it('cada cliente muestra su subtotal y el pie el total, en el orden del CSV', async () => {
    const body = renderSection()
    await abrir(body, 'Asignados')
    const cliente = body.getByRole('button', { name: 'Walmart' }).closest('tr')!
    expect(within(cliente).getAllByRole('cell').map(c => c.textContent)).toEqual(['Walmart', '3', '1', '2', '0', '6'])
    const pie = within(body.getAllByRole('table')[0]).getAllByRole('row').at(-1)!
    expect(within(pie).getAllByRole('cell').map(c => c.textContent)).toEqual(['Total', '3', '1', '2', '0', '6'])
  })

  it('lo plegado sigue plegado al cambiar de tipo y volver', async () => {
    const body = renderSection()
    await abrir(body, 'Asignados')
    fireEvent.click(body.getByRole('button', { name: 'Walmart' }))
    fireEvent.click(body.getByRole('button', { name: 'Equipo Completo' }))
    fireEvent.click(body.getByRole('button', { name: 'Tractoreo' }))
    expect(body.getByRole('button', { name: 'Walmart' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('debajo del árbol van los que trabajaron sin asignación, con solo sus motivos, y los que cargaron en otro origen', async () => {
    const body = renderSection()
    await abrir(body, 'Asignados')
    expect(body.getByText('Trabajaron sin asignación')).toBeInTheDocument()
    expect(body.getByRole('columnheader', { name: 'Se retira sin carga' })).toBeInTheDocument()
    expect(body.getByText(/Cargaron en otro origen \(1\)/)).toBeInTheDocument()
    expect(body.getByText('ZZZZ99')).toBeInTheDocument()
  })

  it('un tipo sin asignados lo dice, en vez de dibujar una tabla vacía', async () => {
    const body = renderSection()
    await body.findByText('Equipos activos')
    fireEvent.click(body.getByRole('button', { name: 'Equipo Completo' }))
    fireEvent.click(body.getByRole('button', { name: 'Asignados' }))
    expect(body.getByText('Hoy no hubo equipos de Equipo Completo asignados')).toBeInTheDocument()
    expect(body.queryByRole('table')).not.toBeInTheDocument()
  })

  it('Segundas vueltas muestra la patente y su conductor', async () => {
    const body = renderSection()
    await abrir(body, 'Segundas vueltas')
    const fila = body.getByText('ABCD12').closest('tr')!
    expect(within(fila).getByText('Ana Soto')).toBeInTheDocument()
    expect(within(fila).getByText('2')).toBeInTheDocument()
  })

  it('No trabajaron va por conductor en Tractoreo y por equipo en Equipo Completo', async () => {
    const body = renderSection()
    await abrir(body, 'No trabajaron')
    expect(body.getByRole('columnheader', { name: 'Conductor' })).toBeInTheDocument()
    expect(body.getByText('Juan Pérez')).toBeInTheDocument()
    fireEvent.click(body.getByRole('button', { name: 'Equipo Completo' }))
    expect(body.getByRole('columnheader', { name: 'Equipo' })).toBeInTheDocument()
    expect(body.getAllByText('EQUI01').length).toBeGreaterThan(0)
  })

  it('las columnas de motivo son las que manda la API, ni una más', async () => {
    const body = renderSection()
    await abrir(body, 'No trabajaron')
    const tabla = body.getAllByRole('table')[0]
    expect(within(tabla).getAllByRole('columnheader').map(c => c.textContent)).toEqual(['Origen', 'Empresa', 'Panne', 'Total'])
  })

  it('Dotación muestra las inconsistencias de dotación', async () => {
    const body = renderSection()
    await abrir(body, 'Dotación')
    expect(await body.findByText('1 empresa con desbalance de dotación')).toBeInTheDocument()
  })

  it('con un backend anterior al rediseño avisa que se está actualizando', async () => {
    vi.mocked(statusReportApi.get).mockResolvedValue({ business_date: '2026-08-02', client_filter: null })
    const body = renderSection()
    expect(await body.findByText('Actualizando el reporte…')).toBeInTheDocument()
  })

  it('si falla la carga ofrece reintentar, y reintentar vuelve a pedir', async () => {
    vi.mocked(statusReportApi.get).mockRejectedValueOnce(new Error('500'))
    const body = renderSection()
    fireEvent.click(await body.findByRole('button', { name: 'Reintentar' }))
    expect(await body.findByText('Equipos activos')).toBeInTheDocument()
    expect(statusReportApi.get).toHaveBeenCalledTimes(2)
  })

  it('filtrar por cliente vuelve a pedir el reporte con ese cliente', async () => {
    const body = renderSection({ shippers: [{ id: 's1', name: 'Walmart', status: 'ACTIVE' }] })
    await body.findByText('Equipos activos')
    fireEvent.change(body.getByRole('combobox', { name: 'Filtrar por cliente' }), { target: { value: 'Walmart' } })
    expect(statusReportApi.get).toHaveBeenCalledWith('2026-08-02', 'Walmart')
  })

  it('el link "Ver histórico" apunta a /dashboard/operations/closures/history', async () => {
    const body = renderSection()
    await body.findByText('Equipos activos')
    expect(body.getByRole('link', { name: /Ver histórico/ })).toHaveAttribute('href', '/dashboard/operations/closures/history')
  })

  it('"Descargar PDF" llama a window.print', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    const body = renderSection()
    await body.findByText('Equipos activos')
    fireEvent.click(body.getByRole('button', { name: /Descargar PDF/ }))
    expect(printSpy).toHaveBeenCalled()
    printSpy.mockRestore()
  })

  it('el resumen imprimible muestra los dos tipos lado a lado', async () => {
    renderSection()
    const impreso = await screen.findByTestId('resumen-imprimible')
    expect(within(impreso).getByText('Tractoreo')).toBeInTheDocument()
    expect(within(impreso).getByText('Equipo Completo')).toBeInTheDocument()
  })

  it('"Descargar Excel" baja los dos tipos aunque se vea uno', async () => {
    const toFile = vi.fn().mockResolvedValue(undefined)
    escribirExcel.mockReset().mockReturnValue({ toFile })
    const body = renderSection()
    await body.findByText('Equipos activos')
    fireEvent.click(body.getByRole('button', { name: /Descargar Excel/ }))
    await waitFor(() => expect(toFile).toHaveBeenCalledWith('reporte_estatus_2026-08-02.xlsx'))
    const hojas = (escribirExcel.mock.calls[0][0] as { sheet: string }[]).map(h => h.sheet)
    expect(hojas).toEqual(expect.arrayContaining(['Asignados · Tractoreo', 'Asignados · Eq. Completo', 'Dotación']))
  })

  it('"Copiar estatus" copia la sección y el tipo a la vista, sin lo plegado', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { write } })
    vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) {} })
    const body = renderSection()
    await abrir(body, 'Asignados')

    fireEvent.click(body.getByRole('button', { name: /Copiar estatus/ }))

    await waitFor(() => expect(write).toHaveBeenCalled())
    const item = write.mock.calls[0][0][0] as { items: Record<string, Blob> }
    const texto = await item.items['text/plain'].text()
    expect(texto).toContain('Estatus del día 02/08 · Tractoreo · Asignados')
    expect(texto).toContain('CD Quilicura')
    expect(texto).not.toContain('Norte Spa')
    expect(await body.findByText(/copiado/i)).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/sections/StatusReportSection.test.tsx`
Expected: FAIL. El componente viejo lee `data.section1_resumen` y revienta, o no encuentra "Equipos activos".

- [ ] **Step 3: Implementar el árbol en pantalla**

`components/dashboard/sections/reporte/TablaDeAsignados.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { AssignedRow } from '@/lib/types'
import { COLUMNAS_DE_ZONA, arbolDeAsignados, filasDelArbol, type FilaDelArbol } from '@/lib/reporte/arbolDeAsignados'

const SANGRIA = ['pl-3', 'pl-7', 'pl-11'] as const

function alternar(conjunto: ReadonlySet<string>, clave: string): Set<string> {
  const nuevo = new Set(conjunto)
  if (nuevo.has(clave)) nuevo.delete(clave)
  else nuevo.add(clave)
  return nuevo
}

export type Plegado = {
  estaAbierto: (clave: string, nivel: 0 | 1) => boolean
  alternar:    (fila: FilaDelArbol) => void
}

/** Qué está abierto en el árbol. Los clientes abren abiertos y los orígenes
 *  cerrados (spec 2026-10-11). Guarda solo lo que la persona tocó, nunca una copia
 *  de los datos: cambiar de tipo o de cliente no lo deja desfasado. Vive en la
 *  sección y no en la tabla, porque la tabla se desmonta cuando un tipo no tiene
 *  asignados, y al volver se perdería. */
export function usePlegado(): Plegado {
  const [clientesPlegados, setClientesPlegados] = useState<ReadonlySet<string>>(new Set())
  const [origenesAbiertos, setOrigenesAbiertos] = useState<ReadonlySet<string>>(new Set())
  return {
    estaAbierto: (clave, nivel) => (nivel === 0 ? !clientesPlegados.has(clave) : origenesAbiertos.has(clave)),
    alternar: fila => {
      if (fila.nivel === 0) setClientesPlegados(c => alternar(c, fila.clave))
      else setOrigenesAbiertos(o => alternar(o, fila.clave))
    },
  }
}

/** Asignados como tabla dinámica: Cliente → Origen del viaje → Empresa, con subtotales. */
export function TablaDeAsignados({ rows, plegado }: { rows: AssignedRow[]; plegado: Plegado }) {
  const arbol = useMemo(() => arbolDeAsignados(rows), [rows])
  const { estaAbierto } = plegado

  return (
    <div className="bg-white rounded-xl border border-border overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase">
            <th className="text-left px-3 py-2">Cliente › Origen › Empresa</th>
            {COLUMNAS_DE_ZONA.map(z => <th key={z.clave} className="text-right px-3 py-2">{z.etiqueta}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {filasDelArbol(arbol, estaAbierto).map(f => {
            const abierto = f.plegable && estaAbierto(f.clave, f.nivel as 0 | 1)
            return (
              <tr key={f.clave} className={f.nivel === 0 ? 'bg-gray-50 font-bold' : f.nivel === 1 ? 'font-semibold' : ''}>
                <td className={`py-2 pr-3 ${SANGRIA[f.nivel]}`}>
                  {f.plegable ? (
                    <button type="button" aria-expanded={abierto} onClick={() => plegado.alternar(f)}
                            className="flex items-center gap-1 hover:text-accent">
                      <ChevronRight size={12} aria-hidden className={`transition-transform ${abierto ? 'rotate-90' : ''}`} />
                      {f.etiqueta}
                    </button>
                  ) : f.etiqueta}
                </td>
                {COLUMNAS_DE_ZONA.map(z => (
                  <td key={z.clave} className={`px-3 py-2 text-right ${z.clave === 'total' ? 'font-bold' : ''}`}>
                    {f.cifras[z.clave]}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border font-bold bg-gray-50">
            <td className="px-3 py-2">Total</td>
            {COLUMNAS_DE_ZONA.map(z => <td key={z.clave} className="px-3 py-2 text-right">{arbol.total[z.clave]}</td>)}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
```

`SeccionAsignados` sigue montada al cambiar de tipo: el armazón (Step 5) la dibuja en la misma posición, sin `key`
por tipo. Por eso `usePlegado` vive ahí. Las claves de los nodos son los nombres de cliente y origen, así que lo
plegado en Tractoreo se aplica a un cliente del mismo nombre en Equipo Completo, que es el mismo cliente.

- [ ] **Step 4: Implementar las secciones**

`components/dashboard/sections/reporte/SeccionesDelReporte.tsx`:

```tsx
'use client'

import type { OperationTypeReport, ReasonRow } from '@/lib/types'
import type { TipoDeOperacion } from '@/lib/reporte/tiposDeOperacion'
import { sumar } from '@/lib/reporte/sumar'
import { TablaDeAsignados, usePlegado } from './TablaDeAsignados'

type Props = { reporte: OperationTypeReport; tipo: TipoDeOperacion }

const TH = 'px-3 py-2 whitespace-nowrap'
const CABECERA = 'bg-gray-50 text-[10px] font-bold text-gray-400 uppercase'

function Titulo({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">{children}</p>
}

/** Nunca una tabla vacía con encabezados: un mensaje que dice qué pasó. */
export function Vacio({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-border px-3 py-6 text-center text-xs text-gray-400 italic">
      {children}
    </div>
  )
}

function Cifra({ titulo, valor }: { titulo: string; valor: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-border p-3">
      <p className="text-[10px] font-bold text-gray-400 uppercase">{titulo}</p>
      <p className="text-xl font-bold text-text-primary">{valor}</p>
    </div>
  )
}

/** Las cuatro cifras del tipo, compartidas con el resumen imprimible. */
export function CuatroCifras({ reporte }: { reporte: OperationTypeReport }) {
  const s = reporte.summary
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Cifra titulo="Equipos activos" valor={s.total} />
      <Cifra titulo="Asignados" valor={s.assigned} />
      <Cifra titulo="No trabajaron" valor={s.not_working} />
      <Cifra titulo="Utilización" valor={<span className="text-accent">{s.utilization_pct}%</span>} />
    </div>
  )
}

export function SeccionResumen({ reporte, tipo }: Props) {
  const s = reporte.summary
  if (s.total === 0) return <Vacio>Hoy no hay equipos de {tipo.etiqueta} enrolados</Vacio>
  return (
    <div className="space-y-4">
      <CuatroCifras reporte={reporte} />
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <Titulo>Asignados por cliente</Titulo>
          {s.by_client.length === 0 ? <Vacio>Hoy no hubo equipos de {tipo.etiqueta} asignados</Vacio> : (
            <div className="bg-white rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className={CABECERA}><th className={`text-left ${TH}`}>Cliente</th><th className={`text-right ${TH}`}>Asignados</th></tr></thead>
                <tbody className="divide-y divide-border/60">
                  {s.by_client.map(c => (
                    <tr key={c.client_name}><td className="px-3 py-2">{c.client_name}</td><td className="px-3 py-2 text-right">{c.assigned}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div>
          <Titulo>Enrolados y asignados por origen habitual</Titulo>
          <div className="bg-white rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={CABECERA}>
                  <th className={`text-left ${TH}`}>Origen habitual</th><th className={`text-right ${TH}`}>Enrolados</th><th className={`text-right ${TH}`}>Asignados</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {s.by_home_origin.map(o => (
                  <tr key={o.origin}>
                    <td className="px-3 py-2">{o.origin}</td><td className="px-3 py-2 text-right">{o.enrolled}</td><td className="px-3 py-2 text-right">{o.assigned}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Origen × empresa por motivo. Dibuja exactamente los motivos que manda la API:
 *  el backend ya manda solo los que ocurrieron. */
export function TablaDeMotivos({ reasons, rows }: { reasons: string[]; rows: ReasonRow[] }) {
  return (
    <div className="bg-white rounded-xl border border-border overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className={CABECERA}>
            <th className={`text-left ${TH}`}>Origen</th>
            <th className={`text-left ${TH}`}>Empresa</th>
            {reasons.map(m => <th key={m} className={`text-right ${TH}`}>{m}</th>)}
            <th className={`text-right ${TH}`}>Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map(r => (
            <tr key={`${r.origin}-${r.carrier_name}`}>
              <td className="px-3 py-2 whitespace-nowrap">{r.origin}</td>
              <td className="px-3 py-2 whitespace-nowrap">{r.carrier_name ?? '—'}</td>
              {reasons.map(m => <td key={m} className="px-3 py-2 text-right">{r.counts[m] ?? 0}</td>)}
              <td className="px-3 py-2 text-right font-bold">{r.total}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border font-bold bg-gray-50">
            <td className="px-3 py-2">Total</td>
            <td className="px-3 py-2" />
            {reasons.map(m => <td key={m} className="px-3 py-2 text-right">{sumar(rows, r => r.counts[m])}</td>)}
            <td className="px-3 py-2 text-right">{sumar(rows, r => r.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export function SeccionAsignados({ reporte, tipo }: Props) {
  const { rows, other_origin } = reporte.assigned
  const sinAsignacion = reporte.worked_without_assignment
  const plegado = usePlegado()
  return (
    <div className="space-y-4">
      {/* Decisión B (minuta 09/10): "lo importante es de dónde salió realmente". */}
      <p className="text-dato text-gray-500">Por el origen real del viaje.</p>
      {rows.length === 0
        ? <Vacio>Hoy no hubo equipos de {tipo.etiqueta} asignados</Vacio>
        : <TablaDeAsignados rows={rows} plegado={plegado} />}
      {sinAsignacion.rows.length > 0 && (
        <div>
          <Titulo>Trabajaron sin asignación</Titulo>
          <TablaDeMotivos reasons={sinAsignacion.reasons} rows={sinAsignacion.rows} />
        </div>
      )}
      {other_origin.length > 0 && (
        <div>
          <p className="text-etiqueta font-bold text-informativo uppercase mb-1.5">Cargaron en otro origen ({other_origin.length})</p>
          <div className="bg-white rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-etiqueta font-bold text-informativo uppercase border-b border-border">
                  <th className={`text-left ${TH}`}>Patente</th><th className={`text-left ${TH}`}>Empresa</th>
                  <th className={`text-left ${TH}`}>Origen habitual</th><th className={`text-left ${TH}`}>Cargó en</th>
                  <th className={`text-left ${TH}`}>Cliente</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {other_origin.map((d, i) => (
                  <tr key={`${d.tractor_plate ?? i}-${d.origin}`}>
                    <td className="px-3 py-2 font-identificador">{d.tractor_plate ?? '—'}</td>
                    <td className="px-3 py-2">{d.carrier_name ?? '—'}</td>
                    <td className="px-3 py-2 text-informativo">{d.home_origin}</td>
                    <td className="px-3 py-2">{d.origin}</td>
                    <td className="px-3 py-2 text-informativo">{d.client_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export function SeccionSegundasVueltas({ reporte, tipo }: Props) {
  if (reporte.second_legs.length === 0) return <Vacio>Hoy ningún equipo de {tipo.etiqueta} hizo una segunda vuelta</Vacio>
  return (
    <div className="bg-white rounded-xl border border-border overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className={CABECERA}>
            <th className={`text-left ${TH}`}>Patente</th><th className={`text-left ${TH}`}>Empresa</th>
            <th className={`text-left ${TH}`}>Conductor</th><th className={`text-left ${TH}`}>Origen del viaje</th>
            <th className={`text-left ${TH}`}>Tipo de destino</th><th className={`text-right ${TH}`}>Vueltas</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {reporte.second_legs.map(v => (
            <tr key={v.tractor_plate}>
              <td className="px-3 py-2 font-mono font-medium">{v.tractor_plate}</td>
              <td className="px-3 py-2">{v.carrier_name}</td>
              <td className="px-3 py-2">{v.driver_name ?? '—'}</td>
              <td className="px-3 py-2 text-gray-500">{v.origin ?? '—'}</td>
              <td className="px-3 py-2 text-gray-500">{v.destination_zone ?? '—'}</td>
              <td className="px-3 py-2 text-right font-bold text-accent">{v.legs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SeccionNoTrabajaron({ reporte, tipo }: Props) {
  const nw = reporte.not_working
  const porConductor = tipo.clave === 'tractoreo'
  if (nw.by_reason.length === 0) {
    return <Vacio>Hoy no hay {porConductor ? 'conductores' : 'equipos'} de {tipo.etiqueta} sin trabajar</Vacio>
  }
  return (
    <div className="space-y-4">
      <div>
        <Titulo>Por motivo</Titulo>
        <TablaDeMotivos reasons={nw.reasons} rows={nw.by_reason} />
      </div>
      {nw.detail.length > 0 && (
        <div>
          <Titulo>{porConductor ? 'Por conductor' : 'Por equipo'}</Titulo>
          <div className="bg-white rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={CABECERA}>
                  <th className={`text-left ${TH}`}>{porConductor ? 'Conductor' : 'Equipo'}</th>
                  <th className={`text-left ${TH}`}>Empresa</th>
                  <th className={`text-left ${TH}`}>Origen habitual</th>
                  <th className={`text-left ${TH}`}>Motivo</th>
                  {porConductor && <th className={`text-left ${TH}`}>Tracto habitual</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {nw.detail.map((d, i) => (
                  <tr key={`${d.name}-${i}`}>
                    <td className={`px-3 py-2 font-medium ${porConductor ? '' : 'font-mono'}`}>{d.name}</td>
                    <td className="px-3 py-2 text-gray-500">{d.carrier_name ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-500">{d.home_origin ?? 'Sin origen'}</td>
                    <td className="px-3 py-2 text-gray-500">{d.reason}</td>
                    {porConductor && <td className="px-3 py-2 text-gray-500">{d.tractor_plate ?? 'Sin tracto reciente'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export function SeccionEmpresas({ reporte, tipo }: Props) {
  if (reporte.carriers.length === 0) return <Vacio>Hoy no hay empresas de {tipo.etiqueta} enroladas</Vacio>
  return (
    <div className="bg-white rounded-xl border border-border overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className={CABECERA}>
            <th className={`text-left ${TH}`}>Empresa</th><th className={`text-right ${TH}`}>Enrolados</th>
            <th className={`text-right ${TH}`}>Asignados</th><th className={`text-right ${TH}`}>No asignados</th>
            <th className={`text-right ${TH}`}>% utilización</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {reporte.carriers.map(r => (
            <tr key={r.carrier_name}>
              <td className="px-3 py-2 font-medium">{r.carrier_name}</td>
              <td className="px-3 py-2 text-right">{r.enrolled}</td>
              <td className="px-3 py-2 text-right text-green-700">{r.assigned}</td>
              <td className="px-3 py-2 text-right text-gray-400">{r.unassigned}</td>
              <td className="px-3 py-2 text-right font-bold text-accent">{r.utilization_pct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 5: Reescribir el armazón**

Reemplaza todo `StatusReportSection.tsx` por:

```tsx
'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Loader2, History, Printer, FileDown, Copy, Check, RotateCw } from 'lucide-react'
import { statusReportApi } from '@/lib/api/statusReport'
import { carriersApi } from '@/lib/api/carriers'
import type { Shipper } from '@/lib/api/locations'
import type { OperationTypeKey } from '@/lib/types'
import { FleetDriverGapCard } from '../FleetDriverGapCard'
import { descargarReporteExcel } from '@/lib/reporte/exportarReporte'
import { TIPOS_DE_OPERACION } from '@/lib/reporte/tiposDeOperacion'
import {
  CuatroCifras, SeccionAsignados, SeccionEmpresas, SeccionNoTrabajaron, SeccionResumen, SeccionSegundasVueltas,
} from './reporte/SeccionesDelReporte'

type Seccion = 'resumen' | 'asignados' | 'segundas_vueltas' | 'no_trabajaron' | 'empresas' | 'dotacion'

/** Seis secciones nombradas por la pregunta que responden (spec 2026-10-11). */
const SECCIONES: { id: Seccion; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'asignados', label: 'Asignados' },
  { id: 'segundas_vueltas', label: 'Segundas vueltas' },
  { id: 'no_trabajaron', label: 'No trabajaron' },
  { id: 'empresas', label: 'Empresas' },
  { id: 'dotacion', label: 'Dotación' },
]

const PILDORA = 'text-[11px] font-semibold px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors'
const pildora = (activa: boolean) =>
  `${PILDORA} ${activa ? 'bg-white text-accent shadow-sm' : 'text-gray-500 hover:text-text-primary'}`
const ACCION = 'flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-accent disabled:opacity-40'

/** 2026-08-02 → 02/08, como lo escribe Operaciones en el correo del día. */
const diaYMes = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`

interface Props {
  fecha:      string
  shippers?:  Shipper[]
}

/** Reporte de estatus del día (Cierre › Reporte). Un tipo de operación a la vez,
 *  elegido arriba; seis secciones; solo lectura. El botón "Confirmar cierre"
 *  vive en la página, no acá. */
export function StatusReportSection({ fecha, shippers }: Props) {
  const [tipo, setTipo] = useState<OperationTypeKey>('tractoreo')
  const [seccion, setSeccion] = useState<Seccion>('resumen')
  const [client, setClient] = useState('')
  // Lo que está a la vista, para "Copiar estatus": el coordinador lo pega tal cual
  // en el correo o el chat del día (minuta 09/10). Lo plegado no está en el DOM,
  // así que no se copia: se copia lo que se ve.
  const contenidoRef = useRef<HTMLDivElement>(null)
  const [copiado, setCopiado] = useState(false)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['status-report', fecha, client],
    queryFn: () => statusReportApi.get(fecha, client || undefined),
  })
  // Mismo queryKey que FleetDriverGapCard: cacheado, no duplica el pedido. Lo usan
  // el PDF y el Excel, aunque no se haya abierto la pestaña Dotación.
  const gapQuery = useQuery({
    queryKey: ['fleet-driver-gap'],
    queryFn: () => carriersApi.fleetDriverGap(),
  })

  const porTipo = data?.by_operation_type
  const tipoActual = TIPOS_DE_OPERACION.find(t => t.clave === tipo)!
  const reporte = porTipo?.[tipo]

  async function copiarEstatus() {
    const nodo = contenidoRef.current
    if (!nodo) return
    const nombre = SECCIONES.find(s => s.id === seccion)?.label ?? ''
    const encabezado = `Estatus del día ${diaYMes(fecha)} · ${tipoActual.etiqueta} · ${nombre}`
    const html = `<p><b>${encabezado}</b></p>${nodo.innerHTML}`
    const texto = `${encabezado}\n\n${nodo.innerText ?? nodo.textContent ?? ''}`
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([texto], { type: 'text/plain' }),
      })])
    } else {
      await navigator.clipboard.writeText(texto)
    }
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <div className="space-y-4">
      {porTipo && (
        <>
          {/* Resumen imprimible de una página: los dos tipos lado a lado (spec §4). */}
          <style>{`
            @media print {
              body * { visibility: hidden; }
              #closures-print-summary, #closures-print-summary * { visibility: visible; }
              #closures-print-summary { position: absolute; inset: 0; padding: 32px; }
            }
          `}</style>
          <div id="closures-print-summary" data-testid="resumen-imprimible" className="hidden print:block text-sm">
            <h1 className="text-xl font-bold mb-1">WebCarga — Reporte de Estatus del Día</h1>
            <p className="text-gray-500 mb-6">{fecha}{client ? ` · ${client}` : ' · WebCarga consolidado'}</p>
            <div className="grid grid-cols-2 gap-6 mb-6">
              {TIPOS_DE_OPERACION.map(t => (
                <div key={t.clave} className="space-y-3">
                  <p className="text-[10px] font-bold text-gray-500 uppercase">{t.etiqueta}</p>
                  <CuatroCifras reporte={porTipo[t.clave]} />
                  <table className="w-full text-xs border-collapse">
                    <tbody>
                      {porTipo[t.clave].summary.by_client.map(c => (
                        <tr key={c.client_name} className="border-b border-gray-100">
                          <td className="py-1">{c.client_name}</td><td className="py-1 text-right">{c.assigned}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
            {gapQuery.data && gapQuery.data.rows.length > 0 && (
              <>
                <p className="text-[10px] font-bold text-gray-500 uppercase mb-1.5">
                  Inconsistencias de dotación ({gapQuery.data.rows.length} empresas)
                </p>
                <table className="w-full text-xs border-collapse mb-6">
                  <thead>
                    <tr className="border-b border-gray-300 text-left">
                      <th className="py-1">Empresa</th><th className="py-1 text-right">Tractos</th><th className="py-1 text-right">Conductores</th><th className="py-1 text-right">Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gapQuery.data.rows.map(r => (
                      <tr key={r.carrier_id} className="border-b border-gray-100">
                        <td className="py-1">{r.business_name}</td>
                        <td className="py-1 text-right">{r.n_tractos}</td>
                        <td className="py-1 text-right">{r.n_conductores}</td>
                        <td className="py-1 text-right">{r.gap > 0 ? `Faltan ${r.gap}` : `${Math.abs(r.gap)} de más`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            <p className="text-[10px] text-gray-400">Generado el {new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}</p>
          </div>
        </>
      )}

      <div data-testid="report-body" className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto max-w-full">
            {TIPOS_DE_OPERACION.map(t => (
              <button key={t.clave} type="button" aria-pressed={tipo === t.clave}
                      disabled={seccion === 'dotacion'} onClick={() => setTipo(t.clave)}
                      className={`${pildora(tipo === t.clave)} disabled:opacity-40`}>
                {t.etiqueta}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <select aria-label="Filtrar por cliente" value={client} onChange={e => setClient(e.target.value)}
                    className="text-[11px] border border-border rounded-lg px-2 py-1.5 bg-white">
              <option value="">WebCarga consolidado</option>
              {(shippers ?? []).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
            <button type="button" onClick={() => window.print()} disabled={!porTipo} className={ACCION}
                    title="Abre el diálogo de impresión — elige 'Guardar como PDF' para descargarlo">
              <Printer size={12} /> Descargar PDF
            </button>
            <button type="button" disabled={!porTipo} className={ACCION}
                    onClick={() => { if (porTipo) void descargarReporteExcel(porTipo, fecha, gapQuery.data?.rows) }}>
              <FileDown size={12} /> Descargar Excel
            </button>
            <button type="button" onClick={() => { void copiarEstatus() }} disabled={!reporte || seccion === 'dotacion'}
                    className={ACCION} title="Copia la sección a la vista, lista para pegar en un correo o un chat">
              {copiado ? <><Check size={12} /> Copiado</> : <><Copy size={12} /> Copiar estatus</>}
            </button>
            <Link href="/dashboard/operations/closures/history" target="_blank" className={ACCION}>
              <History size={12} /> Ver histórico
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-1 border-b border-border overflow-x-auto max-w-full print:hidden">
          {SECCIONES.map(s => (
            <button key={s.id} type="button" aria-pressed={seccion === s.id} onClick={() => setSeccion(s.id)}
                    className={pildora(seccion === s.id)}>
              {s.label}
            </button>
          ))}
        </div>

        {seccion === 'dotacion' ? (
          <FleetDriverGapCard />
        ) : isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : isError ? (
          <div role="alert" className="flex items-center justify-center gap-3 py-16 text-xs text-gray-500">
            No se pudo cargar el reporte.
            <button type="button" onClick={() => { void refetch() }} className={ACCION}>
              <RotateCw size={12} /> Reintentar
            </button>
          </div>
        ) : !reporte ? (
          // Un backend anterior al rediseño todavía no manda `by_operation_type`.
          <p role="status" className="py-16 text-center text-xs text-gray-400">Actualizando el reporte…</p>
        ) : (
          <div ref={contenidoRef}>
            {seccion === 'resumen' && <SeccionResumen reporte={reporte} tipo={tipoActual} />}
            {seccion === 'asignados' && <SeccionAsignados reporte={reporte} tipo={tipoActual} />}
            {seccion === 'segundas_vueltas' && <SeccionSegundasVueltas reporte={reporte} tipo={tipoActual} />}
            {seccion === 'no_trabajaron' && <SeccionNoTrabajaron reporte={reporte} tipo={tipoActual} />}
            {seccion === 'empresas' && <SeccionEmpresas reporte={reporte} tipo={tipoActual} />}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Correr los tests y verlos pasar**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/sections/StatusReportSection.test.tsx lib/reporte/ app/dashboard/operations/closures/page.test.tsx lib/copy/ 2>&1 | tail -20`
Expected: todo PASS.

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 7: Verificar que una mutación hace fallar los tests**

En `usePlegado` (`TablaDeAsignados.tsx`), cambia temporalmente
`(nivel === 0 ? !clientesPlegados.has(clave) : origenesAbiertos.has(clave))` por `true`. Corre `npx vitest run components/dashboard/sections/StatusReportSection.test.tsx -t "orígenes"`
(Expected: FAIL) y revierte el cambio.

- [ ] **Step 8: Commit**

```bash
git add monitor-app/frontend/components/dashboard/sections/StatusReportSection.tsx monitor-app/frontend/components/dashboard/sections/StatusReportSection.test.tsx monitor-app/frontend/components/dashboard/sections/reporte/
git commit -m "feat(reporte): selector de tipo, seis secciones y Asignados como árbol plegable (minuta 09/10, ítems 8 y 14)"
```

---

### Task 5: Suite, despliegue a dev, verificación y AGENTLOG

**Files:**
- Modify: `AGENTLOG.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: el reporte desplegado en `webcarga-frontend-dev` y `webcarga-monitor-api-dev`.

- [ ] **Step 1: Suite completa del backend, una vez, en segundo plano, más build del frontend**

Run (en segundo plano): `cd monitor-app/backend/api && venv/bin/python -m pytest -q > "$CLAUDE_JOB_DIR/tmp/suite.txt" 2>&1; tail -5 "$CLAUDE_JOB_DIR/tmp/suite.txt"`
Expected: todo verde, salvo el rojo preexistente
`test_cargar_catalogo_webcarga::test_aplicar_crea_los_nuevos_apagados_y_sin_sembrar`. Cualquier otro rojo se investiga
antes del push.

Run (en paralelo): `cd monitor-app/frontend && npx vitest run 2>&1 | tail -5 && npm run build 2>&1 | tail -15`
Expected: vitest completo verde y build OK. Si el build falla bajando Google Fonts, reintenta: es el flake conocido de red.

- [ ] **Step 2: Push y ver los dos despliegues**

```bash
git push origin dev
gh run list --branch dev --limit 4
gh run watch <id-del-deploy-backend> --exit-status
gh run watch <id-del-deploy-frontend> --exit-status
```
Expected: los dos deploys en verde. Entre que termina uno y el otro, el frontend viejo con el backend nuevo puede
mostrar un error en el reporte (Review Focus 1). Eso se acepta en dev.

- [ ] **Step 3: Verificar en dev con Playwright**

En `webcarga-frontend-dev`, Cierre › Reporte:
1. **09/10.** Revisa el selector y las seis secciones en los dos tipos. Pliega un cliente, abre un origen y copia el
   estatus. Descarga el Excel y confirma 11 hojas. Mira la pantalla en escritorio y en 390 px de ancho.
2. **07/10.** Compara el total de Asignados con el CSV de Pablo (`monitor-app/bugs/20261009/reporte_estatus_2026-10-07.csv`):
   32 en Tractoreo y 8 en Equipo Completo. Si hay diferencia, explícala por patente con una consulta de solo lectura
   (`execute_sql`) sobre los viajes del día y su tipo de operación. No corrijas datos.
3. Guarda las capturas en `$CLAUDE_JOB_DIR/tmp/`.

- [ ] **Step 4: AGENTLOG**

Actualiza `AGENTLOG.md` con:
- **Qué se hizo:** el reporte por tipo, ítems 8 y 14 de la minuta, en dev, y los commits.
- **Resultado del 07/10 contra el CSV:** cuadra, o la diferencia y su explicación.
- **Decisiones:**
  - claves en inglés;
  - "Sin motivo";
  - `not_working` cuenta equipos;
  - se retiró multi-día;
  - `sumar.ts`.
- **Siguiente paso:**
  - minuta 5, A, 21, 23 y el resto de 20;
  - el rediseño del detalle del viaje, en pausa.

```bash
git add AGENTLOG.md
git commit -m "docs(agentlog): reporte de estatus por tipo en dev"
git push origin dev
```
