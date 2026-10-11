# Certificación › Pendientes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Certificación tenga una sección "Pendientes" donde se elige un documento (o una empresa), se ve quién lo debe —vencido, por vencer o falta— y se carga en la fila o en lote, con una sola definición de estado y de alcance.

**Architecture:** El backend agrega dos funciones SQL únicas en `vencimientos.py` (`document_state_sql`, `in_scope_sql`). El `/pending` existente las usa, y sobre la misma CTE se agregan un resumen agregado (`GET /pending/summary`) y una propuesta de asignación que no escribe (`POST /pending/match`). La propuesta usa una función pura nueva, `match_owner`, que reutiliza las piezas de `document_matcher.py`. El frontend agrega la ruta `/dashboard/compliance/pending`: lista y detalle, la carga en fila con el gesto que ya existe y la revisión del lote.

**Tech Stack:** FastAPI + asyncpg (Postgres 17 en Supabase), pytest (integración con `conexion_revertida`), Next.js 16 app router + React Query + Tailwind con tokens propios, vitest + Testing Library, Playwright (copia local).

**Spec:** `docs/superpowers/specs/2026-10-11-pending-documents-design.md` (aprobada el 11/10). Maquetas aprobadas, fuera de git: `.superpowers/brainstorm/84727-1791741985/content/pendientes-estados.html` y `pendientes-carga-en-lote.html`.

## Global Constraints

- **Nombres:** todo lo nuevo (funciones, componentes, archivos, claves JSON, rutas, parámetros) en inglés estándar. La interfaz, en español neutral: nunca voseo ("Elige", "Arrastra", nunca "Elegí"/"Arrastrá") y cero emojis (solo íconos de `lucide-react`).
- **Sin parches:** una sola definición de estado (`document_state_sql`) y una sola de alcance (`in_scope_sql`). Nada se calcula dos veces.
- **Backend:** los tests de integración van contra la base real con `conexion_revertida` (transacción que siempre se revierte). Los sujetos los crea el test, con prefijo `ZZ-TEST-PENDIENTES`. Ningún test depende de datos de producción.
- **Requisitos de test:** se insertan con `is_active = false` y los registros se crean a mano. Un requisito activo dispara la siembra sobre todo el padrón (miles de filas).
- **Venv del backend:** `monitor-app/backend/api/venv/bin/python -m pytest …`. Nunca correr `tests/test_padron_conductor.py` con `--padron-completo`.
- **Sistema visual:** solo tokens y primitivas (`text-etiqueta/dato/lectura/titulo`, `text-informativo`, `text-accion`, `text-status-incidente`, `text-resuelto`, `text-warning`, `bg-bg-main`, `border-border`, `StatusChip`, `Estado`, `EncabezadoDePagina`). Los trinquetes de `lib/ui/sistema.test.ts` y `lib/ui/escala.test.ts` no pueden subir.
- **Alcance de Pendientes:** solo empresas `ACTIVE`, y conductores o equipos `ACTIVE` con asignación `ACTIVE` a una empresa `ACTIVE`. Se aplica cuando llega `state` (las pantallas nuevas). Sin `state` (la ficha de una empresa, el cajón) el comportamiento de hoy no cambia.
- **Compatibilidad:** `/pending?estado=…` y el campo `urgencia` siguen respondiendo igual que hoy.
- **Fin del plan:** la suite del área y `npm run build` corren al final, porque se toca código compartido. Deploy a `dev` cuando esté en verde. Nada a `main`. Mage no se toca.
- **Commits:** terminan con `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Archivo sin la fecha que pide su regla:** un registro aprobado al que le falta la emisión o el período debe salir `OVERDUE` en Pendientes, y su fila decir "Falta indicar la fecha de emisión" o "Falta indicar el período". No puede salir "Al día" ni "Falta". Test en la Task 1.
2. **Empresa activa con un conductor inactivo:** el documento de la empresa aparece en Pendientes y el del conductor no. En la ficha de esa empresa (`carrier_id`) el del conductor sí aparece. Test en la Task 2.
3. **Dos archivos con el mismo RUT en un lote:** ninguno se guarda solo; los dos quedan "Por elegir". Test en la Task 5.
4. **Lote con un archivo de alguien que ya está al día:** queda "Sin asignar", sin proponer a nadie. Test en la Task 5.
5. **Carga en lote que falla a mitad:** las filas ya guardadas no se repiten ni se pierden, y la que falló conserva su motivo y su archivo para reintentar. Test en la Task 10.

## Rulings tomados al escribir el plan (desvíos de la spec)

- **R1 — Motor del match.** La spec dice "`document_matcher`, la función pura de la Bandeja". `match_document` no sirve tal cual: su confianza depende de reconocer el TIPO de documento por alias (sin alias, un RUT exacto queda en 0,60) y no compara nombres de empresa. Aquí el documento ya se sabe. Se agrega `match_owner` al MISMO módulo, reutilizando sus piezas (`extract_ruts`, `normalize_text`, `best_name_similarity`, `_fuzzy_confidence`, `_FUZZY_FLOOR`, `_AMBIGUITY_MARGIN`). Si esto estuviera mal, el costo es una función de unas 50 líneas.
- **R2 — Frase de la regla y período sugerido.** La spec pide `rule_label` y `suggested_period_start` desde la API. Las dos cosas ya tienen una única definición en el frontend: `resumenDeVigencia` (`lib/vigencia.ts`) y `periodoSugerido` (`lib/compliance.ts`), que ya usa el gesto de carga. El resumen devuelve entonces `expiration_policy` + `vigencia` (los parámetros de la regla, con la misma forma que el catálogo), y el frontend formatea con esas funciones. Repetirlas en Python sería una segunda definición. Si estuviera mal, el costo es un campo más en la respuesta.
- **R4 — Cuándo se aplica el alcance.** La spec dice "las consultas sin `carrier_id` aplican `in_scope_sql`". Pero Pendientes "Ver por empresa" pide la lista CON `carrier_id`, y así la derecha mostraría conductores inactivos que la izquierda no cuenta. El alcance se ata a `state`: lo manda la pantalla nueva y no lo manda ninguna pantalla de hoy. Las pantallas de hoy quedan idénticas y la nueva es coherente en los dos ejes. Si estuviera mal, el costo es una condición SQL.
- **R3 — Fila de quien debe.** La spec nombra un `PendingHolderRow` nuevo. El renglón de carga de Certificación (`RenglonPendiente`) ya resuelve recibir, pedir la fecha, subir, error, reintento y listo. Se le agrega la variante `title` como prop ("una variante es una prop, no un componente hermano"), y Pendientes lo usa con el nombre de quien debe. Si estuviera mal, el costo es extraer un componente después.

---

## File Structure

**Backend (`monitor-app/backend/api/`)**

| Archivo | Responsabilidad |
|---|---|
| `app/services/vencimientos.py` (modificar) | + `document_state_sql(alias)`, `in_scope_sql(alias)`, `DOCUMENT_STATES`, `PENDING_STATES`: la única definición de estado y alcance. |
| `app/services/vigencia.py` (modificar) | + `regla_base_json_sql(req_alias)`: la regla vigente como JSON, ya usada en el catálogo. |
| `app/routers/requirements.py` (modificar) | `SQL_CATALOGO` usa `regla_base_json_sql`, sin duplicar el subselect. |
| `app/services/document_matcher.py` (modificar) | + `PendingOwner`, `OwnerCandidate`, `match_owner()`: función pura. |
| `app/routers/compliance.py` (modificar) | La CTE de `/pending` pasa a `_pending_ctes()`; `state`, alcance, `document_state` y orden; + `GET /pending/summary` y `POST /pending/match`. |
| `app/schemas/compliance.py` (modificar) | `document_state` en `PendingComplianceRow`; `PendingSummaryRow/Response`; `PendingMatchBody`, `PendingMatchFile`, `PendingMatchResponse`. |
| `tests/test_pending_documents_integration.py` (crear) | Estado, alcance, coherencia del resumen, match sin escritura, compatibilidad. |
| `tests/test_match_owner.py` (crear) | Unidad de la función pura. |
| `tests/test_compliance.py` (modificar) | 403 de los endpoints nuevos y orden de rutas. |

**Frontend (`monitor-app/frontend/`)**

| Archivo | Responsabilidad |
|---|---|
| `components/ui/SegmentedControl.tsx` (+ test) (crear) | El control segmentado genérico, que se mueve desde la Bitácora. |
| `components/dashboard/TripNotesFeed.tsx` (modificar) | Importa `SegmentedControl` en vez de definirlo. |
| `lib/types.ts` (modificar) | `DocumentState`, `PendingState`, `document_state` en `PendingComplianceRow`, tipos de resumen y match. |
| `lib/api/compliance.ts` (modificar) | `listPending({ state })`, `pendingSummary()`, `matchPendingFiles()`. |
| `lib/queries/certificacion.ts` (modificar) | Claves `pendientesGlobales`, `resumenPendientes` y la raíz nueva en `RAICES_DE_CERTIFICACION`. |
| `components/compliance/RenglonPendiente.tsx` (+ test) (modificar) | Prop `title?: ReactNode` (variante). |
| `components/compliance/pending/PendingSummaryList.tsx` (+ test) (crear) | La columna izquierda. |
| `components/compliance/pending/PendingHoldersPanel.tsx` (+ test) (crear) | La columna derecha: encabezado, filtros, filas y estados. |
| `components/compliance/pending/usePendingBulkUpload.ts` (+ test) (crear) | La lógica del lote: match, elegir, datos y guardado de a tres. |
| `components/compliance/pending/BulkUploadReview.tsx` (+ test) (crear) | La revisión del lote. |
| `app/dashboard/compliance/pending/page.tsx` (+ test) (crear) | La ruta y el estado en la URL. |
| `components/dashboard/Sidebar.tsx` (modificar) | El ítem "Pendientes". |
| `lib/rutas.test.ts` (modificar) | El segmento `pending` en la lista de rutas en inglés. |

---

### Task 1: Estado y alcance únicos (`vencimientos.py`)

**Files:**
- Modify: `monitor-app/backend/api/app/services/vencimientos.py` (agregar al final, después de `pendiente_predicate`)
- Create: `monitor-app/backend/api/tests/test_pending_documents_integration.py`

**Interfaces:**
- Produces:
  - `document_state_sql(alias: str = "cr") -> str`: expresión SQL que evalúa a `'NOT_REQUIRED' | 'UP_TO_DATE' | 'OVERDUE' | 'EXPIRING' | 'MISSING'`.
  - `in_scope_sql(alias: str = "cr") -> str`: expresión booleana.
  - `DOCUMENT_STATES: tuple[str, ...]` y `PENDING_STATES = ("OVERDUE", "EXPIRING", "MISSING")`.
  - El alias necesita `requirement_id, entity_type, entity_id, status, expiration_date, issue_date, period_start` (el contrato que ya documenta el módulo).

- [ ] **Step 1: Write the failing tests**

Crear `tests/test_pending_documents_integration.py`:

```python
"""Certificación › Pendientes (spec 2026-10-11-pending-documents-design.md).

Contra la base real, en una transacción revertida. Los sujetos los crea cada
test con el prefijo ZZ-TEST-PENDIENTES; los requisitos nacen APAGADOS
(is_active = false) para que la siembra no recorra el padrón, y los registros
se insertan a mano con el estado y las fechas que cada caso necesita."""
from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

import pytest

from app.services.vencimientos import document_state_sql, in_scope_sql

pytestmark = pytest.mark.integracion

PREFIJO = "ZZ-TEST-PENDIENTES"


def _suf() -> str:
    return uuid4().hex[:8]


async def _hoy(conn) -> date:
    return await conn.fetchval("SELECT public.hoy_chile()")


async def _empresa(conn, *, estado: str = "ACTIVE") -> str:
    s = _suf()
    return str(await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id, operational_status) "
        "VALUES ($1, $2, $3) RETURNING id",
        f"{PREFIJO} Empresa {s}", f"{PREFIJO}-{s}", estado))


async def _conductor(conn, empresa: str | None, *, estado: str = "ACTIVE",
                     asignacion: str | None = "ACTIVE") -> str:
    d = str(await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, $2) RETURNING id",
        f"{PREFIJO} Conductor {_suf()}", estado))
    if empresa and asignacion:
        await conn.execute(
            "INSERT INTO public.driver_assignments (driver_id, carrier_id, status, start_date) "
            "VALUES ($1, $2, $3, public.hoy_chile() - 400)", d, empresa, asignacion)
    return d


async def _requisito(conn, *, entidad: str, politica: str = "REQUIRED",
                     exigible_on: str = "ON_ENTITY_START") -> str:
    return str(await conn.fetchval(
        """
        INSERT INTO public.compliance_requirements
            (target_entity, requirement_code, name, requirement_level,
             expiration_policy, exigible_on, is_active, requires_file)
        VALUES ($1, $2, $3, 'LEGAL_MANDATORY', $4, $5, false, true)
        RETURNING id
        """,
        entidad, f"ZZ_PEND_{_suf().upper()}", f"{PREFIJO} documento", politica, exigible_on))


async def _registro(conn, requisito: str, entidad_tipo: str, entidad_id: str, *,
                    status: str = "MISSING", vence: date | None = None,
                    emision: date | None = None, periodo: date | None = None) -> str:
    return str(await conn.fetchval(
        """
        INSERT INTO public.compliance_records
            (entity_id, entity_type, requirement_id, status, is_current,
             expiration_date, issue_date, period_start, file_url)
        VALUES ($1, $2, $3, $4, true, $5, $6, $7,
                CASE WHEN $4 = 'MISSING' THEN NULL ELSE 'zz/test.pdf' END)
        RETURNING id
        """,
        entidad_id, entidad_tipo, requisito, status, vence, emision, periodo))


async def _estado(conn, registro: str) -> str:
    return await conn.fetchval(
        f"SELECT {document_state_sql('cr')} FROM public.compliance_records cr WHERE cr.id = $1",
        registro)


async def _en_alcance(conn, registro: str) -> bool:
    return await conn.fetchval(
        f"SELECT {in_scope_sql('cr')} FROM public.compliance_records cr WHERE cr.id = $1",
        registro)


# ── Estado ───────────────────────────────────────────────────────────────────

async def test_un_documento_que_nunca_se_cargo_falta(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    req = await _requisito(conn, entidad="CARRIER")
    assert await _estado(conn, await _registro(conn, req, "CARRIER", empresa)) == "MISSING"


async def test_una_fecha_impresa_que_ya_paso_esta_vencida(conexion_revertida):
    conn = conexion_revertida
    hoy = await _hoy(conn)
    empresa = await _empresa(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="REQUIRED")
    reg = await _registro(conn, req, "CARRIER", empresa, status="APPROVED_MANUAL",
                          vence=hoy - timedelta(days=3))
    assert await _estado(conn, reg) == "OVERDUE"


async def test_dentro_del_aviso_general_esta_por_vencer(conexion_revertida):
    conn = conexion_revertida
    hoy = await _hoy(conn)
    empresa = await _empresa(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="REQUIRED")
    reg = await _registro(conn, req, "CARRIER", empresa, status="APPROVED_MANUAL",
                          vence=hoy + timedelta(days=10))
    assert await _estado(conn, reg) == "EXPIRING"


async def test_lejos_del_vencimiento_esta_al_dia(conexion_revertida):
    conn = conexion_revertida
    hoy = await _hoy(conn)
    empresa = await _empresa(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="REQUIRED")
    reg = await _registro(conn, req, "CARRIER", empresa, status="APPROVED_MANUAL",
                          vence=hoy + timedelta(days=400))
    assert await _estado(conn, reg) == "UP_TO_DATE"


async def test_un_archivo_sin_la_emision_que_pide_su_regla_esta_vencido(conexion_revertida):
    """Review Focus 1: cargado, pero sin el dato que su tipo necesita. No es
    "al día" ni "falta": no sirve, y la fila lo dice."""
    conn = conexion_revertida
    empresa = await _empresa(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="ISSUE_PLUS_MONTHS")
    await conn.execute(
        "INSERT INTO public.compliance_requirement_rules "
        "(requirement_id, shipper_id, validity_months, vigente_desde) "
        "VALUES ($1, NULL, 3, public.hoy_chile() - 30)", req)
    reg = await _registro(conn, req, "CARRIER", empresa, status="APPROVED_MANUAL")
    assert await _estado(conn, reg) == "OVERDUE"


async def test_desde_el_mes_siguiente_al_ingreso_todavia_no_se_exige(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    d = str(await conn.fetchval(
        "INSERT INTO public.drivers (full_name) VALUES ($1) RETURNING id", f"{PREFIJO} {_suf()}"))
    await conn.execute(
        "INSERT INTO public.driver_assignments (driver_id, carrier_id, status, start_date) "
        "VALUES ($1, $2, 'ACTIVE', public.hoy_chile())", d, empresa)
    req = await _requisito(conn, entidad="DRIVER", exigible_on="MONTH_AFTER_START")
    assert await _estado(conn, await _registro(conn, req, "DRIVER", d)) == "NOT_REQUIRED"


# ── Alcance ──────────────────────────────────────────────────────────────────

async def test_el_documento_de_una_empresa_activa_esta_en_alcance(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    req = await _requisito(conn, entidad="CARRIER")
    assert await _en_alcance(conn, await _registro(conn, req, "CARRIER", empresa)) is True


async def test_el_documento_de_una_empresa_de_baja_no_esta_en_alcance(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn, estado="INACTIVE")
    req = await _requisito(conn, entidad="CARRIER")
    assert await _en_alcance(conn, await _registro(conn, req, "CARRIER", empresa)) is False


async def test_un_conductor_inactivo_no_esta_en_alcance(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    d = await _conductor(conn, empresa, estado="INACTIVE")
    req = await _requisito(conn, entidad="DRIVER")
    assert await _en_alcance(conn, await _registro(conn, req, "DRIVER", d)) is False


async def test_un_conductor_sin_asignacion_vigente_no_esta_en_alcance(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    d = await _conductor(conn, empresa, asignacion="INACTIVE")
    req = await _requisito(conn, entidad="DRIVER")
    assert await _en_alcance(conn, await _registro(conn, req, "DRIVER", d)) is False


async def test_un_conductor_activo_de_una_empresa_de_baja_no_esta_en_alcance(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn, estado="INACTIVE")
    d = await _conductor(conn, empresa)
    req = await _requisito(conn, entidad="DRIVER")
    assert await _en_alcance(conn, await _registro(conn, req, "DRIVER", d)) is False


async def test_un_conductor_activo_de_una_empresa_activa_esta_en_alcance(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    d = await _conductor(conn, empresa)
    req = await _requisito(conn, entidad="DRIVER")
    assert await _en_alcance(conn, await _registro(conn, req, "DRIVER", d)) is True
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_pending_documents_integration.py -q`
Expected: error de import, `cannot import name 'document_state_sql' from 'app.services.vencimientos'`.

- [ ] **Step 3: Implement**

Agregar al final de `app/services/vencimientos.py`, después de `pendiente_predicate`:

```python
# ── El estado de un documento y quién entra en la cola, UNA vez ──────────────
#
# Vivía como un CASE escrito dentro de GET /compliance-records/pending, y el
# resto de las pantallas tenía su propia versión. Pendientes (spec
# 2026-10-11-pending-documents-design.md) necesita la misma respuesta en la
# lista y en el resumen, así que la definición se muda acá. Los demás lectores
# (avisos del viaje, vista rápida, roster) migran en el bloque 3.

DOCUMENT_STATES = ("NOT_REQUIRED", "UP_TO_DATE", "OVERDUE", "EXPIRING", "MISSING")
PENDING_STATES = ("OVERDUE", "EXPIRING", "MISSING")


def document_state_sql(alias: str = "cr") -> str:
    """En qué estado está un registro. Excluyentes, en este orden:
      NOT_REQUIRED  todavía no se exige (p. ej. desde el mes siguiente al ingreso)
      UP_TO_DATE    no está pendiente
      OVERDUE       venció, o se marcó vencido, o tiene archivo sin el dato que
                    su regla necesita (vence_el = -infinity): no sirve
      EXPIRING      dentro de la ventana de aviso
      MISSING       se exige y nunca se cargó"""
    return (
        f"(CASE WHEN NOT {exigible_sql(alias)} THEN 'NOT_REQUIRED' "
        f"WHEN NOT {pendiente_predicate(alias)} THEN 'UP_TO_DATE' "
        f"WHEN {alias}.status = 'EXPIRED' OR {vencido_predicate(alias)} THEN 'OVERDUE' "
        f"WHEN {por_vencer_predicate(alias)} THEN 'EXPIRING' "
        f"ELSE 'MISSING' END)"
    )


def in_scope_sql(alias: str = "cr") -> str:
    """Si el registro entra en la cola de Pendientes: una empresa activa, o un
    conductor o equipo activo con asignación vigente a una empresa activa.

    La siembra NO se acota (crea registros para todos, también inactivos, para
    que quien se reactiva vuelva con sus pendientes): el alcance se aplica al
    leer. Autocontenido sobre `entity_type`/`entity_id`, para que cualquier
    consulta lo pueda usar sin depender de sus JOINs."""
    activa = "vg_sc.operational_status = 'ACTIVE'"
    return (
        f"(CASE {alias}.entity_type "
        f"WHEN 'CARRIER' THEN EXISTS (SELECT 1 FROM public.carriers vg_sc "
        f"WHERE vg_sc.id = {alias}.entity_id AND {activa}) "
        f"WHEN 'DRIVER' THEN EXISTS (SELECT 1 FROM public.drivers vg_sd "
        f"JOIN public.driver_assignments vg_sa ON vg_sa.driver_id = vg_sd.id AND vg_sa.status = 'ACTIVE' "
        f"JOIN public.carriers vg_sc ON vg_sc.id = vg_sa.carrier_id AND {activa} "
        f"WHERE vg_sd.id = {alias}.entity_id AND vg_sd.operational_status = 'ACTIVE') "
        f"WHEN 'ASSET' THEN EXISTS (SELECT 1 FROM public.assets vg_sx "
        f"JOIN public.asset_assignments vg_sa ON vg_sa.asset_id = vg_sx.id AND vg_sa.status = 'ACTIVE' "
        f"JOIN public.carriers vg_sc ON vg_sc.id = vg_sa.carrier_id AND {activa} "
        f"WHERE vg_sx.id = {alias}.entity_id AND vg_sx.operational_status = 'ACTIVE') "
        f"ELSE false END)"
    )
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `venv/bin/python -m pytest tests/test_pending_documents_integration.py -q`
Expected: `12 passed`.

- [ ] **Step 5: Mutation check (alcance)**

Cambiar temporalmente en `in_scope_sql` `vg_sd.operational_status = 'ACTIVE'` por `true` y correr `-k conductor_inactivo`. Expected: FAIL. Revertir y correr de nuevo. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api/app/services/vencimientos.py monitor-app/backend/api/tests/test_pending_documents_integration.py
git commit -m "feat(certificacion): estado y alcance de un documento definidos una sola vez

document_state_sql (NOT_REQUIRED/UP_TO_DATE/OVERDUE/EXPIRING/MISSING) e
in_scope_sql (empresa activa; conductor o equipo activo con asignación vigente
a una empresa activa) en vencimientos.py, para Pendientes (spec 2026-10-11).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `/pending` usa el estado único: `state`, alcance, orden y `document_state`

**Files:**
- Modify: `monitor-app/backend/api/app/routers/compliance.py`:
  - `_PENDING_ROWS_SQL` (alrededor de las líneas 453–630 al commit `d59975a9`);
  - el handler `list_pending_compliance_records` (alrededor de la línea 633);
  - los imports de `vencimientos` (alrededor de la línea 61).
- Modify: `monitor-app/backend/api/app/schemas/compliance.py` (`PendingComplianceRow`, alrededor de la línea 61)
- Test: `monitor-app/backend/api/tests/test_pending_documents_integration.py` (agregar)

**Interfaces:**
- Consumes: `document_state_sql`, `in_scope_sql` y `PENDING_STATES` (Task 1).
- Produces:
  - `_pending_ctes(estado_param: str) -> str`: el texto `pending AS (…), resolved AS (…)` con `document_state` e `in_scope` como columnas, y el filtro viejo `estado` sobre el placeholder que se le pase.
  - `GET /pending` acepta `state: Literal["overdue","expiring","missing","pending","all"] | None`, y cada fila trae `document_state`.
  - `STATE_FILTERS: dict[str, tuple[str, ...] | None]` (en `compliance.py`), que traduce `state` a la lista de `document_state`.

- [ ] **Step 1: Write the failing tests**

Agregar a `tests/test_pending_documents_integration.py`:

```python
from app.routers.compliance import list_pending_compliance_records
from tests.conftest import PoolDeUnaConexion


async def _listar(conn, *, requirement_code=None, carrier_id=None, state=None, estado="falta"):
    """El handler con TODOS sus parámetros explícitos (los defaults son Query())."""
    return await list_pending_compliance_records(
        carrier_id=carrier_id, category=None, requirement_code=requirement_code, q="",
        operation_type=None, entity_id=None, limit=500, offset=0, estado=estado, state=state,
        pool=PoolDeUnaConexion(conn), _=None)


async def _codigo(conn, req: str) -> str:
    return await conn.fetchval("SELECT requirement_code FROM public.compliance_requirements WHERE id = $1", req)


async def test_pending_con_state_trae_el_estado_y_ordena_vencido_por_vencer_falta(conexion_revertida):
    conn = conexion_revertida
    hoy = await _hoy(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="REQUIRED")
    falta = await _empresa(conn)
    por_vencer = await _empresa(conn)
    vencida = await _empresa(conn)
    await _registro(conn, req, "CARRIER", falta)
    await _registro(conn, req, "CARRIER", por_vencer, status="APPROVED_MANUAL", vence=hoy + timedelta(days=5))
    await _registro(conn, req, "CARRIER", vencida, status="APPROVED_MANUAL", vence=hoy - timedelta(days=5))

    res = await _listar(conn, requirement_code=await _codigo(conn, req), state="pending")

    assert [r["document_state"] for r in res["rows"]] == ["OVERDUE", "EXPIRING", "MISSING"]
    assert [r["carrier_id"] for r in res["rows"]] == [vencida, por_vencer, falta]


async def test_pending_state_overdue_trae_solo_los_vencidos(conexion_revertida):
    conn = conexion_revertida
    hoy = await _hoy(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="REQUIRED")
    await _registro(conn, req, "CARRIER", await _empresa(conn))
    vencida = await _empresa(conn)
    await _registro(conn, req, "CARRIER", vencida, status="APPROVED_MANUAL", vence=hoy - timedelta(days=1))

    res = await _listar(conn, requirement_code=await _codigo(conn, req), state="overdue")

    assert [r["carrier_id"] for r in res["rows"]] == [vencida]


async def test_pending_global_no_trae_a_un_conductor_inactivo_pero_la_ficha_si(conexion_revertida):
    """Review Focus 2: el alcance se aplica a la cola, no a la ficha."""
    conn = conexion_revertida
    empresa = await _empresa(conn)
    activo = await _conductor(conn, empresa)
    inactivo = await _conductor(conn, empresa, estado="INACTIVE")
    req = await _requisito(conn, entidad="DRIVER")
    await _registro(conn, req, "DRIVER", activo)
    await _registro(conn, req, "DRIVER", inactivo)
    codigo = await _codigo(conn, req)

    cola = await _listar(conn, requirement_code=codigo, state="pending")
    por_empresa = await _listar(conn, requirement_code=codigo, carrier_id=empresa, state="pending")
    ficha = await _listar(conn, requirement_code=codigo, carrier_id=empresa)  # sin state: la ficha de hoy

    assert [r["entity_id"] for r in cola["rows"]] == [activo]
    assert [r["entity_id"] for r in por_empresa["rows"]] == [activo]
    assert {r["entity_id"] for r in ficha["rows"]} == {activo, inactivo}


async def test_pending_sin_state_responde_como_antes(conexion_revertida):
    """Compatibilidad: `estado` (default 'falta') y `urgencia` no cambian."""
    conn = conexion_revertida
    hoy = await _hoy(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="REQUIRED")
    empresa = await _empresa(conn)
    await _registro(conn, req, "CARRIER", empresa, status="APPROVED_MANUAL", vence=hoy - timedelta(days=2))

    res = await _listar(conn, requirement_code=await _codigo(conn, req))

    assert [r["urgencia"] for r in res["rows"]] == ["VENCIDO"]
    assert res["rows"][0]["document_state"] == "OVERDUE"
```

- [ ] **Step 2: Run them and watch them fail**

Run: `venv/bin/python -m pytest tests/test_pending_documents_integration.py -q -k "pending_"`
Expected: `TypeError: list_pending_compliance_records() got an unexpected keyword argument 'state'`.

- [ ] **Step 3: Implement**

(a) Imports en `compliance.py`: agregar `document_state_sql, in_scope_sql, PENDING_STATES` al bloque `from ..services.vencimientos import (…)`.

(b) Extraer la CTE. Cortar de `_PENDING_ROWS_SQL` el texto que va desde `pending AS (` hasta el `)` que cierra `resolved` (inclusive, sin la coma siguiente) y moverlo a una función sobre `_PENDING_ROWS_SQL`. El texto se copia literal, con dos cambios:
- `CASE $10::text` pasa a `CASE {estado_param}::text`;
- se agregan las dos columnas nuevas y `req.target_entity` al SELECT de `pending`.

```python
def _pending_ctes(estado_param: str) -> str:
    """Las CTE `pending` y `resolved` de Pendientes, una sola vez. Las usan
    la lista (/pending) y el resumen (/pending/summary): si cada uno las
    escribiera, las cifras de la izquierda y la lista de la derecha podrían
    dejar de coincidir. `estado_param` es el placeholder del filtro viejo
    (`estado`), que cada consulta numera a su manera."""
    return f"""
pending AS (
    SELECT cr.id, cr.entity_type, cr.entity_id, cr.status, cr.expiration_date,
           cr.issue_date, cr.period_start,
           {vence_el_sql('cr')} AS vence_calculado,
           req.exigible_on = 'ON_REQUEST' AS a_pedido,
           cr.file_url IS NOT NULL AS tiene_archivo,
           req.id AS requirement_id, req.target_entity,
           req.requirement_code, req.name AS document_name, req.requirement_level,
           req.expiration_policy,
           -- La definición única (services/vencimientos.py, spec 2026-10-11).
           {document_state_sql('cr')} AS document_state,
           {in_scope_sql('cr')} AS in_scope
    FROM public.compliance_records cr
    JOIN public.compliance_requirements req ON req.id = cr.requirement_id
    WHERE cr.is_current = true
      AND CASE {estado_param}::text
            WHEN 'todos'      THEN true
            WHEN 'por_vencer' THEN {exigible_sql('cr')} AND {por_vencer_predicate('cr')}
            WHEN 'al_dia'     THEN {cubierto_predicate('cr')}
            ELSE {pendiente_predicate('cr')}
          END
),
resolved AS (
    SELECT p.*,
        CASE p.entity_type
            WHEN 'CARRIER' THEN p.entity_id
            -- Un documento "al término" (finiquito) es de la empresa que el
            -- conductor dejó: sin asignación ACTIVE, la última que tuvo.
            WHEN 'DRIVER'  THEN COALESCE(da.carrier_id, {_empresa_que_dejo_sql('p')})
            WHEN 'ASSET'   THEN aa.carrier_id
        END AS resolved_carrier_id,
        CASE p.entity_type
            WHEN 'DRIVER' THEN d.full_name
            WHEN 'ASSET'  THEN a.license_plate
            ELSE NULL
        END AS subject_name,
        -- Que ES el vehiculo, no solo su patente. Son dos datos distintos y
        -- ninguno reemplaza al otro: `asset_type` esta SIEMPRE (124 de 124
        -- vehiculos: 87 TRACTOCAMION, 37 RAMPLA) y dice el chasis;
        -- `fleet_service_type_id` es el subtipo de carroceria y solo lo tienen
        -- las ramplas (36 de 37; los 87 tractocamiones lo tienen en NULL).
        -- Por eso viajan los dos y la pantalla dibuja uno o dos badges segun
        -- lo que haya, en vez de elegir un campo y mentir cuando falta.
        --
        -- Nulos para CARRIER y DRIVER por construccion: el LEFT JOIN a
        -- `public.assets` ya solo matchea cuando entity_type = 'ASSET'.
        a.asset_type,
        fst.label      AS fleet_service_type_label,
        fst.bg_color   AS fleet_service_type_bg_color,
        fst.text_color AS fleet_service_type_text_color
    FROM pending p
    LEFT JOIN public.driver_assignments da
        ON p.entity_type = 'DRIVER' AND da.driver_id = p.entity_id AND da.status = 'ACTIVE'
    LEFT JOIN public.asset_assignments aa
        ON p.entity_type = 'ASSET' AND aa.asset_id = p.entity_id AND aa.status = 'ACTIVE'
    LEFT JOIN public.drivers d ON p.entity_type = 'DRIVER' AND d.id = p.entity_id
    LEFT JOIN public.assets a ON p.entity_type = 'ASSET' AND a.id = p.entity_id
    -- Los colores salen del catalogo, no del frontend: `app.status_taxonomies`
    -- ya trae bg_color/text_color por fila y es lo que ya leen las otras
    -- pantallas de flota (assets.py, equipment_closures.py, status_report.py).
    LEFT JOIN app.status_taxonomies fst ON fst.id = a.fleet_service_type_id
)"""
```

> `resolved` es el bloque actual, literal (al commit `d59975a9`). Los comentarios largos de `pending` que hoy explican `tiene_archivo`, `a_pedido` y el filtro de estado se conservan: se mueven junto con el código.

(c) `_PENDING_ROWS_SQL` pasa a empezar así: `WITH {_pending_ctes('$10')},` seguido de `carrier_operation_types AS (…)`, igual que hoy. Cambios dentro del `SELECT` final:
- reemplazar el `CASE … END AS urgencia` (las ramas `NO_EXIGIBLE`/`AL_DIA`/`VENCIDO`/`POR_VENCER`/`FALTA`) por la traducción de la definición única:

```sql
    r.document_state,
    -- `urgencia` sigue para los llamadores de hoy (contract en los bloques 2-3):
    -- ya no es otra definición, es el nombre viejo del mismo estado.
    CASE r.document_state
        WHEN 'NOT_REQUIRED' THEN 'NO_EXIGIBLE'
        WHEN 'UP_TO_DATE'   THEN 'AL_DIA'
        WHEN 'OVERDUE'      THEN 'VENCIDO'
        WHEN 'EXPIRING'     THEN 'POR_VENCER'
        ELSE 'FALTA'
    END AS urgencia,
```

- agregar al `WHERE` final, después de `AND ($9::uuid IS NULL OR r.entity_id = $9)`:

```sql
  -- Pendientes (llega con `state`): los estados pedidos y solo lo que está en
  -- alcance, también al ver una empresa. La ficha de una empresa no manda
  -- `state` y no se acota: ahí se ve también lo inactivo (archivar no es ocultar).
  AND ($11::text[] IS NULL OR r.document_state = ANY($11::text[]))
  AND ($12::boolean IS NOT TRUE OR r.in_scope)
```

- reemplazar `ORDER BY c.business_name, r.entity_type, r.subject_name` por:

```sql
ORDER BY
    CASE WHEN $11::text[] IS NULL THEN 0
         ELSE array_position(ARRAY['OVERDUE','EXPIRING','MISSING','NOT_REQUIRED','UP_TO_DATE'], r.document_state) END,
    CASE WHEN $11::text[] IS NOT NULL AND r.document_state IN ('OVERDUE','EXPIRING')
         THEN r.vence_calculado END ASC NULLS LAST,
    c.business_name, r.entity_type, r.subject_name
```

(d) El handler: agregar el parámetro, la traducción y el campo.

```python
# Pendientes (spec 2026-10-11): qué estados trae cada valor de `state`.
STATE_FILTERS: dict[str, tuple[str, ...] | None] = {
    "overdue":  ("OVERDUE",),
    "expiring": ("EXPIRING",),
    "missing":  ("MISSING",),
    "pending":  PENDING_STATES,
    "all":      None,
}
```

En la firma de `list_pending_compliance_records`, después de `estado`:

```python
    state: Optional[Literal["overdue", "expiring", "missing", "pending", "all"]] = Query(
        None,
        description="Pendientes: por estado del documento. Cuando viene, manda "
                    "sobre `estado`, y la cola global se acota a lo activo.",
    ),
```

La llamada a `pool.fetch` pasa a:

```python
    estado_efectivo = "todos" if state else estado
    estados = list(STATE_FILTERS[state]) if state and STATE_FILTERS[state] else None
    rows = await pool.fetch(
        _PENDING_ROWS_SQL,
        carrier_id, category, requirement_code, q or None, operation_type, limit, offset,
        _estado_de_empresa_a_mostrar(carrier_id), entity_id, estado_efectivo,
        estados, state is not None,
    )
```

Y en el dict de cada fila agregar `"document_state": r["document_state"],`.

(e) En `app/schemas/compliance.py`, dentro de `PendingComplianceRow`, debajo de `urgencia`:

```python
    # La definición única (services/vencimientos.document_state_sql). `urgencia`
    # es su nombre viejo y se retira cuando migren los llamadores (bloques 2-3).
    document_state: Literal["NOT_REQUIRED", "UP_TO_DATE", "OVERDUE", "EXPIRING", "MISSING"]
```

En `tests/test_compliance.py`, dentro de `_pending_row`, agregar `"document_state": "MISSING",` (los mocks deben traer el campo nuevo).

- [ ] **Step 4: Run the tests**

Run: `venv/bin/python -m pytest tests/test_pending_documents_integration.py tests/test_compliance.py -q`
Expected: todo en verde.

- [ ] **Step 5: Run the existing Certificación integration tests (compatibility)**

Run: `venv/bin/python -m pytest tests/test_integracion_certificacion.py tests/test_get_del_cierre_no_escribe_integracion.py -q`
Expected: los mismos resultados que en `d59975a9` (todo en verde).

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api/app/routers/compliance.py monitor-app/backend/api/app/schemas/compliance.py monitor-app/backend/api/tests/test_pending_documents_integration.py monitor-app/backend/api/tests/test_compliance.py
git commit -m "feat(certificacion): /pending filtra por estado del documento y acota la cola a lo activo

state=overdue|expiring|missing|pending|all, document_state en cada fila y orden
vencido → por vencer → falta. urgencia pasa a ser el nombre viejo del mismo
estado; estado= sigue igual para los llamadores de hoy.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `GET /pending/summary` (las cifras de la columna izquierda)

**Files:**
- Modify: `monitor-app/backend/api/app/services/vigencia.py` (agregar `regla_base_json_sql`)
- Modify: `monitor-app/backend/api/app/routers/requirements.py` (`SQL_CATALOGO` usa el helper)
- Modify: `monitor-app/backend/api/app/routers/compliance.py` (SQL y handler nuevos, declarados ANTES de cualquier ruta `/{record_id}`)
- Modify: `monitor-app/backend/api/app/schemas/compliance.py` (`PendingSummaryRow`, `PendingSummaryResponse`)
- Test: `tests/test_pending_documents_integration.py`, `tests/test_compliance.py`

**Interfaces:**
- Consumes: `_pending_ctes` y `PENDING_STATES` (Task 2).
- Produces:
  - `regla_base_json_sql(req_alias: str) -> str`.
  - `GET /api/v1/compliance-records/pending/summary?group_by=requirement|carrier` → `{"rows": [{key, label, requirement_code, target_entity, expiration_policy, vigencia, overdue, expiring, missing}]}`. `requirement_code`, `target_entity`, `expiration_policy` y `vigencia` son `null` con `group_by=carrier`.
  - Handler `pending_summary(group_by, pool, _)`.

- [ ] **Step 1: Write the failing tests**

En `tests/test_pending_documents_integration.py`:

```python
from app.routers.compliance import pending_summary


async def test_el_resumen_por_documento_coincide_con_la_lista(conexion_revertida):
    """La promesa central: las tres cifras de la izquierda son la lista de la derecha."""
    conn = conexion_revertida
    hoy = await _hoy(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="REQUIRED")
    for _ in range(2):
        await _registro(conn, req, "CARRIER", await _empresa(conn))
    await _registro(conn, req, "CARRIER", await _empresa(conn), status="APPROVED_MANUAL", vence=hoy + timedelta(days=3))
    await _registro(conn, req, "CARRIER", await _empresa(conn), status="APPROVED_MANUAL", vence=hoy - timedelta(days=3))
    await _registro(conn, req, "CARRIER", await _empresa(conn, estado="INACTIVE"))  # fuera de alcance
    codigo = await _codigo(conn, req)

    resumen = await pending_summary(group_by="requirement", pool=PoolDeUnaConexion(conn), _=None)
    fila = next(r for r in resumen["rows"] if r["requirement_code"] == codigo)

    for state, campo in (("overdue", "overdue"), ("expiring", "expiring"), ("missing", "missing")):
        lista = await _listar(conn, requirement_code=codigo, state=state)
        assert fila[campo] == lista["total"], campo
    assert (fila["overdue"], fila["expiring"], fila["missing"]) == (1, 1, 2)


async def test_el_resumen_por_empresa_cuenta_lo_de_la_empresa_y_su_gente(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    d = await _conductor(conn, empresa)
    req_e = await _requisito(conn, entidad="CARRIER")
    req_d = await _requisito(conn, entidad="DRIVER")
    await _registro(conn, req_e, "CARRIER", empresa)
    await _registro(conn, req_d, "DRIVER", d)

    resumen = await pending_summary(group_by="carrier", pool=PoolDeUnaConexion(conn), _=None)
    fila = next(r for r in resumen["rows"] if r["key"] == empresa)

    assert fila["missing"] == 2 and fila["overdue"] == 0 and fila["vigencia"] is None


async def test_el_resumen_trae_la_regla_del_documento(conexion_revertida):
    conn = conexion_revertida
    req = await _requisito(conn, entidad="CARRIER", politica="CALENDAR_PERIOD")
    await conn.execute(
        "INSERT INTO public.compliance_requirement_rules (requirement_id, shipper_id, frequency_months, "
        "cutoff_day, period_offset_months, warning_days, vigente_desde) "
        "VALUES ($1, NULL, 1, 18, 1, 5, public.hoy_chile() - 30)", req)
    await _registro(conn, req, "CARRIER", await _empresa(conn))

    resumen = await pending_summary(group_by="requirement", pool=PoolDeUnaConexion(conn), _=None)
    fila = next(r for r in resumen["rows"] if r["key"] == req)

    assert fila["expiration_policy"] == "CALENDAR_PERIOD"
    assert fila["vigencia"]["cutoff_day"] == 18 and fila["vigencia"]["frequency_months"] == 1
```

En `tests/test_compliance.py`:

```python
def test_pending_summary_exige_certification_read():
    from tests.conftest import usuario
    pool = AsyncMock()
    client = make_client(pool)
    client.app.dependency_overrides[get_current_user] = lambda: usuario()  # sin roles
    res = client.get("/api/v1/compliance-records/pending/summary?group_by=requirement")
    assert res.status_code == 403


def test_pending_summary_rechaza_un_group_by_desconocido():
    res = make_client(AsyncMock()).get("/api/v1/compliance-records/pending/summary?group_by=cliente")
    assert res.status_code == 422
```

> Si `get_current_user` no está importado en `test_compliance.py`, agregarlo desde `app.auth` (ya se usa en `make_client`).

- [ ] **Step 2: Run them and watch them fail**

Run: `venv/bin/python -m pytest tests/test_pending_documents_integration.py tests/test_compliance.py -q -k "resumen or pending_summary"`
Expected: `ImportError: cannot import name 'pending_summary'` (integración) y 404 en los dos de `test_compliance`.

- [ ] **Step 3: Implement**

(a) En `app/services/vigencia.py`, después de `SQL_REGLA_BASE_VIGENTE`:

```python
def regla_base_json_sql(req_alias: str) -> str:
    """La regla base vigente HOY de un requisito, como JSON con sus
    PARAMETROS. Correlacionada con `req_alias` (debe exponer `id`). La usan el
    catálogo de Configuración y el resumen de Pendientes: una sola consulta."""
    campos = ", ".join(f"'{c}', vg_r.{c}" for c in PARAMETROS)
    return (
        f"(SELECT jsonb_build_object({campos}) "
        f"FROM public.compliance_requirement_rules vg_r "
        f"WHERE vg_r.requirement_id = {req_alias}.id AND vg_r.shipper_id IS NULL "
        f"AND vg_r.vigente_desde <= public.hoy_chile() "
        f"ORDER BY vg_r.vigente_desde DESC LIMIT 1)"
    )
```

En `app/routers/requirements.py`, dentro de `SQL_CATALOGO`, reemplazar el subselect `(SELECT jsonb_build_object(...) ... ORDER BY r.vigente_desde DESC LIMIT 1) AS vigencia,` por `{regla_base_json_sql('req')} AS vigencia,`, e importar `regla_base_json_sql` desde `..services.vigencia`.

(b) En `app/schemas/compliance.py`:

```python
class PendingSummaryRow(BaseModel):
    """Una fila de la columna izquierda de Pendientes: un documento o una
    empresa, con lo que se debe. Las cifras salen de la MISMA definición que
    la lista (`document_state_sql`), con el mismo alcance."""
    key: str
    label: str
    requirement_code: Optional[str] = None
    target_entity: Optional[Literal["CARRIER", "DRIVER", "ASSET"]] = None
    expiration_policy: Optional[PoliticaVencimiento] = None
    # Los parámetros de la regla, con la forma del catálogo; el frontend los
    # dice en palabras con `resumenDeVigencia` (una sola definición).
    vigencia: Optional[dict] = None
    overdue: int
    expiring: int
    missing: int


class PendingSummaryResponse(BaseModel):
    rows: list[PendingSummaryRow]
```

(c) En `app/routers/compliance.py`, debajo de `_PENDING_ROWS_SQL`:

```python
_PENDING_COUNTS = """
    count(*) FILTER (WHERE r.document_state = 'OVERDUE')  AS overdue,
    count(*) FILTER (WHERE r.document_state = 'EXPIRING') AS expiring,
    count(*) FILTER (WHERE r.document_state = 'MISSING')  AS missing"""

# El resumen pide 'falta' (= pendiente_predicate) al filtro viejo: trae solo lo
# pendiente, y document_state lo reparte. Mismo alcance que la cola.
_PENDING_SUMMARY_BY_REQUIREMENT_SQL = f"""
WITH {_pending_ctes('$1')},
agg AS (
    SELECT r.requirement_id, {_PENDING_COUNTS}
    FROM resolved r
    JOIN public.carriers c ON c.id = r.resolved_carrier_id
    WHERE r.in_scope AND r.document_state = ANY($2::text[])
    GROUP BY r.requirement_id
)
SELECT req.id::text AS key, req.name AS label, req.requirement_code, req.target_entity,
       req.expiration_policy, {regla_base_json_sql('req')} AS vigencia,
       agg.overdue, agg.expiring, agg.missing
FROM agg JOIN public.compliance_requirements req ON req.id = agg.requirement_id
ORDER BY agg.overdue DESC, req.name
"""

_PENDING_SUMMARY_BY_CARRIER_SQL = f"""
WITH {_pending_ctes('$1')}
SELECT c.id::text AS key, c.business_name AS label, {_PENDING_COUNTS}
FROM resolved r
JOIN public.carriers c ON c.id = r.resolved_carrier_id
WHERE r.in_scope AND r.document_state = ANY($2::text[])
GROUP BY c.id, c.business_name
ORDER BY 3 DESC, c.business_name
"""
```

Importar `regla_base_json_sql` desde `..services.vigencia`. El handler va declarado **antes** de la primera ruta con `/{record_id}` (junto a `/pending`):

```python
@router.get("/pending/summary", response_model=PendingSummaryResponse)
async def pending_summary(
    group_by: Literal["requirement", "carrier"] = Query(...),
    pool=Depends(get_pool),
    _=Depends(require(Permission.CERTIFICATION_READ)),
):
    """Pendientes: lo que se debe, por documento o por empresa (spec
    2026-10-11). Una consulta agregada; las cifras coinciden con /pending
    con el mismo `state` porque comparten CTE, definición y alcance."""
    sql = (_PENDING_SUMMARY_BY_REQUIREMENT_SQL if group_by == "requirement"
           else _PENDING_SUMMARY_BY_CARRIER_SQL)
    filas = await pool.fetch(sql, "falta", list(PENDING_STATES))
    rows = []
    for f in filas:
        fila = dict(f)
        if fila.get("vigencia") is not None:
            fila["vigencia"] = json.loads(fila["vigencia"])
        rows.append(fila)
    return {"rows": rows}
```

> El ORDER BY `3 DESC` del resumen por empresa es la columna `overdue` (la tercera: key, label, overdue…). Si se agrega una columna antes, hay que actualizarlo.

- [ ] **Step 4: Run the tests**

Run: `venv/bin/python -m pytest tests/test_pending_documents_integration.py tests/test_compliance.py tests/test_requirements.py tests/test_catalogo_en_lote.py -q`
Expected: todo en verde. El catálogo sigue devolviendo `vigencia` igual que antes.

- [ ] **Step 5: Mutation check (coherencia)**

Cambiar temporalmente en `_PENDING_SUMMARY_BY_REQUIREMENT_SQL` `WHERE r.in_scope AND …` por `WHERE r.document_state = ANY($2::text[])` y correr `-k resumen_por_documento`. Expected: FAIL (`missing` cuenta a la empresa inactiva). Revertir y correr de nuevo. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api/app
git add monitor-app/backend/api/tests/test_pending_documents_integration.py monitor-app/backend/api/tests/test_compliance.py
git commit -m "feat(certificacion): GET /pending/summary — lo que se debe por documento o por empresa

Misma CTE, definición y alcance que /pending, así que las cifras coinciden
con la lista. Trae la regla de cada documento (regla_base_json_sql, que
ahora comparte con el catálogo de Configuración).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `match_owner`, función pura

**Files:**
- Modify: `monitor-app/backend/api/app/services/document_matcher.py` (agregar al final)
- Create: `monitor-app/backend/api/tests/test_match_owner.py`

**Interfaces:**
- Produces:
  - `PendingOwner(record_id: str, entity_type: str, label: str, tax_id: str | None, carrier_name: str)`;
  - `OwnerCandidate(record_id: str, confidence: float, reason: str)`, donde `reason` es `"rut"`, `"plate"` o `"name"`;
  - `match_owner(file_name: str, owners: list[PendingOwner]) -> list[OwnerCandidate]` (ordenados por confianza);
  - `classify_owner_match(candidates) -> "matched" | "ambiguous" | "unmatched"`.

- [ ] **Step 1: Write the failing tests**

```python
"""match_owner: de quién es un archivo cuando el documento ya se sabe
(Pendientes, carga en lote). Pura: sin base, con dueños armados a mano."""
from app.services.document_matcher import PendingOwner, classify_owner_match, match_owner

CORDILLERA = PendingOwner("r1", "CARRIER", "Transportes Cordillera SpA", "76222222-1", "Transportes Cordillera SpA")
ANDES = PendingOwner("r2", "CARRIER", "Transportes Andes Ltda", "76333333-7", "Transportes Andes Ltda")
ANDES_CARGO = PendingOwner("r3", "CARRIER", "Andes Cargo SpA", "76444444-2", "Andes Cargo SpA")
ROJAS = PendingOwner("r4", "DRIVER", "Rojas Pérez, Andrés", "12222222-5", "Transportes Cordillera SpA")
TRACTO = PendingOwner("r5", "ASSET", "AAAA11", None, "Transportes Cordillera SpA")


def test_un_rut_valido_en_el_nombre_asigna_a_su_dueno():
    c = match_owner("F30-1 76.222.222-1 septiembre.pdf", [CORDILLERA, ANDES])
    assert (c[0].record_id, c[0].reason) == ("r1", "rut")
    assert classify_owner_match(c) == "matched"


def test_el_rut_de_un_conductor_asigna_al_conductor():
    c = match_owner("licencia 12222222-5.pdf", [ROJAS])
    assert (c[0].record_id, c[0].reason) == ("r4", "rut")


def test_la_patente_asigna_al_equipo():
    c = match_owner("revision tecnica AAAA11.pdf", [TRACTO])
    assert (c[0].record_id, c[0].reason) == ("r5", "plate")


def test_el_nombre_de_la_empresa_asigna_por_similitud():
    c = match_owner("f30-1 transportes cordillera spa.pdf", [CORDILLERA, ANDES])
    assert (c[0].record_id, c[0].reason) == ("r1", "name")
    assert classify_owner_match(c) == "matched"


def test_dos_empresas_parecidas_quedan_por_elegir():
    c = match_owner("f30-1 andes.pdf", [ANDES, ANDES_CARGO])
    assert classify_owner_match(c) == "ambiguous"


def test_sin_rut_ni_nombre_reconocible_queda_sin_asignar():
    c = match_owner("scan_0042.pdf", [CORDILLERA, ANDES])
    assert c == [] and classify_owner_match(c) == "unmatched"


def test_un_rut_con_digito_verificador_invalido_no_asigna():
    assert match_owner("F30-1 76222222-9.pdf", [CORDILLERA]) == []
```

- [ ] **Step 2: Run them and watch them fail**

Run: `venv/bin/python -m pytest tests/test_match_owner.py -q`
Expected: `ImportError: cannot import name 'PendingOwner'`.

- [ ] **Step 3: Implement**

Agregar al final de `app/services/document_matcher.py`:

```python
# ── De quién es un archivo cuando el documento ya se sabe ────────────────────
#
# Pendientes (spec 2026-10-11): se arrastran 15 F30-1 sobre el F30-1. El TIPO
# no hay que adivinarlo, solo el dueño, y el universo es quienes lo DEBEN.
# `match_document` no sirve tal cual: su confianza depende de reconocer el tipo
# por alias (sin alias, un RUT exacto queda en 0.60) y no mira nombres de
# empresa. Esta función reutiliza sus piezas, no las copia.


@dataclass(frozen=True)
class PendingOwner:
    """Quien debe el documento: su registro pendiente y cómo reconocerlo.
    `label` es la razón social, el nombre del conductor o la patente."""
    record_id: str
    entity_type: str  # CARRIER | DRIVER | ASSET
    label: str
    tax_id: str | None
    carrier_name: str


@dataclass(frozen=True)
class OwnerCandidate:
    record_id: str
    confidence: float
    reason: str  # rut | plate | name


def match_owner(file_name: str, owners: list[PendingOwner]) -> list[OwnerCandidate]:
    """Candidatos para un archivo, de mayor a menor confianza. Un identificador
    fuerte (RUT con DV válido, patente) vale 0.95; el nombre, la misma escala
    difusa de la Bandeja (un nombre exacto llega a 0.90)."""
    normalized = normalize_text(file_name)
    ruts = set(extract_ruts(file_name))
    tokens = set(normalized.split())
    found: dict[str, OwnerCandidate] = {}

    def keep(c: OwnerCandidate) -> None:
        if c.record_id not in found or found[c.record_id].confidence < c.confidence:
            found[c.record_id] = c

    for o in owners:
        if o.tax_id and o.tax_id in ruts:
            keep(OwnerCandidate(o.record_id, 0.95, "rut"))
            continue
        if o.entity_type == "ASSET":
            plate = normalize_text(o.label)
            if plate and plate in tokens:
                keep(OwnerCandidate(o.record_id, 0.95, "plate"))
            continue
        ratio = best_name_similarity(normalized, o.label)
        if ratio >= _FUZZY_FLOOR:
            keep(OwnerCandidate(o.record_id, _fuzzy_confidence(ratio), "name"))

    return sorted(found.values(), key=lambda c: c.confidence, reverse=True)


def classify_owner_match(candidates: list[OwnerCandidate]) -> str:
    """matched: un candidato sin rival cercano (la pantalla igual muestra la
    razón y deja cambiarlo). ambiguous: dos a menos de _AMBIGUITY_MARGIN.
    unmatched: ninguno. Nada se guarda sin que una persona confirme el lote."""
    if not candidates:
        return "unmatched"
    top = candidates[0]
    if any(abs(top.confidence - c.confidence) < _AMBIGUITY_MARGIN for c in candidates[1:]):
        return "ambiguous"
    return "matched"
```

- [ ] **Step 4: Run them**

Run: `venv/bin/python -m pytest tests/test_match_owner.py tests/test_document_ingest.py -q`
Expected: todo en verde. La Bandeja no cambia.

> Si `test_dos_empresas_parecidas_quedan_por_elegir` falla porque "andes" se parece mucho más a una de las dos, ajustar el NOMBRE del archivo del test para que sea genuinamente ambiguo (por ejemplo `"f30-1 andes spa.pdf"` contra "Andes Ltda" y "Andes SpA"), **no** el umbral. Registrar el ajuste en el ledger.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/api/app/services/document_matcher.py monitor-app/backend/api/tests/test_match_owner.py
git commit -m "feat(certificacion): match_owner — de quién es un archivo cuando el documento ya se sabe

Pura, reutiliza las piezas del motor de la Bandeja (RUT con DV, patente,
similitud de nombre y umbrales) para la carga en lote de Pendientes.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `POST /pending/match` (propone y no escribe)

**Files:**
- Modify: `monitor-app/backend/api/app/routers/compliance.py` (antes de las rutas `/{record_id}`)
- Modify: `monitor-app/backend/api/app/schemas/compliance.py`
- Test: `tests/test_pending_documents_integration.py`, `tests/test_compliance.py`

**Interfaces:**
- Consumes: `_pending_ctes` (Task 2), `match_owner` y `classify_owner_match` (Task 4).
- Produces:
  - `POST /api/v1/compliance-records/pending/match` con body `{requirement_id: str, file_names: list[str] (1..200)}`.
  - Respuesta: `{files: [{file_name, status, record_id, subject_label, carrier_name, reason, confidence, candidates: [{record_id, subject_label, carrier_name, confidence}]}]}`.
  - Handler `match_pending_files(body, pool, _)`.

- [ ] **Step 1: Write the failing tests**

En `tests/test_pending_documents_integration.py`:

```python
from app.routers.compliance import match_pending_files
from app.schemas.compliance import PendingMatchBody


async def _con_rut(conn, empresa: str) -> str:
    """Le da a la empresa sintética un RUT válido (DV correcto) y lo devuelve."""
    base = int(uuid4().int % 9_000_000) + 70_000_000
    s, m = 0, 2
    for d in reversed(str(base)):
        s += int(d) * m
        m = 2 if m == 7 else m + 1
    dv = {11: "0", 10: "K"}.get(11 - s % 11, str(11 - s % 11))
    rut = f"{base}-{dv}"
    await conn.execute("UPDATE public.carriers SET tax_id = public.canonical_rut($2) WHERE id = $1", empresa, rut)
    return rut


async def test_el_match_propone_solo_entre_quienes_deben_y_no_escribe(conexion_revertida):
    """Review Focus 4: un archivo de alguien al día queda sin asignar."""
    conn = conexion_revertida
    hoy = await _hoy(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="REQUIRED")
    debe = await _empresa(conn)
    al_dia = await _empresa(conn)
    rut_debe, rut_al_dia = await _con_rut(conn, debe), await _con_rut(conn, al_dia)
    await _registro(conn, req, "CARRIER", debe)
    await _registro(conn, req, "CARRIER", al_dia, status="APPROVED_MANUAL", vence=hoy + timedelta(days=400))
    antes = await conn.fetchval("SELECT count(*) FROM public.compliance_records WHERE requirement_id = $1", req)

    res = await match_pending_files(
        PendingMatchBody(requirement_id=req, file_names=[f"doc {rut_debe}.pdf", f"doc {rut_al_dia}.pdf", "scan.pdf"]),
        pool=PoolDeUnaConexion(conn), _=None)

    estados = {f["file_name"]: f["status"] for f in res["files"]}
    assert estados == {f"doc {rut_debe}.pdf": "matched", f"doc {rut_al_dia}.pdf": "unmatched", "scan.pdf": "unmatched"}
    assert await conn.fetchval("SELECT count(*) FROM public.compliance_records WHERE requirement_id = $1", req) == antes


async def test_dos_archivos_para_el_mismo_dueno_quedan_por_elegir(conexion_revertida):
    """Review Focus 3: ninguno se guarda solo."""
    conn = conexion_revertida
    req = await _requisito(conn, entidad="CARRIER")
    empresa = await _empresa(conn)
    rut = await _con_rut(conn, empresa)
    await _registro(conn, req, "CARRIER", empresa)

    res = await match_pending_files(
        PendingMatchBody(requirement_id=req, file_names=[f"a {rut}.pdf", f"b {rut}.pdf"]),
        pool=PoolDeUnaConexion(conn), _=None)

    assert [f["status"] for f in res["files"]] == ["ambiguous", "ambiguous"]
```

En `tests/test_compliance.py`:

```python
def test_pending_match_exige_documents_upload():
    from tests.conftest import usuario
    client = make_client(AsyncMock())
    client.app.dependency_overrides[get_current_user] = lambda: usuario("reader")
    res = client.post("/api/v1/compliance-records/pending/match",
                      json={"requirement_id": "00000000-0000-0000-0000-000000000000", "file_names": ["a.pdf"]})
    assert res.status_code == 403


def test_pending_match_rechaza_mas_de_200_archivos():
    res = make_client(AsyncMock()).post(
        "/api/v1/compliance-records/pending/match",
        json={"requirement_id": "00000000-0000-0000-0000-000000000000",
              "file_names": [f"{i}.pdf" for i in range(201)]})
    assert res.status_code == 422
```

- [ ] **Step 2: Run them and watch them fail**

Run: `venv/bin/python -m pytest tests/test_pending_documents_integration.py tests/test_compliance.py -q -k "match"`
Expected: `ImportError` (integración) y 404 o 405 en `test_compliance`.

- [ ] **Step 3: Implement**

En `app/schemas/compliance.py`:

```python
class PendingMatchBody(BaseModel):
    """Los NOMBRES de los archivos arrastrados sobre un documento. Todavía no
    se sube nada: esto solo propone a quién va cada uno."""
    requirement_id: str
    file_names: list[str] = Field(..., min_length=1, max_length=200)


class PendingMatchCandidate(BaseModel):
    record_id: str
    subject_label: str
    carrier_name: str
    confidence: float


class PendingMatchFile(BaseModel):
    file_name: str
    status: Literal["matched", "ambiguous", "unmatched"]
    record_id: Optional[str] = None
    subject_label: Optional[str] = None
    carrier_name: Optional[str] = None
    reason: Optional[Literal["rut", "plate", "name"]] = None
    confidence: Optional[float] = None
    candidates: list[PendingMatchCandidate] = []


class PendingMatchResponse(BaseModel):
    files: list[PendingMatchFile]
```

(Si `Field` no está importado en ese módulo, agregarlo a `from pydantic import …`.)

En `app/routers/compliance.py` (importar `PendingOwner`, `match_owner`, `classify_owner_match` desde `..services.document_matcher`, y los schemas nuevos):

```python
# Quienes DEBEN un documento, con lo necesario para reconocerlos en un nombre de
# archivo. Mismo alcance y misma definición que la cola.
_PENDING_OWNERS_SQL = f"""
WITH {_pending_ctes('$2')}
SELECT r.id::text AS record_id, r.entity_type,
       COALESCE(r.subject_name, c.business_name) AS label,
       CASE r.entity_type WHEN 'CARRIER' THEN c.tax_id
                          WHEN 'DRIVER'  THEN (SELECT d.tax_id FROM public.drivers d WHERE d.id = r.entity_id)
       END AS tax_id,
       c.business_name AS carrier_name
FROM resolved r
JOIN public.carriers c ON c.id = r.resolved_carrier_id
WHERE r.requirement_id = $1::uuid AND r.in_scope AND r.document_state = ANY($3::text[])
"""


@router.post("/pending/match", response_model=PendingMatchResponse)
async def match_pending_files(
    body: PendingMatchBody,
    pool=Depends(get_pool),
    _=Depends(require(Permission.DOCUMENTS_UPLOAD)),
):
    """Pendientes, carga en lote: propone a quién va cada archivo, SOLO entre
    quienes deben el documento. No escribe nada (spec 2026-10-11, sección 6).
    Dos archivos para el mismo dueño quedan "por elegir": ninguno se guarda solo."""
    filas = await pool.fetch(_PENDING_OWNERS_SQL, body.requirement_id, "falta", list(PENDING_STATES))
    owners = [PendingOwner(f["record_id"], f["entity_type"], f["label"], f["tax_id"], f["carrier_name"])
              for f in filas]
    por_id = {o.record_id: o for o in owners}

    def _cand(c):
        o = por_id[c.record_id]
        return {"record_id": c.record_id, "subject_label": o.label, "carrier_name": o.carrier_name,
                "confidence": c.confidence}

    files = []
    for name in body.file_names:
        cands = match_owner(name, owners)
        status = classify_owner_match(cands)
        top = cands[0] if status == "matched" else None
        files.append({
            "file_name": name, "status": status,
            "record_id": top.record_id if top else None,
            "subject_label": por_id[top.record_id].label if top else None,
            "carrier_name": por_id[top.record_id].carrier_name if top else None,
            "reason": top.reason if top else None,
            "confidence": top.confidence if top else None,
            "candidates": [_cand(c) for c in cands[:5]],
        })

    # Dos archivos para el mismo registro: los dos vuelven a "por elegir".
    usados = Counter(f["record_id"] for f in files if f["status"] == "matched")
    for f in files:
        if f["status"] == "matched" and usados[f["record_id"]] > 1:
            f.update(status="ambiguous", record_id=None, subject_label=None,
                     carrier_name=None, reason=None, confidence=None)
    return {"files": files}
```

(`Counter` ya está importado en `compliance.py`, línea 16.)

- [ ] **Step 4: Run them**

Run: `venv/bin/python -m pytest tests/test_pending_documents_integration.py tests/test_compliance.py tests/test_match_owner.py -q`
Expected: todo en verde.

- [ ] **Step 5: Run the route-permission guard**

Run: `venv/bin/python -m pytest tests/test_toda_ruta_declara_permiso.py -q`
Expected: verde. Las dos rutas nuevas declaran `require(...)`.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api/app monitor-app/backend/api/tests/test_pending_documents_integration.py monitor-app/backend/api/tests/test_compliance.py
git commit -m "feat(certificacion): POST /pending/match — a quién va cada archivo del lote, sin escribir

Solo entre quienes deben el documento (mismo alcance que la cola). Dos
archivos para el mismo dueño quedan por elegir. documents.upload, máx. 200.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `SegmentedControl` a `components/ui`

**Files:**
- Create: `monitor-app/frontend/components/ui/SegmentedControl.tsx`
- Create: `monitor-app/frontend/components/ui/SegmentedControl.test.tsx`
- Modify: `monitor-app/frontend/components/dashboard/TripNotesFeed.tsx` (borrar la definición local `function SegmentedControl…` e importar la de `ui`)

**Interfaces:**
- Produces: `SegmentedControl<T extends string>({ label, options: {id: T; label: string; Icon?: LucideIcon; badge?: string}[], value: T | null, onChange: (id: T) => void })`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SegmentedControl } from './SegmentedControl'

const OPCIONES = [
  { id: 'overdue', label: 'Vencidos', badge: '9' },
  { id: 'expiring', label: 'Por vencer', badge: '4' },
] as const

describe('SegmentedControl', () => {
  it('es un grupo con nombre y marca la opción elegida', () => {
    render(<SegmentedControl label="Estado" options={[...OPCIONES]} value="overdue" onChange={vi.fn()} />)
    expect(screen.getByRole('group', { name: 'Estado' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Vencidos/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Por vencer/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('avisa la opción tocada', () => {
    const onChange = vi.fn()
    render(<SegmentedControl label="Estado" options={[...OPCIONES]} value="overdue" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Por vencer/ }))
    expect(onChange).toHaveBeenCalledWith('expiring')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd monitor-app/frontend && npx vitest run components/ui/SegmentedControl.test.tsx`
Expected: FAIL, el módulo no existe.

- [ ] **Step 3: Implement**

`components/ui/SegmentedControl.tsx`:

```tsx
import type { LucideIcon } from 'lucide-react'

export type SegmentedOption<T extends string> = {
  id: T
  label: string
  Icon?: LucideIcon
  /** Un número que acompaña a la opción, p. ej. cuántos hay. */
  badge?: string
}

/** Opciones del mismo grupo, una sola marcada (o ninguna). Lo usan la
 *  Bitácora del viaje (tipo de nota, filtro, Feed/Documentos) y Pendientes
 *  (por documento o empresa; vencidos, por vencer, faltan). */
export function SegmentedControl<T extends string>({
  label, options, value, onChange,
}: {
  label:    string
  options:  SegmentedOption<T>[]
  value:    T | null
  onChange: (id: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex w-fit max-w-full flex-wrap overflow-hidden rounded-md border border-border bg-white">
      {options.map(o => {
        const on = value === o.id
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            title={o.label}
            aria-pressed={on}
            className={`flex items-center gap-1.5 border-r border-border px-2.5 py-1 text-etiqueta transition-colors last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${
              on ? 'bg-accion/10 font-semibold text-accion' : 'text-informativo hover:text-text-primary'
            }`}
          >
            {o.Icon && <o.Icon size={12} aria-hidden />}
            {o.label}
            {o.badge && <span className="tabular-nums">{o.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}
```

En `TripNotesFeed.tsx`: borrar el bloque `/** Un control segmentado… */ function SegmentedControl<T…>(…) {…}` y agregar `import { SegmentedControl } from '@/components/ui/SegmentedControl'`. Las opciones `NOTE_TYPES` ya tienen `{id, label, Icon}`, y la de Documentos tiene `badge`.

- [ ] **Step 4: Run them**

Run: `npx vitest run components/ui/SegmentedControl.test.tsx components/dashboard/TripDetailView.test.tsx && npx tsc --noEmit`
Expected: todo en verde.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/ui/SegmentedControl.tsx monitor-app/frontend/components/ui/SegmentedControl.test.tsx monitor-app/frontend/components/dashboard/TripNotesFeed.tsx
git commit -m "refactor(ui): SegmentedControl pasa a components/ui (lo usan la Bitácora y Pendientes)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Tipos, cliente de API y claves de datos

**Files:**
- Modify: `monitor-app/frontend/lib/types.ts` (junto a `PendingComplianceRow`, alrededor de las líneas 799–840)
- Modify: `monitor-app/frontend/lib/api/compliance.ts` (`listPending` y dos métodos nuevos)
- Modify: `monitor-app/frontend/lib/queries/certificacion.ts`
- Test: `monitor-app/frontend/lib/api/compliance.test.ts` (si no existe, crearlo)

**Interfaces:**
- Produces:
  - `type DocumentState = 'NOT_REQUIRED' | 'UP_TO_DATE' | 'OVERDUE' | 'EXPIRING' | 'MISSING'`;
  - `type PendingState = 'overdue' | 'expiring' | 'missing' | 'pending' | 'all'`;
  - `PendingComplianceRow.document_state: DocumentState`;
  - `PendingSummaryRow`, `PendingSummaryResponse`, `PendingMatchFile`, `PendingMatchResponse`;
  - `complianceApi.listPending({ state?: PendingState, … })`;
  - `complianceApi.pendingSummary(groupBy: 'requirement' | 'carrier')`;
  - `complianceApi.matchPendingFiles(requirementId: string, fileNames: string[])`;
  - `clavesCertificacion.colaPendientes(state, requirementCode?, carrierId?)` y `clavesCertificacion.resumenPendientes(groupBy)`;
  - raíz `['compliance-pending-summary']` y `['entity-summary']` en `RAICES_DE_CERTIFICACION`.

- [ ] **Step 1: Write the failing test**

`lib/api/compliance.test.ts` (agregar, o crear con los imports):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn().mockResolvedValue({}) }))
import { apiFetch } from '@/lib/api/client'
import { complianceApi } from './compliance'

beforeEach(() => { vi.mocked(apiFetch).mockClear() })

describe('Pendientes en el cliente de API', () => {
  it('listPending manda state y el documento', async () => {
    await complianceApi.listPending({ state: 'overdue', requirementCode: 'F30_1', limit: 200 })
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/compliance-records/pending?requirement_code=F30_1&state=overdue&limit=200')
  })

  it('pendingSummary pide el resumen agrupado', async () => {
    await complianceApi.pendingSummary('carrier')
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/compliance-records/pending/summary?group_by=carrier')
  })

  it('matchPendingFiles manda solo los nombres', async () => {
    await complianceApi.matchPendingFiles('req-1', ['a.pdf'])
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/compliance-records/pending/match', {
      method: 'POST', body: JSON.stringify({ requirement_id: 'req-1', file_names: ['a.pdf'] }),
    })
  })
})
```

> Antes de escribirlo, verificar el path real de `apiFetch` con `grep -n "import.*apiFetch" lib/api/compliance.ts` y ajustar el `vi.mock`. Revisar también cómo arman el body las otras llamadas POST del archivo (`body: JSON.stringify(...)` con o sin headers) y copiar esa forma exacta en la aserción.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run lib/api/compliance.test.ts`
Expected: FAIL, `pendingSummary is not a function`.

- [ ] **Step 3: Implement**

En `lib/types.ts`:

```ts
/** El estado de un documento: la definición única del backend
 *  (`vencimientos.document_state_sql`). */
export type DocumentState = 'NOT_REQUIRED' | 'UP_TO_DATE' | 'OVERDUE' | 'EXPIRING' | 'MISSING'
/** Qué trae Pendientes: un estado o los tres que se deben juntos. */
export type PendingState = 'overdue' | 'expiring' | 'missing' | 'pending' | 'all'

export type PendingSummaryRow = {
  key: string
  label: string
  requirement_code: string | null
  target_entity: 'CARRIER' | 'DRIVER' | 'ASSET' | null
  expiration_policy: PoliticaVencimiento | null
  vigencia: ReglaDeVigencia | null
  overdue: number
  expiring: number
  missing: number
}
export type PendingSummaryResponse = { rows: PendingSummaryRow[] }

export type PendingMatchCandidate = { record_id: string; subject_label: string; carrier_name: string; confidence: number }
export type PendingMatchFile = {
  file_name: string
  status: 'matched' | 'ambiguous' | 'unmatched'
  record_id: string | null
  subject_label: string | null
  carrier_name: string | null
  reason: 'rut' | 'plate' | 'name' | null
  confidence: number | null
  candidates: PendingMatchCandidate[]
}
export type PendingMatchResponse = { files: PendingMatchFile[] }
```

Dentro de `PendingComplianceRow`, agregar `document_state: DocumentState`. En `ListPendingParams`, agregar `state?: PendingState`.

En `lib/api/compliance.ts`, dentro de `listPending`, después de la línea de `estado`:

```ts
    if (params.state)            qs.set('state', params.state)
```

Y antes del cierre del objeto:

```ts
  /** Pendientes: lo que se debe, por documento o por empresa. */
  pendingSummary: (groupBy: 'requirement' | 'carrier') =>
    apiFetch<PendingSummaryResponse>(`/api/v1/compliance-records/pending/summary?group_by=${groupBy}`),

  /** Carga en lote: a quién va cada archivo. Solo los NOMBRES; no escribe. */
  matchPendingFiles: (requirementId: string, fileNames: string[]) =>
    apiFetch<PendingMatchResponse>('/api/v1/compliance-records/pending/match', {
      method: 'POST', body: JSON.stringify({ requirement_id: requirementId, file_names: fileNames }),
    }),
```

> El orden de los parámetros en el query string debe coincidir con el test: `requirement_code` se agrega antes que `state` porque así está en la función. Si el test falla solo por orden, se ajusta el test, no la función.

En `lib/queries/certificacion.ts`, dentro de `clavesCertificacion`:

```ts
  /** La cola de Pendientes. Vive bajo la raíz de `pendientes`
   *  (`['compliance-pending']`), así que invalidar esa raíz la alcanza. */
  colaPendientes: (state: string, requirementCode?: string, carrierId?: string) =>
    ['compliance-pending', 'queue', state, requirementCode ?? null, carrierId ?? null] as const,
  /** Las cifras de la columna izquierda de Pendientes. */
  resumenPendientes: (groupBy: string) => ['compliance-pending-summary', groupBy] as const,
```

Y en `RAICES_DE_CERTIFICACION` agregar `['compliance-pending-summary']` y `['entity-summary']`. La segunda es la vista rápida del Cierre: subir un documento cambia lo que muestra.

- [ ] **Step 4: Run them**

Run: `npx vitest run lib/api/compliance.test.ts lib/queries && npx tsc --noEmit`
Expected: verde. Si `tsc` marca fixtures de tests que construyen `PendingComplianceRow` sin `document_state`, agregar `document_state: 'MISSING'` en esas fixtures (`grep -rln "carrier_tax_id: '1-9'" components lib app`).

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/lib monitor-app/frontend/components monitor-app/frontend/app
git commit -m "feat(certificacion): tipos, cliente y claves de datos de Pendientes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `RenglonPendiente` con la variante `title`

**Files:**
- Modify: `monitor-app/frontend/components/compliance/RenglonPendiente.tsx` (Props, alrededor de la línea 11; render del nombre, alrededor de la línea 111)
- Test: `monitor-app/frontend/components/compliance/RenglonPendiente.test.tsx`

**Interfaces:**
- Produces: `RenglonPendiente` acepta `title?: ReactNode`. Por defecto sigue mostrando `fila.document_name`.

- [ ] **Step 1: Write the failing test**

Agregar a `RenglonPendiente.test.tsx`, usando la fixture existente del archivo (la `fila` base que ya usan los otros tests):

```tsx
  it('con title muestra a quien debe el documento en vez del nombre del documento', () => {
    render(
      <RenglonPendiente
        fila={fila()}
        puedeEditar
        onSubir={vi.fn()}
        title={<span>Transportes Cordillera SpA</span>}
      />,
    )
    expect(screen.getByText('Transportes Cordillera SpA')).toBeInTheDocument()
    expect(screen.queryByText(fila().document_name)).not.toBeInTheDocument()
  })
```

> Revisar al inicio del archivo cómo se llama el constructor de la fixture (`fila(...)` o `pendiente(...)`) y usar ese nombre.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run components/compliance/RenglonPendiente.test.tsx`
Expected: FAIL, se ve el `document_name`.

- [ ] **Step 3: Implement**

En `Props`:

```tsx
  /** Qué nombra la fila. Por defecto el documento (la ficha de una empresa ya
   *  sabe de quién es); Pendientes ya sabe el documento y nombra a quien lo
   *  debe. Una variante, no un renglón hermano. */
  title?:      ReactNode
```

En la firma, agregar `title,` a la desestructuración. En el render, reemplazar `{fila.document_name}` por `{title ?? fila.document_name}`. Importar `type ReactNode` desde `react` si no está.

- [ ] **Step 4: Run them**

Run: `npx vitest run components/compliance && npx tsc --noEmit`
Expected: verde.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/compliance/RenglonPendiente.tsx monitor-app/frontend/components/compliance/RenglonPendiente.test.tsx
git commit -m "feat(certificacion): RenglonPendiente puede nombrar a quien debe el documento (variante title)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: La pantalla Pendientes (lista y detalle, URL, estados, menú)

**Files:**
- Create: `monitor-app/frontend/components/compliance/pending/PendingSummaryList.tsx` (+ `.test.tsx`)
- Create: `monitor-app/frontend/components/compliance/pending/PendingHoldersPanel.tsx` (+ `.test.tsx`)
- Create: `monitor-app/frontend/app/dashboard/compliance/pending/page.tsx` (+ `page.test.tsx`)
- Modify: `monitor-app/frontend/components/dashboard/Sidebar.tsx:64-67`
- Modify: `monitor-app/frontend/lib/rutas.test.ts:29` (agregar `'pending'` a la lista de segmentos)

**Interfaces:**
- Consumes: `complianceApi.pendingSummary`, `listPending({state})`, `clavesCertificacion.*`, `invalidarCertificacion`, `useSubirDocumento`, `RenglonPendiente({title})`, `SegmentedControl`, `StatusChip`, `Estado`, `EncabezadoDePagina`, `resumenDeVigencia`, `vigenciaDe`, `usePermiso`.
- Produces:
  - `PendingSummaryList({ rows, groupBy, selectedKey, onSelect })`;
  - `PendingHoldersPanel({ groupBy, selected: PendingSummaryRow, state, onStateChange, canUpload })`.

- [ ] **Step 1: Write the failing tests**

`components/compliance/pending/PendingSummaryList.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PendingSummaryList } from './PendingSummaryList'
import type { PendingSummaryRow } from '@/lib/types'

const F30: PendingSummaryRow = {
  key: 'req-f30', label: 'F30-1', requirement_code: 'F30_1', target_entity: 'CARRIER',
  expiration_policy: 'CALENDAR_PERIOD',
  vigencia: { frequency_months: 1, cutoff_day: 18, period_offset_months: 1, warning_days: 5 } as never,
  overdue: 9, expiring: 4, missing: 21,
}
const LIC: PendingSummaryRow = { ...F30, key: 'req-lic', label: 'Licencia de Conducir', requirement_code: 'LIC',
  target_entity: 'DRIVER', expiration_policy: 'REQUIRED', vigencia: null, overdue: 4, expiring: 3, missing: 68 }

describe('PendingSummaryList', () => {
  it('muestra cada documento con su regla y sus tres cifras', () => {
    render(<PendingSummaryList rows={[F30]} groupBy="requirement" selectedKey="req-f30" onSelect={vi.fn()} />)
    const opcion = screen.getByRole('option', { name: /F30-1/ })
    expect(opcion).toHaveAttribute('aria-selected', 'true')
    expect(opcion).toHaveTextContent('Mensual · tope día 18')
    expect(opcion).toHaveTextContent('9')
    expect(opcion).toHaveTextContent('4')
    expect(opcion).toHaveTextContent('21')
  })

  it('se navega con las flechas', () => {
    const onSelect = vi.fn()
    render(<PendingSummaryList rows={[F30, LIC]} groupBy="requirement" selectedKey="req-f30" onSelect={onSelect} />)
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
    expect(onSelect).toHaveBeenCalledWith('req-lic')
  })
})
```

`components/compliance/pending/PendingHoldersPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PendingHoldersPanel } from './PendingHoldersPanel'
import type { PendingComplianceRow, PendingSummaryRow } from '@/lib/types'

vi.mock('@/lib/api/compliance', () => ({ complianceApi: { listPending: vi.fn(), uploadFile: vi.fn() } }))
import { complianceApi } from '@/lib/api/compliance'

const F30: PendingSummaryRow = { key: 'req-f30', label: 'F30-1', requirement_code: 'F30_1', target_entity: 'CARRIER',
  expiration_policy: 'CALENDAR_PERIOD', vigencia: null, overdue: 1, expiring: 4, missing: 21 }

function fila(over: Partial<PendingComplianceRow> = {}): PendingComplianceRow {
  return {
    id: 'p1', carrier_id: 'c1', carrier_name: 'Transportes Cordillera SpA', carrier_tax_id: '76222222-1',
    carrier_operation_types: [], certification_type: 'BASICA', category: 'EMPRESA', entity_type: 'CARRIER',
    entity_id: 'c1', subject_name: null, requirement_id: 'req-f30', requirement_code: 'F30_1', document_name: 'F30-1',
    status: 'APPROVED_MANUAL', expiration_date: null, tiene_archivo: true, urgencia: 'VENCIDO',
    document_state: 'OVERDUE', expiration_policy: 'CALENDAR_PERIOD', vence_el: '2026-09-18', ...over,
  } as PendingComplianceRow
}

function montar(props: Partial<Parameters<typeof PendingHoldersPanel>[0]> = {}) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PendingHoldersPanel groupBy="requirement" selected={F30} state="overdue" onStateChange={vi.fn()} canUpload {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('PendingHoldersPanel', () => {
  it('lista quién debe el documento, con su empresa y el estado en palabras', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 1, rows: [fila()] })
    montar()
    expect(await screen.findByText('Transportes Cordillera SpA')).toBeInTheDocument()
    expect(complianceApi.listPending).toHaveBeenCalledWith(expect.objectContaining({ state: 'overdue', requirementCode: 'F30_1' }))
  })

  it('con el filtro vacío dice qué hay en los otros y enlaza', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 0, rows: [] })
    montar({ selected: { ...F30, overdue: 0 } })
    expect(await screen.findByText('No hay F30-1 vencidos')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '4 por vencer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '21 que faltan' })).toBeInTheDocument()
  })

  it('si no se pudo cargar lo dice y ofrece reintentar', async () => {
    vi.mocked(complianceApi.listPending).mockRejectedValue(new Error('500'))
    montar()
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar lo pendiente.')
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('sin permiso de subir no ofrece la zona de arrastre', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 1, rows: [fila()] })
    montar({ canUpload: false })
    await screen.findByText('Transportes Cordillera SpA')
    expect(screen.queryByText(/Arrastra varios/)).not.toBeInTheDocument()
  })
})
```

`app/dashboard/compliance/pending/page.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/dashboard/compliance/pending',
}))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => true }))
vi.mock('@/lib/api/compliance', () => ({ complianceApi: {
  pendingSummary: vi.fn(),
  listPending: vi.fn().mockResolvedValue({ total: 0, rows: [] }),
} }))
import { complianceApi } from '@/lib/api/compliance'
import PendingDocumentsPage from './page'

function montar() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PendingDocumentsPage />
    </QueryClientProvider>,
  )
}

describe('Pendientes', () => {
  it('mientras carga no muestra ninguna cifra', () => {
    vi.mocked(complianceApi.pendingSummary).mockReturnValue(new Promise(() => {}))
    montar()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument()
  })

  it('sin nada pendiente dice que está todo al día', async () => {
    vi.mocked(complianceApi.pendingSummary).mockResolvedValue({ rows: [] })
    montar()
    expect(await screen.findByText('Todo al día')).toBeInTheDocument()
  })

  it('pide el resumen por documento por defecto', async () => {
    vi.mocked(complianceApi.pendingSummary).mockResolvedValue({ rows: [] })
    montar()
    await screen.findByText('Todo al día')
    expect(complianceApi.pendingSummary).toHaveBeenCalledWith('requirement')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run components/compliance/pending app/dashboard/compliance/pending`
Expected: FAIL, los módulos no existen.

- [ ] **Step 3: Implement**

`components/compliance/pending/PendingSummaryList.tsx`:

```tsx
'use client'

import type { KeyboardEvent } from 'react'
import { StatusChip } from '@/components/ui/StatusChip'
import { resumenDeVigencia, vigenciaDe } from '@/lib/vigencia'
import type { PendingSummaryRow } from '@/lib/types'

/** La columna izquierda de Pendientes: los documentos (o las empresas) con lo
 *  que se debe de cada uno. Es una lista de selección (listbox): ↑ ↓ cambian
 *  la elegida, como una bandeja de correo. */
export function PendingSummaryList({ rows, groupBy, selectedKey, onSelect }: {
  rows: PendingSummaryRow[]
  groupBy: 'requirement' | 'carrier'
  selectedKey: string | null
  onSelect: (key: string) => void
}) {
  function onKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = rows.findIndex(r => r.key === selectedKey)
    const j = e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1)
    if (rows[j]) onSelect(rows[j].key)
  }

  return (
    <ul role="listbox" aria-label={groupBy === 'requirement' ? 'Documentos' : 'Empresas'} tabIndex={0}
        onKeyDown={onKeyDown}
        className="divide-y divide-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40">
      {rows.map(r => {
        const on = r.key === selectedKey
        const regla = r.expiration_policy
          ? resumenDeVigencia(vigenciaDe({ expiration_policy: r.expiration_policy, vigencia: r.vigencia }))
          : null
        return (
          <li key={r.key} role="option" aria-selected={on} onClick={() => onSelect(r.key)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-2.5 ${on ? 'bg-accion/5 shadow-[inset_3px_0_0_var(--accion)]' : 'hover:bg-bg-main'}`}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-dato text-text-primary">{r.label}</span>
              {regla && <span className="block truncate text-etiqueta text-informativo">{regla}</span>}
            </span>
            <span className="flex shrink-0 gap-1" aria-label={`${r.overdue} vencidos, ${r.expiring} por vencer, ${r.missing} faltan`}>
              <StatusChip tone="urgent">{r.overdue}</StatusChip>
              <StatusChip tone="warning">{r.expiring}</StatusChip>
              <StatusChip tone="neutral">{r.missing}</StatusChip>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
```

> Si `var(--accion)` no existe como variable CSS en `app/globals.css`, usar la que mapea al token `accion` (`grep -n "\-\-accion" app/globals.css`).

`components/compliance/pending/PendingHoldersPanel.tsx`:

```tsx
'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { complianceApi } from '@/lib/api/compliance'
import { clavesCertificacion, invalidarCertificacion } from '@/lib/queries/certificacion'
import { useSubirDocumento } from '@/hooks/useSubirDocumento'
import { RenglonPendiente } from '@/components/compliance/RenglonPendiente'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Estado } from '@/components/ui/Estado'
import { BulkUploadReview } from './BulkUploadReview'
import type { PendingComplianceRow, PendingState, PendingSummaryRow } from '@/lib/types'

type Filtro = Exclude<PendingState, 'pending'>
const NOMBRE: Record<'overdue' | 'expiring' | 'missing', string> = {
  overdue: 'vencidos', expiring: 'por vencer', missing: 'que faltan',
}

/** La columna derecha: quién debe el documento elegido (o qué debe la empresa
 *  elegida), con los filtros por estado y la carga en la fila o en lote. */
export function PendingHoldersPanel({ groupBy, selected, state, onStateChange, canUpload }: {
  groupBy: 'requirement' | 'carrier'
  selected: PendingSummaryRow
  state: Filtro
  onStateChange: (s: Filtro) => void
  canUpload: boolean
}) {
  const qc = useQueryClient()
  const subirDocumento = useSubirDocumento()
  const requirementCode = groupBy === 'requirement' ? selected.requirement_code ?? undefined : undefined
  const carrierId = groupBy === 'carrier' ? selected.key : undefined

  const lista = useQuery({
    queryKey: clavesCertificacion.colaPendientes(state, requirementCode, carrierId),
    queryFn: () => complianceApi.listPending({ state, requirementCode, carrierId, limit: 500 }),
  })

  async function subir(fila: PendingComplianceRow, archivo: File, datos?: Parameters<typeof subirDocumento>[2]) {
    await subirDocumento(fila.id, archivo, datos)
    await invalidarCertificacion(qc)
  }

  const cifras = { overdue: selected.overdue, expiring: selected.expiring, missing: selected.missing }
  const filas = lista.data?.rows ?? []

  return (
    <section aria-label={selected.label} className="min-w-0 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-lectura font-semibold text-text-primary">{selected.label}</h2>
        <span className="ml-auto">
          <SegmentedControl<Filtro>
            label="Estado"
            value={state}
            onChange={onStateChange}
            options={[
              { id: 'overdue', label: 'Vencidos', badge: String(cifras.overdue) },
              { id: 'expiring', label: 'Por vencer', badge: String(cifras.expiring) },
              { id: 'missing', label: 'Faltan', badge: String(cifras.missing) },
              { id: 'all', label: 'Todos' },
            ]}
          />
        </span>
      </div>

      {canUpload && groupBy === 'requirement' && (
        <BulkUploadReview requirement={selected} />
      )}

      {lista.isPending && <Estado tipo="cargando" />}

      {lista.isError && (
        <Estado tipo="error" titulo="No se pudo cargar lo pendiente." detalle="Lo que ya estaba cargado no se perdió.">
          <button type="button" onClick={() => lista.refetch()}
                  className="rounded-md border border-border bg-white px-3 py-1.5 text-dato font-semibold text-text-primary hover:bg-bg-main">
            Reintentar
          </button>
        </Estado>
      )}

      {lista.isSuccess && filas.length === 0 && state !== 'all' && (
        <Estado tipo="vacio" titulo={`No hay ${selected.label} ${NOMBRE[state]}`}>
          {(['overdue', 'expiring', 'missing'] as const)
            .filter(s => s !== state && cifras[s] > 0)
            .map(s => (
              <button key={s} type="button" onClick={() => onStateChange(s)}
                      className="text-dato font-semibold text-accion hover:underline">
                {`${cifras[s]} ${NOMBRE[s]}`}
              </button>
            ))}
        </Estado>
      )}

      {lista.isSuccess && filas.length > 0 && (
        <div className="divide-y divide-border rounded-md border border-border">
          {filas.map(f => (
            <RenglonPendiente
              key={f.id}
              fila={f}
              puedeEditar={canUpload}
              onSubir={subir}
              title={groupBy === 'requirement'
                ? <>{f.subject_name ?? f.carrier_name}{f.subject_name && <span className="text-informativo"> · {f.carrier_name}</span>}</>
                : <>{f.document_name}{f.subject_name && <span className="text-informativo"> · {f.subject_name}</span>}</>}
            />
          ))}
        </div>
      )}
    </section>
  )
}
```

> `BulkUploadReview` se crea en la Task 10. Para que esta tarea compile antes, crear un stub `components/compliance/pending/BulkUploadReview.tsx` con `export function BulkUploadReview(_: { requirement: PendingSummaryRow }) { return null }`, y reemplazarlo en la Task 10. En los tests de esta tarea, mockearlo: `vi.mock('./BulkUploadReview', () => ({ BulkUploadReview: () => null }))`.
>
> Verificar la firma real de `useSubirDocumento` (`grep -n "export function useSubirDocumento" -A8 hooks/useSubirDocumento.ts`). Si ya invalida la caché, no llamar `invalidarCertificacion` dos veces: dejar solo `await subirDocumento(...)`. En ese caso, igual hay que confirmar que su invalidación incluye `RAICES_DE_CERTIFICACION`, que en la Task 7 ganó `compliance-pending-summary` y `entity-summary`.

`app/dashboard/compliance/pending/page.tsx`:

```tsx
'use client'

import { Suspense } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { complianceApi } from '@/lib/api/compliance'
import { clavesCertificacion } from '@/lib/queries/certificacion'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Estado } from '@/components/ui/Estado'
import { PendingSummaryList } from '@/components/compliance/pending/PendingSummaryList'
import { PendingHoldersPanel } from '@/components/compliance/pending/PendingHoldersPanel'

type GroupBy = 'requirement' | 'carrier'
type Filtro = 'overdue' | 'expiring' | 'missing' | 'all'
const FILTROS: readonly Filtro[] = ['overdue', 'expiring', 'missing', 'all']

/** Certificación › Pendientes (spec 2026-10-11): los documentos que se deben,
 *  por documento o por empresa. Lo elegido vive en la URL, así que se comparte
 *  y "Volver" funciona. */
function Pending() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const canUpload = usePermiso('documents.upload')

  const groupBy: GroupBy = params.get('by') === 'carrier' ? 'carrier' : 'requirement'
  const state: Filtro = FILTROS.includes(params.get('state') as Filtro) ? (params.get('state') as Filtro) : 'overdue'

  const resumen = useQuery({
    queryKey: clavesCertificacion.resumenPendientes(groupBy),
    queryFn: () => complianceApi.pendingSummary(groupBy),
  })
  const rows = resumen.data?.rows ?? []
  const elegidoKey = params.get('key') ?? rows[0]?.key ?? null
  const elegido = rows.find(r => r.key === elegidoKey) ?? null

  function cambiar(next: Record<string, string | null>) {
    const qs = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) v === null ? qs.delete(k) : qs.set(k, v)
    router.replace(`${pathname}?${qs}`, { scroll: false })
  }

  return (
    <div className="space-y-3 p-4 md:p-6">
      <EncabezadoDePagina titulo="Pendientes" bajada="Qué documentos se deben, quién los debe, y cargarlos ahí mismo.">
        <SegmentedControl<GroupBy>
          label="Ver por"
          value={groupBy}
          onChange={by => cambiar({ by, key: null })}
          options={[{ id: 'requirement', label: 'Documento' }, { id: 'carrier', label: 'Empresa' }]}
        />
      </EncabezadoDePagina>
      <p className="text-etiqueta text-informativo">Solo empresas, conductores y equipos activos.</p>

      {resumen.isPending && <Estado tipo="cargando" />}
      {resumen.isError && (
        <Estado tipo="error" titulo="No se pudo cargar lo pendiente." detalle="Lo que ya estaba cargado no se perdió.">
          <button type="button" onClick={() => resumen.refetch()}
                  className="rounded-md border border-border bg-white px-3 py-1.5 text-dato font-semibold text-text-primary hover:bg-bg-main">
            Reintentar
          </button>
        </Estado>
      )}
      {resumen.isSuccess && rows.length === 0 && (
        <Estado tipo="vacio" titulo="Todo al día" detalle="Ninguna empresa, conductor ni equipo activo debe documentos." />
      )}
      {resumen.isSuccess && rows.length > 0 && (
        <div className="grid overflow-hidden rounded-lg border border-border bg-white md:grid-cols-[300px_1fr]">
          <div className={`border-border md:border-r ${elegido && params.get('key') ? 'hidden md:block' : ''}`}>
            <PendingSummaryList rows={rows} groupBy={groupBy} selectedKey={elegidoKey}
                                onSelect={key => cambiar({ key })} />
          </div>
          {elegido && (
            <div className={params.get('key') ? '' : 'hidden md:block'}>
              <button type="button" onClick={() => cambiar({ key: null })}
                      className="m-3 text-dato font-semibold text-accion md:hidden">
                ← Volver
              </button>
              <PendingHoldersPanel groupBy={groupBy} selected={elegido} state={state}
                                   onStateChange={s => cambiar({ state: s })} canUpload={canUpload} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function PendingDocumentsPage() {
  return <Suspense fallback={null}><Pending /></Suspense>
}
```

> Revisar que `EncabezadoDePagina` acepte `children` (en la línea 20 de su archivo los tiene). Revisar también que `Estado tipo="cargando"` tenga `role="status"`, que el test de la página espera (lo tiene, en `Estado.tsx:40`).

Sidebar: en `components/dashboard/Sidebar.tsx`, dentro de `items` de Certificación, después de "Sin clasificar":

```tsx
      { href: '/dashboard/compliance/pending', label: 'Pendientes' },
```

En `lib/rutas.test.ts:29`, agregar `'pending'` a la lista de segmentos en inglés, respetando el orden alfabético que tiene la lista.

- [ ] **Step 4: Run them**

Run: `npx vitest run components/compliance app/dashboard/compliance components/dashboard/Sidebar.test.tsx lib/rutas.test.ts lib/ui lib/copy && npx tsc --noEmit`
Expected: todo en verde, y los trinquetes sin subir.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/compliance/pending monitor-app/frontend/app/dashboard/compliance/pending monitor-app/frontend/components/dashboard/Sidebar.tsx monitor-app/frontend/lib/rutas.test.ts
git commit -m "feat(certificacion): Pendientes — lista y detalle por documento o empresa, con sus estados

Certificación › Pendientes: la izquierda los documentos (o empresas) con
vencidos/por vencer/faltan; la derecha quién lo debe, con filtros y carga en
la fila. Lo elegido vive en la URL. Cargando sin cifras, vacío, filtro vacío
con enlaces, error con reintentar, sin permiso sin Subir.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Carga en lote (`usePendingBulkUpload` + `BulkUploadReview`)

**Files:**
- Create: `monitor-app/frontend/components/compliance/pending/usePendingBulkUpload.ts` (+ `.test.ts`)
- Replace: `monitor-app/frontend/components/compliance/pending/BulkUploadReview.tsx` (+ `.test.tsx`; antes era el stub de la Task 9)

**Interfaces:**
- Consumes: `complianceApi.matchPendingFiles`, `useSubirDocumento`, `invalidarCertificacion`, `datoQuePide`, `datosDelDocumento`, `periodoSugerido`, `nombreDelPeriodo`.
- Produces:
  - `usePendingBulkUpload(requirement: PendingSummaryRow)` → `{ items, receive(files: File[]), choose(index, recordId), remove(index), setRowDate(index, value), batchPeriod, setBatchPeriod, ready, save(), saving, progress, result }`;
  - el tipo `BulkItem = { file: File; match: PendingMatchFile; recordId: string | null; date: string; status: 'pending'|'saving'|'saved'|'error'; error?: string }`.

- [ ] **Step 1: Write the failing tests**

`usePendingBulkUpload.test.ts`:

```ts
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PendingSummaryRow } from '@/lib/types'

const subir = vi.fn()
vi.mock('@/hooks/useSubirDocumento', () => ({ useSubirDocumento: () => subir }))
vi.mock('@/lib/api/compliance', () => ({ complianceApi: { matchPendingFiles: vi.fn() } }))
import { complianceApi } from '@/lib/api/compliance'
import { usePendingBulkUpload } from './usePendingBulkUpload'

const F30: PendingSummaryRow = { key: 'req', label: 'F30-1', requirement_code: 'F30_1', target_entity: 'CARRIER',
  expiration_policy: 'CALENDAR_PERIOD', vigencia: null, overdue: 2, expiring: 0, missing: 0 }
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient() }, children)
const archivo = (n: string) => new File(['x'], n, { type: 'application/pdf' })

beforeEach(() => { vi.clearAllMocks() })

describe('usePendingBulkUpload', () => {
  it('pide la propuesta con los nombres y propone el período a todo el lote', async () => {
    vi.mocked(complianceApi.matchPendingFiles).mockResolvedValue({ files: [
      { file_name: 'a.pdf', status: 'matched', record_id: 'r1', subject_label: 'A', carrier_name: 'A', reason: 'rut', confidence: 0.95, candidates: [] },
    ] })
    const { result } = renderHook(() => usePendingBulkUpload(F30), { wrapper })
    await act(() => result.current.receive([archivo('a.pdf')]))
    expect(complianceApi.matchPendingFiles).toHaveBeenCalledWith('req', ['a.pdf'])
    expect(result.current.items[0].recordId).toBe('r1')
    expect(result.current.batchPeriod).toMatch(/^\d{4}-\d{2}$/)
  })

  it('guarda solo los listos, de a uno por registro, con el período del lote', async () => {
    vi.mocked(complianceApi.matchPendingFiles).mockResolvedValue({ files: [
      { file_name: 'a.pdf', status: 'matched', record_id: 'r1', subject_label: 'A', carrier_name: 'A', reason: 'rut', confidence: 0.95, candidates: [] },
      { file_name: 'b.pdf', status: 'unmatched', record_id: null, subject_label: null, carrier_name: null, reason: null, confidence: null, candidates: [] },
    ] })
    subir.mockResolvedValue(undefined)
    const { result } = renderHook(() => usePendingBulkUpload(F30), { wrapper })
    await act(() => result.current.receive([archivo('a.pdf'), archivo('b.pdf')]))
    act(() => result.current.setBatchPeriod('2026-09'))
    await act(() => result.current.save())
    expect(subir).toHaveBeenCalledTimes(1)
    expect(subir).toHaveBeenCalledWith('r1', expect.any(File), { period_start: '2026-09-01' })
    expect(result.current.items.map(i => i.status)).toEqual(['saved', 'pending'])
  })

  it('una fila que falla conserva su motivo y las demás siguen (Review Focus 5)', async () => {
    vi.mocked(complianceApi.matchPendingFiles).mockResolvedValue({ files: [
      { file_name: 'a.pdf', status: 'matched', record_id: 'r1', subject_label: 'A', carrier_name: 'A', reason: 'rut', confidence: 0.95, candidates: [] },
      { file_name: 'c.pdf', status: 'matched', record_id: 'r3', subject_label: 'C', carrier_name: 'C', reason: 'rut', confidence: 0.95, candidates: [] },
    ] })
    subir.mockImplementation(async (id: string) => { if (id === 'r1') throw new Error('El archivo pesa más de 7 MB') })
    const { result } = renderHook(() => usePendingBulkUpload(F30), { wrapper })
    await act(() => result.current.receive([archivo('a.pdf'), archivo('c.pdf')]))
    await act(() => result.current.save())
    await waitFor(() => expect(result.current.items.map(i => i.status)).toEqual(['error', 'saved']))
    expect(result.current.items[0].error).toBe('El archivo pesa más de 7 MB')
    // Reintentar no repite lo guardado.
    subir.mockClear(); subir.mockResolvedValue(undefined)
    await act(() => result.current.save())
    expect(subir).toHaveBeenCalledTimes(1)
    expect(subir).toHaveBeenCalledWith('r1', expect.any(File), expect.anything())
  })
})
```

`BulkUploadReview.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { PendingSummaryRow } from '@/lib/types'

const hook = {
  items: [
    { file: new File(['x'], 'andes.pdf'), match: { file_name: 'andes.pdf', status: 'ambiguous', record_id: null, subject_label: null,
      carrier_name: null, reason: null, confidence: null,
      candidates: [{ record_id: 'r2', subject_label: 'Transportes Andes Ltda', carrier_name: 'Transportes Andes Ltda', confidence: 0.82 },
                   { record_id: 'r3', subject_label: 'Andes Cargo SpA', carrier_name: 'Andes Cargo SpA', confidence: 0.81 }] },
      recordId: null, date: '', status: 'pending' },
    { file: new File(['x'], 'cordillera.pdf'), match: { file_name: 'cordillera.pdf', status: 'matched', record_id: 'r1',
      subject_label: 'Transportes Cordillera SpA', carrier_name: 'Transportes Cordillera SpA', reason: 'rut', confidence: 0.95, candidates: [] },
      recordId: 'r1', date: '', status: 'pending' },
  ],
  receive: vi.fn(), choose: vi.fn(), remove: vi.fn(), setRowDate: vi.fn(),
  batchPeriod: '2026-09', setBatchPeriod: vi.fn(), ready: 1, save: vi.fn(), saving: false, progress: null, result: null,
}
vi.mock('./usePendingBulkUpload', () => ({ usePendingBulkUpload: () => hook }))
import { BulkUploadReview } from './BulkUploadReview'

const F30: PendingSummaryRow = { key: 'req', label: 'F30-1', requirement_code: 'F30_1', target_entity: 'CARRIER',
  expiration_policy: 'CALENDAR_PERIOD', vigencia: null, overdue: 2, expiring: 0, missing: 0 }

describe('BulkUploadReview', () => {
  it('pone primero lo que hay que elegir y dice por qué se asignó lo demás', () => {
    render(<BulkUploadReview requirement={F30} />)
    const grupos = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)
    expect(grupos[0]).toMatch(/Por elegir/)
    expect(screen.getByText('por RUT')).toBeInTheDocument()
  })

  it('elegir entre candidatos asigna el archivo', () => {
    render(<BulkUploadReview requirement={F30} />)
    fireEvent.change(screen.getByLabelText('A quién va andes.pdf'), { target: { value: 'r2' } })
    expect(hook.choose).toHaveBeenCalledWith(0, 'r2')
  })

  it('guarda los listos con un solo botón que dice cuántos', () => {
    render(<BulkUploadReview requirement={F30} />)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar los 1 listos' }))
    expect(hook.save).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run components/compliance/pending/usePendingBulkUpload.test.ts components/compliance/pending/BulkUploadReview.test.tsx`
Expected: FAIL, falta el módulo o se ve el stub.

- [ ] **Step 3: Implement**

`usePendingBulkUpload.ts`:

```ts
'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { complianceApi } from '@/lib/api/compliance'
import { useSubirDocumento } from '@/hooks/useSubirDocumento'
import { invalidarCertificacion } from '@/lib/queries/certificacion'
import { datoQuePide, datosDelDocumento, periodoSugerido } from '@/lib/compliance'
import type { PendingMatchFile, PendingSummaryRow } from '@/lib/types'

export type BulkItem = {
  file: File
  match: PendingMatchFile
  recordId: string | null
  /** La fecha propia del archivo (impresa o de emisión), si su regla la pide. */
  date: string
  status: 'pending' | 'saving' | 'saved' | 'error'
  error?: string
}

const CONCURRENCIA = 3

/** La carga en lote de Pendientes (spec 2026-10-11, sección 6). Nada se sube
 *  hasta `save()`; se guarda lo que está listo, de a tres, y cada fila conserva
 *  su resultado. Reintentar no repite lo ya guardado. */
export function usePendingBulkUpload(requirement: PendingSummaryRow) {
  const qc = useQueryClient()
  const subirDocumento = useSubirDocumento()
  const pide = requirement.expiration_policy ? datoQuePide(requirement.expiration_policy) : null
  const [items, setItems] = useState<BulkItem[]>([])
  const [batchPeriod, setBatchPeriod] = useState(periodoSugerido(null))
  const [saving, setSaving] = useState(false)

  async function receive(files: File[]) {
    const { files: propuestas } = await complianceApi.matchPendingFiles(requirement.key, files.map(f => f.name))
    setItems(files.map((file, i) => ({
      file, match: propuestas[i], recordId: propuestas[i].record_id, date: '', status: 'pending',
    })))
  }

  const update = (i: number, patch: Partial<BulkItem>) =>
    setItems(prev => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)))

  const datosDe = (it: BulkItem) => {
    if (!pide) return undefined
    if (pide.dato === 'periodo') return datosDelDocumento('periodo', batchPeriod)
    return it.date ? datosDelDocumento(pide.dato, it.date) : undefined
  }
  /** Listo para guardar: tiene a quién va, no se guardó ni se está guardando,
   *  y tiene lo que pide su regla (el período lo pone el lote; la fecha propia,
   *  cada fila, si es obligatoria). */
  const isReady = (it: BulkItem) => {
    if (it.status === 'saved' || it.status === 'saving' || !it.recordId) return false
    if (!pide) return true
    if (pide.dato === 'periodo') return !!batchPeriod
    return !pide.obligatorio || !!it.date
  }

  async function save() {
    setSaving(true)
    const cola = items.map((it, i) => [it, i] as const).filter(([it]) => isReady(it))
    let next = 0
    async function worker() {
      while (next < cola.length) {
        const [it, i] = cola[next++]
        update(i, { status: 'saving', error: undefined })
        try {
          await subirDocumento(it.recordId!, it.file, datosDe(it))
          update(i, { status: 'saved' })
        } catch (e) {
          update(i, { status: 'error', error: e instanceof Error && e.message ? e.message : 'No se pudo subir el documento' })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, cola.length) }, worker))
    await invalidarCertificacion(qc)
    setSaving(false)
  }

  const saved = items.filter(i => i.status === 'saved').length
  return {
    items, receive,
    choose: (i: number, recordId: string) => update(i, { recordId }),
    remove: (i: number) => setItems(prev => prev.filter((_, j) => j !== i)),
    setRowDate: (i: number, date: string) => update(i, { date }),
    batchPeriod, setBatchPeriod,
    ready: items.filter(isReady).length,
    save, saving,
    progress: saving ? { done: saved, total: items.filter(i => i.recordId).length } : null,
    result: !saving && saved > 0 ? {
      saved, errors: items.filter(i => i.status === 'error').length,
      unresolved: items.filter(i => !i.recordId).length,
    } : null,
    needs: pide?.dato ?? null,
  }
}
```

`BulkUploadReview.tsx`:

```tsx
'use client'

import { useRef } from 'react'
import { Upload } from 'lucide-react'
import { StatusChip } from '@/components/ui/StatusChip'
import { usePendingBulkUpload, type BulkItem } from './usePendingBulkUpload'
import type { PendingSummaryRow } from '@/lib/types'

const RAZON: Record<string, string> = { rut: 'por RUT', plate: 'por patente', name: 'por nombre' }

/** La carga en lote sobre un documento: soltar → revisar a quién va cada
 *  archivo → completar lo que pide la regla → guardar los listos. */
export function BulkUploadReview({ requirement }: { requirement: PendingSummaryRow }) {
  const lote = usePendingBulkUpload(requirement)
  const input = useRef<HTMLInputElement>(null)
  const indexed = lote.items.map((it, i) => ({ it, i }))
  const grupos: { titulo: string; filas: { it: BulkItem; i: number }[] }[] = [
    { titulo: 'Por elegir · hay más de una empresa posible', filas: indexed.filter(x => x.it.match.status === 'ambiguous' && !x.it.recordId) },
    { titulo: 'Sin asignar · el nombre no trae RUT ni una empresa reconocible', filas: indexed.filter(x => x.it.match.status === 'unmatched' && !x.it.recordId) },
    { titulo: 'Asignados', filas: indexed.filter(x => !!x.it.recordId) },
  ].filter(g => g.filas.length)

  if (!lote.items.length) {
    return (
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); void lote.receive(Array.from(e.dataTransfer.files)) }}
        className="mb-3 flex items-center gap-2 rounded-md border border-dashed border-border bg-bg-main px-3 py-2 text-etiqueta text-informativo"
      >
        <Upload size={14} aria-hidden />
        Arrastra varios {requirement.label} aquí: te muestro a quién corresponde cada uno antes de guardar.
        <button type="button" onClick={() => input.current?.click()} className="ml-auto font-semibold text-accion hover:underline">
          Elegir archivos
        </button>
        <input ref={input} type="file" multiple className="sr-only" aria-label={`Elegir varios ${requirement.label}`}
               onChange={e => { void lote.receive(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      </div>
    )
  }

  return (
    <section aria-label="Carga en lote" className="mb-3 rounded-md border border-border bg-white p-3">
      {lote.needs === 'periodo' && (
        <label className="mb-2 flex items-center gap-2 rounded-md bg-bg-main px-3 py-2 text-dato">
          <span className="font-semibold">Período para todo el lote</span>
          <input type="month" value={lote.batchPeriod} onChange={e => lote.setBatchPeriod(e.target.value)}
                 className="rounded-md border border-border bg-white px-2 py-1" />
        </label>
      )}
      {grupos.map(g => (
        <div key={g.titulo} className="mb-2">
          <h3 className="mb-1 text-dato font-semibold text-text-primary">{g.titulo}</h3>
          <ul className="divide-y divide-border">
            {g.filas.map(({ it, i }) => (
              <li key={i} className="flex flex-wrap items-center gap-2 py-1.5 text-dato">
                <span className="min-w-0 flex-1 truncate">{it.file.name}</span>
                {it.recordId && it.match.record_id === it.recordId ? (
                  <span className="flex items-center gap-1">
                    {it.match.subject_label}
                    {it.match.reason && <StatusChip tone={it.match.reason === 'name' ? 'action' : 'resolved'}>{RAZON[it.match.reason]}</StatusChip>}
                  </span>
                ) : (
                  <select aria-label={`A quién va ${it.file.name}`} value={it.recordId ?? ''}
                          onChange={e => lote.choose(i, e.target.value)}
                          className="rounded-md border border-border bg-white px-2 py-1">
                    <option value="">Elige…</option>
                    {it.match.candidates.map(c => <option key={c.record_id} value={c.record_id}>{c.subject_label}</option>)}
                  </select>
                )}
                {(lote.needs === 'emision' || lote.needs === 'vencimiento') && (
                  <input type="date" aria-label={`Fecha de ${it.file.name}`} value={it.date}
                         onChange={e => lote.setRowDate(i, e.target.value)}
                         className="rounded-md border border-border bg-white px-2 py-1" />
                )}
                {it.status === 'saved' && <StatusChip tone="resolved">Guardado</StatusChip>}
                {it.status === 'error' && <StatusChip tone="urgent">{`No se guardó: ${it.error}`}</StatusChip>}
                {it.status === 'pending' && (
                  <button type="button" onClick={() => lote.remove(i)} className="text-etiqueta font-semibold text-accion hover:underline">
                    Quitar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button type="button" disabled={!lote.ready || lote.saving} onClick={() => void lote.save()}
                className="rounded-md bg-accent px-3 py-1.5 text-dato font-semibold text-white hover:bg-accent/90 disabled:opacity-50">
          {`Guardar los ${lote.ready} listos`}
        </button>
        {lote.progress && <span role="status" className="text-etiqueta text-informativo">{`Guardando ${lote.progress.done} de ${lote.progress.total}…`}</span>}
        {lote.result && (
          <span role="status" className="text-etiqueta text-informativo">
            {`${lote.result.saved} guardados · ${lote.result.errors} con error · ${lote.result.unresolved} por resolver`}
          </span>
        )}
      </div>
    </section>
  )
}
```

Además, `beforeunload` mientras se guarda. En `usePendingBulkUpload`, dentro de `save()`:

```ts
    const avisar = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', avisar)
    try { /* … el bloque de workers … */ } finally { window.removeEventListener('beforeunload', avisar) }
```

- [ ] **Step 4: Run them**

Run: `npx vitest run components/compliance/pending lib/ui lib/copy && npx tsc --noEmit`
Expected: todo en verde y los trinquetes sin subir.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/compliance/pending
git commit -m "feat(certificacion): carga en lote en Pendientes — revisar a quién va cada archivo y guardar los listos

Propuesta del servidor sin escribir; por elegir y sin asignar arriba; período
una vez por lote o fecha por fila; se guarda de a tres y cada fila conserva su
resultado. Reintentar no repite lo guardado.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Verificación, despliegue y registro

**Files:**
- Modify: `AGENTLOG.md` (entrada nueva arriba)

- [ ] **Step 1: Medir el rendimiento (solo lectura)**

Con la URL del pooler (como en `.superpowers/local-sim`, sin guardarla en disco):

```bash
cd monitor-app/backend/api && venv/bin/python - <<'EOF'
import asyncio, os, time, urllib.parse as u
import asyncpg
from dotenv import load_dotenv
load_dotenv(".env")
from app.routers.compliance import _PENDING_SUMMARY_BY_REQUIREMENT_SQL, _PENDING_SUMMARY_BY_CARRIER_SQL
from app.services.vencimientos import PENDING_STATES
p = u.urlparse(os.environ["DATABASE_URL"]); ref = p.hostname.split(".")[1]
url = f"postgresql://{p.username}.{ref}:{p.password}@aws-1-us-east-1.pooler.supabase.com:5432/{p.path[1:]}"
async def main():
    c = await asyncpg.connect(url, statement_cache_size=0)
    try:
        for nombre, sql in (("por documento", _PENDING_SUMMARY_BY_REQUIREMENT_SQL), ("por empresa", _PENDING_SUMMARY_BY_CARRIER_SQL)):
            t = time.perf_counter(); await c.fetch(sql, "falta", list(PENDING_STATES)); print(nombre, round((time.perf_counter()-t)*1000), "ms")
    finally:
        await c.close()
asyncio.run(main())
EOF
```

Expected: < 300 ms cada uno. Si supera, anotarlo en el AGENTLOG con la cifra y medir `EXPLAIN (ANALYZE, BUFFERS)`. Un índice va en un ticket aparte, no se agrega a ciegas.

- [ ] **Step 2: Suite del área + build**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_pending_documents_integration.py tests/test_match_owner.py tests/test_compliance.py tests/test_integracion_certificacion.py tests/test_document_ingest.py tests/test_requirements.py tests/test_catalogo_en_lote.py tests/test_toda_ruta_declara_permiso.py -q
cd ../../frontend && npx vitest run components/compliance components/ui components/dashboard app/dashboard/compliance app/dashboard/carriers lib && npx tsc --noEmit && npm run build
```

Expected: todo en verde y el build con la ruta `/dashboard/compliance/pending` en el manifiesto.

- [ ] **Step 3: Recorrido en la copia local (Playwright)**

Levantar `.superpowers/local-sim/` siguiendo el AGENTLOG del 11/10:
- `supabase start`;
- API en :8100 con `api.env`;
- `next dev -p 3100` con las variables locales.

Archivos ficticios: `files/` más un lote nuevo de 5 F30-1 con RUT válidos de las empresas ficticias, uno sin RUT y uno ambiguo. Como **Carla** (`cert@sim.local`):
1. Entrar a Certificación › Pendientes.
2. Elegir F30-1.
3. Arrastrar el lote.
4. Resolver el ambiguo y el sin asignar.
5. Guardar los listos.
6. Ver que las cifras bajan.
7. Adelantar `hoy_chile()` 30 días (como en la simulación del 11/10) y ver la licencia de Rojas pasar de "Por vencer" a "Vencidos".
8. Restaurar `hoy_chile()`.

Como **Óscar** (`ops@sim.local`): ve todo, sin "Subir" ni zona de arrastre.

Capturas a 1440 px y 390 px en `.playwright-mcp/pendientes-*.png`. Comparar lado a lado con `pendientes-estados.html` y `pendientes-carga-en-lote.html`.

- [ ] **Step 4: Push y deploy a dev**

```bash
git push origin dev
gh run list --branch dev --limit 4
```

Expected: `Deploy Monitor API` y `Deploy Frontend` en `success`. En dev, con datos reales y **sin subir nada**: abrir Pendientes, elegir un documento y el filtro por empresa, en escritorio y teléfono. Comprobar que la portada de Certificación, la ficha de una empresa y el cajón actual se ven igual que antes.

- [ ] **Step 5: AGENTLOG y commit**

Entrada nueva en `AGENTLOG.md`:
- qué se hizo, con commits;
- las rulings R1–R3 del plan y las del ledger;
- las cifras de rendimiento;
- las capturas;
- el siguiente paso exacto: bloque 2 (Certificación como tareas) o bloque 3 (panel de consulta + "Pedir a Certificación", validado con Pablo).

```bash
git add AGENTLOG.md && git commit -m "docs(agentlog): Certificación › Pendientes desplegado en dev

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" && git push origin dev
```

---

## Self-review

- **Cobertura de la spec:**
  - §3.1 estado → T1;
  - §3.2 alcance → T1 y T2;
  - §4.1 `/pending` → T2;
  - §4.2 resumen → T3 (R2);
  - §4.3 match → T4 y T5 (R1);
  - §5.1 ruta, menú y URL → T9;
  - §5.2 componentes → T6, T8 (R3) y T9;
  - §5.3 estados → T9; teléfono → T9 (columnas que se alternan con "← Volver");
  - §6 carga en lote → T10;
  - §7 pruebas → en cada tarea + T11;
  - §8 reglas → Global Constraints;
  - §9 riesgos → compatibilidad (T2 Step 5) y rendimiento (T11 Step 1).
- **Placeholders:** ninguno. `resolved` en T2 es el SQL actual pegado literal; `isReady` en T10 está en su versión final.
- **R4** agregado en la revisión: el alcance se ata a `state`, para que "Ver por empresa" sea coherente con su resumen.
- **Tipos:** `document_state` y `DocumentState`, `PendingSummaryRow` (back y front con los mismos campos), `PendingMatchFile`, y `colaPendientes`/`resumenPendientes` coinciden entre las tareas.
