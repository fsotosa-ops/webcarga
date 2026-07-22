# Taxonomía unificada de Estados y Motivos — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar `app.operational_states` + `app.unassigned_reasons` + un dominio nuevo `EQUIPMENT_STATE` en una sola tabla `app.status_taxonomies`, con un router/componente CRUD genérico, y sumar una sugerencia de motivo en la UI de cuadratura cuando existe una alerta de documentación vencida.

**Architecture:** Migración SQL que crea la tabla nueva y reapunta las 3 FK reales existentes (`app.trips`/`app.trips_manual`/`app.driver_day_status`.`unassigned_reason_id`) sin perder datos. Backend: un router genérico parametrizado por `domain` reemplaza los endpoints específicos de `operational-states`; `GET /trips/meta` y `daily_closures.py` pasan a leer de la tabla nueva. Frontend: un componente `TaxonomyTab` reemplaza el cuerpo de `EstadosOperacionalesTab` y se reusa para el tab nuevo "Estados de Equipo"; `CloseDayDialog.tsx` gana un hint de motivo sugerido.

**Tech Stack:** FastAPI + asyncpg (backend), Next.js / React + Vitest + Testing Library (frontend), Supabase Postgres.

## Global Constraints

- Spec completo: `docs/superpowers/specs/2026-07-22-status-taxonomies-design.md` — cualquier duda de alcance se resuelve ahí, no acá.
- `cd monitor-app/backend/api && venv/bin/python -m pytest -q` y `cd monitor-app/frontend && npx tsc --noEmit && npx vitest run` limpios al final de cada tarea.
- Supabase project ID: `viclzoftiudkepqnhekv`.
- La migración de datos (Tarea 1) toca producción — se aplica solo con confirmación explícita del usuario antes del paso de `apply_migration`, verificando conteos antes/después.
- Ninguna tabla vieja (`operational_states`, `unassigned_reasons`) se borra en este plan — eso es la Tarea 9, explícitamente diferida y gateada por confirmación separada, después de correr en producción sin errores un tiempo.
- `suggested_alert_source`/sugerencia de motivo es solo para conductor en este plan (`driver_day_status`, ya existe) — para equipo es un plan futuro (`equipment_day_status`, fuera de este spec).

---

## Tarea 1: Migración SQL — tabla unificada + backfill + reapuntar FKs

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260722040000_status_taxonomies.sql`

**Interfaces:**
- Produce: tabla `app.status_taxonomies(id uuid, domain text, label text, bg_color text, text_color text, group_id text, suggested_alert_source text, sort_order int, active bool, created_at, updated_at)`.
- Produce: `app.trips.unassigned_reason_id`, `app.trips_manual.unassigned_reason_id`, `app.driver_day_status.unassigned_reason_id` — mismo nombre de columna, tipo cambia de `text` a `uuid`, FK apunta a `status_taxonomies(id)` en vez de `unassigned_reasons(id)`.

- [ ] **Paso 1: escribir la migración completa**

```sql
-- Ronda 43: unifica app.operational_states + app.unassigned_reasons en una
-- sola taxonomía configurable, y agrega el dominio EQUIPMENT_STATE nuevo
-- (spec docs/superpowers/specs/2026-07-22-status-taxonomies-design.md).
-- Las tablas viejas NO se borran acá — ver migración de limpieza separada,
-- aplicada solo después de confirmar que nada quedó apuntando a ellas.

CREATE TABLE app.status_taxonomies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain      text NOT NULL CHECK (domain IN ('OPERATIONAL_STATE', 'DRIVER_REASON', 'EQUIPMENT_STATE')),
  label       text NOT NULL,
  bg_color    text NOT NULL,
  text_color  text NOT NULL,
  -- Solo tiene sentido para OPERATIONAL_STATE (columna del tablero) — NULL
  -- en los otros 2 dominios.
  group_id    text,
  -- Correlación fija con una alerta ya calculada (compliance_records) para
  -- sugerir este motivo en la UI de cuadratura — NULL en casi todas las
  -- filas, poblado solo en la semilla "Documentación vencida".
  suggested_alert_source text,
  sort_order  integer NOT NULL DEFAULT 99,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_status_taxonomies_domain ON app.status_taxonomies (domain, sort_order) WHERE active;

ALTER TABLE app.status_taxonomies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Status taxonomies are viewable by authenticated users" ON app.status_taxonomies;
CREATE POLICY "Status taxonomies are viewable by authenticated users" ON app.status_taxonomies FOR SELECT TO authenticated USING (true);

-- 1. Vuelca operational_states (uuid → mismo uuid, no rompe nada que lo
--    referencie — verificado que ninguna FK real apunta a esta tabla, solo
--    se lee).
INSERT INTO app.status_taxonomies (id, domain, label, bg_color, text_color, group_id, sort_order, active, created_at, updated_at)
SELECT id, 'OPERATIONAL_STATE', label, bg_color, text_color, group_id, sort_order, active, created_at, updated_at
FROM app.operational_states;

-- 2. Vuelca unassigned_reasons con un mapeo temporal viejo-id (text) →
--    nuevo-id (uuid), para poder reescribir las 3 FK reales de abajo.
CREATE TEMP TABLE reason_id_map AS
SELECT ur.id AS old_id, gen_random_uuid() AS new_id, ur.label, ur.sort_order, ur.active
FROM app.unassigned_reasons ur;

INSERT INTO app.status_taxonomies (id, domain, label, bg_color, text_color, sort_order, active)
SELECT new_id, 'DRIVER_REASON', label, '#f3f4f6', '#374151', sort_order, active
FROM reason_id_map;

-- 3. app.trips.unassigned_reason_id: text → uuid, backfill vía el mapeo,
--    reapunta la FK a status_taxonomies.
ALTER TABLE app.trips ADD COLUMN unassigned_reason_id_new uuid REFERENCES app.status_taxonomies(id);
UPDATE app.trips t SET unassigned_reason_id_new = m.new_id
FROM reason_id_map m WHERE t.unassigned_reason_id = m.old_id;
ALTER TABLE app.trips DROP COLUMN unassigned_reason_id;
ALTER TABLE app.trips RENAME COLUMN unassigned_reason_id_new TO unassigned_reason_id;

-- 4. app.trips_manual — mismo tratamiento.
ALTER TABLE app.trips_manual ADD COLUMN unassigned_reason_id_new uuid REFERENCES app.status_taxonomies(id);
UPDATE app.trips_manual t SET unassigned_reason_id_new = m.new_id
FROM reason_id_map m WHERE t.unassigned_reason_id = m.old_id;
ALTER TABLE app.trips_manual DROP COLUMN unassigned_reason_id;
ALTER TABLE app.trips_manual RENAME COLUMN unassigned_reason_id_new TO unassigned_reason_id;

-- 5. app.driver_day_status — mismo tratamiento (esta es la tabla real de la
--    cuadratura diaria, la más sensible de las 3).
ALTER TABLE app.driver_day_status ADD COLUMN unassigned_reason_id_new uuid REFERENCES app.status_taxonomies(id);
UPDATE app.driver_day_status d SET unassigned_reason_id_new = m.new_id
FROM reason_id_map m WHERE d.unassigned_reason_id = m.old_id;
ALTER TABLE app.driver_day_status DROP COLUMN unassigned_reason_id;
ALTER TABLE app.driver_day_status RENAME COLUMN unassigned_reason_id_new TO unassigned_reason_id;

-- 6. Semillas nuevas de EQUIPMENT_STATE (estándar de industria fleet/TMS).
INSERT INTO app.status_taxonomies (domain, label, bg_color, text_color, sort_order, active) VALUES
  ('EQUIPMENT_STATE', 'Disponible',                    '#f0fdf4', '#166534', 1, true),
  ('EQUIPMENT_STATE', 'En Mantención',                  '#fef9c3', '#854d0e', 2, true),
  ('EQUIPMENT_STATE', 'En Pana / Fuera de Servicio',     '#fef2f2', '#b91c1c', 3, true),
  ('EQUIPMENT_STATE', 'Prestado a otra empresa',         '#eff6ff', '#1d4ed8', 4, true),
  ('EQUIPMENT_STATE', 'Sin Conductor Asignado',          '#f3f4f6', '#374151', 5, true),
  ('EQUIPMENT_STATE', 'Descanso Programado',             '#f5f3ff', '#6d28d9', 6, true);

-- 7. Semillas ampliadas de DRIVER_REASON — variantes documentales, una con
--    la correlación de sugerencia (Tarea 5/8).
INSERT INTO app.status_taxonomies (domain, label, bg_color, text_color, sort_order, active, suggested_alert_source) VALUES
  ('DRIVER_REASON', 'Documentación vencida', '#fef2f2', '#b91c1c', 7, true, 'compliance_expired'),
  ('DRIVER_REASON', 'Licencia vencida',      '#fef2f2', '#b91c1c', 8, true, NULL);
```

- [ ] **Paso 2: verificar conteos ANTES de aplicar** (Supabase MCP `execute_sql`, `project_id=viclzoftiudkepqnhekv`)

```sql
SELECT
  (SELECT count(*) FROM app.operational_states) AS op_states,
  (SELECT count(*) FROM app.unassigned_reasons) AS reasons,
  (SELECT count(*) FROM app.trips WHERE unassigned_reason_id IS NOT NULL) AS trips_with_reason,
  (SELECT count(*) FROM app.trips_manual WHERE unassigned_reason_id IS NOT NULL) AS trips_manual_with_reason,
  (SELECT count(*) FROM app.driver_day_status WHERE unassigned_reason_id IS NOT NULL) AS dds_with_reason;
```

Anotar estos 5 números — se comparan contra el paso 4.

- [ ] **Paso 3: pedir confirmación explícita al usuario antes de aplicar** (esta migración toca datos reales de producción — no aplicar sin luz verde, mostrando los conteos del paso 2).

- [ ] **Paso 4: aplicar la migración** (Supabase MCP `apply_migration`, `project_id=viclzoftiudkepqnhekv`, `name=status_taxonomies`, con el SQL completo del paso 1) y verificar conteos DESPUÉS:

```sql
SELECT
  (SELECT count(*) FROM app.status_taxonomies WHERE domain='OPERATIONAL_STATE') AS op_states,
  (SELECT count(*) FROM app.status_taxonomies WHERE domain='DRIVER_REASON') AS reasons,
  (SELECT count(*) FROM app.trips WHERE unassigned_reason_id IS NOT NULL) AS trips_with_reason,
  (SELECT count(*) FROM app.trips_manual WHERE unassigned_reason_id IS NOT NULL) AS trips_manual_with_reason,
  (SELECT count(*) FROM app.driver_day_status WHERE unassigned_reason_id IS NOT NULL) AS dds_with_reason;
```

Expected: `op_states` igual al conteo original de `operational_states`; `reasons` = conteo original de `unassigned_reasons` + 2 (las semillas documentales nuevas); los 3 conteos de `*_with_reason` **exactamente iguales** a los del paso 2 (ningún dato se perdió en el remapeo).

- [ ] **Paso 5: commit**

```bash
git add monitor-app/backend/supabase/migrations/20260722040000_status_taxonomies.sql
git commit -m "feat(config): migración — tabla unificada app.status_taxonomies"
```

---

## Tarea 2: Backend — router genérico `status_taxonomies.py` (TDD)

**Files:**
- Create: `monitor-app/backend/api/app/schemas/status_taxonomy.py`
- Create: `monitor-app/backend/api/app/routers/status_taxonomies.py`
- Modify: `monitor-app/backend/api/app/main.py`
- Test: `monitor-app/backend/api/tests/test_status_taxonomies.py`

**Interfaces:**
- Produce: `router` (FastAPI `APIRouter`, prefix `/config/taxonomies`) — `GET ?domain=`, `POST`, `PATCH /{id}`, `DELETE /{id}`.
- Produce: `VALID_DOMAINS = {"OPERATIONAL_STATE", "DRIVER_REASON", "EQUIPMENT_STATE"}` (en `schemas/status_taxonomy.py`, reusado por Tarea 4).

- [ ] **Paso 1: escribir el schema**

```python
# app/schemas/status_taxonomy.py
from typing import Optional
from pydantic import BaseModel, field_validator

VALID_DOMAINS = {"OPERATIONAL_STATE", "DRIVER_REASON", "EQUIPMENT_STATE"}
VALID_GROUP_IDS = {"en_ruta", "en_local", "retornando", "cerrado", "problema", "otro"}


class StatusTaxonomyBody(BaseModel):
    domain:     str
    label:      str
    bg_color:   str = "#f3f4f6"
    text_color: str = "#374151"
    sort_order: int = 99
    group_id:   Optional[str] = None

    @field_validator("domain")
    @classmethod
    def domain_valid(cls, v: str) -> str:
        if v not in VALID_DOMAINS:
            raise ValueError(f"domain debe ser uno de {VALID_DOMAINS}")
        return v

    @field_validator("label")
    @classmethod
    def label_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 60:
            raise ValueError("label debe tener entre 1 y 60 caracteres")
        return v

    @field_validator("group_id")
    @classmethod
    def group_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_GROUP_IDS:
            raise ValueError(f"group_id debe ser uno de {VALID_GROUP_IDS}")
        return v


class StatusTaxonomyPatch(BaseModel):
    label:      Optional[str] = None
    bg_color:   Optional[str] = None
    text_color: Optional[str] = None
    sort_order: Optional[int] = None
    active:     Optional[bool] = None
    group_id:   Optional[str] = None

    @field_validator("group_id")
    @classmethod
    def group_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_GROUP_IDS:
            raise ValueError(f"group_id debe ser uno de {VALID_GROUP_IDS}")
        return v
```

- [ ] **Paso 2: escribir los tests que van a fallar**

```python
# tests/test_status_taxonomies.py
from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, require_admin
from app.db import get_pool
from app.routers.status_taxonomies import router

USER = {"sub": "11111111-1111-1111-1111-111111111111", "email": "a@b.c", "role": "admin"}


def make_client(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_admin] = lambda: USER
    return TestClient(app)


def test_list_requires_domain_query_param():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.get("/api/v1/config/taxonomies")
    assert res.status_code == 422


def test_list_rejects_invalid_domain():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.get("/api/v1/config/taxonomies?domain=NOT_A_DOMAIN")
    assert res.status_code == 422


def test_list_filters_by_domain():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "id": "t1", "domain": "EQUIPMENT_STATE", "label": "Disponible",
        "bg_color": "#fff", "text_color": "#000", "group": None, "sort_order": 1, "active": True,
    }]
    client = make_client(pool)
    res = client.get("/api/v1/config/taxonomies?domain=EQUIPMENT_STATE")
    assert res.status_code == 200
    assert res.json()[0]["label"] == "Disponible"
    query = pool.fetch.call_args.args[0]
    assert "domain = $1" in query
    assert pool.fetch.call_args.args[1] == "EQUIPMENT_STATE"


def test_create_rejects_invalid_domain():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.post("/api/v1/config/taxonomies", json={"domain": "NOT_A_DOMAIN", "label": "X"})
    assert res.status_code == 422


def test_create_taxonomy():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "id": "t1", "domain": "EQUIPMENT_STATE", "label": "En Pana",
        "bg_color": "#fef2f2", "text_color": "#b91c1c", "group": None, "sort_order": 3, "active": True,
    }
    client = make_client(pool)
    res = client.post("/api/v1/config/taxonomies", json={
        "domain": "EQUIPMENT_STATE", "label": "En Pana", "bg_color": "#fef2f2", "text_color": "#b91c1c", "sort_order": 3,
    })
    assert res.status_code == 200
    assert res.json()["label"] == "En Pana"


def test_patch_taxonomy_404_when_missing():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)
    res = client.patch("/api/v1/config/taxonomies/t1", json={"label": "Nuevo"})
    assert res.status_code == 404


def test_patch_taxonomy_no_fields_422():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"id": "t1"}
    client = make_client(pool)
    res = client.patch("/api/v1/config/taxonomies/t1", json={})
    assert res.status_code == 422


def test_deactivate_taxonomy():
    pool = AsyncMock()
    pool.execute.return_value = "UPDATE 1"
    client = make_client(pool)
    res = client.delete("/api/v1/config/taxonomies/t1")
    assert res.status_code == 200


def test_deactivate_taxonomy_404_when_missing():
    pool = AsyncMock()
    pool.execute.return_value = "UPDATE 0"
    client = make_client(pool)
    res = client.delete("/api/v1/config/taxonomies/t1")
    assert res.status_code == 404
```

- [ ] **Paso 3: correr los tests, confirmar que fallan**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_status_taxonomies.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.routers.status_taxonomies'`

- [ ] **Paso 4: implementar el router**

```python
# app/routers/status_taxonomies.py
from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import require_admin
from ..db import get_pool
from ..schemas.status_taxonomy import StatusTaxonomyBody, StatusTaxonomyPatch, VALID_DOMAINS

router = APIRouter(prefix="/config/taxonomies", tags=["config"])

_FIELDS = 'id::text, domain, label, bg_color, text_color, group_id AS "group", sort_order, active'


@router.get("")
async def list_taxonomies(domain: str = Query(...), pool=Depends(get_pool)):
    if domain not in VALID_DOMAINS:
        raise HTTPException(422, f"domain debe ser uno de {VALID_DOMAINS}")
    rows = await pool.fetch(
        f"SELECT {_FIELDS} FROM app.status_taxonomies WHERE domain = $1 AND active = true ORDER BY sort_order, created_at",
        domain,
    )
    return [dict(r) for r in rows]


@router.post("")
async def create_taxonomy(body: StatusTaxonomyBody, pool=Depends(get_pool), _=Depends(require_admin)):
    row = await pool.fetchrow(
        f"""INSERT INTO app.status_taxonomies (domain, label, bg_color, text_color, sort_order, group_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING {_FIELDS}""",
        body.domain, body.label, body.bg_color, body.text_color, body.sort_order, body.group_id,
    )
    return dict(row)


@router.patch("/{taxonomy_id}")
async def patch_taxonomy(
    taxonomy_id: str, body: StatusTaxonomyPatch, pool=Depends(get_pool), _=Depends(require_admin),
):
    existing = await pool.fetchrow("SELECT id FROM app.status_taxonomies WHERE id = $1", taxonomy_id)
    if not existing:
        raise HTTPException(404, "No encontrado")

    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(422, "Ningún campo enviado")

    sets, vals = [], [taxonomy_id]
    for field, value in data.items():
        vals.append(value)
        sets.append(f"{field} = ${len(vals)}")
    sets.append("updated_at = NOW()")

    await pool.execute(f"UPDATE app.status_taxonomies SET {', '.join(sets)} WHERE id = $1", *vals)
    row = await pool.fetchrow(f"SELECT {_FIELDS} FROM app.status_taxonomies WHERE id = $1", taxonomy_id)
    return dict(row)


@router.delete("/{taxonomy_id}")
async def deactivate_taxonomy(taxonomy_id: str, pool=Depends(get_pool), _=Depends(require_admin)):
    result = await pool.execute(
        "UPDATE app.status_taxonomies SET active = false, updated_at = NOW() WHERE id = $1", taxonomy_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "No encontrado")
```

- [ ] **Paso 5: registrar el router**

En `app/main.py`, agregar el import junto a los demás routers:

```python
from .routers.status_taxonomies import router as status_taxonomies_router
```

Y el registro, junto a `config_router` (línea ~57):

```python
app.include_router(config_router,              prefix="/api/v1")
app.include_router(status_taxonomies_router,   prefix="/api/v1")
```

- [ ] **Paso 6: correr los tests, confirmar que pasan**

Run: `venv/bin/python -m pytest tests/test_status_taxonomies.py -v`
Expected: 8 passed

- [ ] **Paso 7: commit**

```bash
git add app/schemas/status_taxonomy.py app/routers/status_taxonomies.py app/main.py tests/test_status_taxonomies.py
git commit -m "feat(config): router genérico CRUD para app.status_taxonomies"
```

---

## Tarea 3: Backend — retirar endpoints viejos de `operational-states`

**Files:**
- Modify: `monitor-app/backend/api/app/routers/config.py`
- Modify: `monitor-app/backend/api/tests/test_config_monitor.py`

**Interfaces:**
- Consume: nada nuevo — solo elimina código muerto ahora que la Tarea 2 lo reemplaza.

- [ ] **Paso 1: borrar de `config.py`** las clases `OperationalStateBody` (líneas 31-51) y `OperationalStatePatch` (líneas 54-67), y los 4 endpoints bajo el comentario `# ── Operational states (full CRUD) ──` (líneas 194-265: `list_operational_states`, `create_operational_state`, `patch_operational_state`, `delete_operational_state`).

- [ ] **Paso 2: borrar de `test_config_monitor.py`** los 2 tests bajo el comentario `# ── /config/operational-states — group_id nuevo ──` (líneas 46-67: `test_create_operational_state_with_invalid_group_is_422`, `test_patch_operational_state_accepts_group_id`) — cobertura equivalente ya vive en `test_status_taxonomies.py` (Tarea 2).

- [ ] **Paso 3: correr toda la suite backend**

Run: `venv/bin/python -m pytest -q`
Expected: todos los tests pasan (ninguno debería fallar — `test_config_monitor.py` sigue teniendo `test_list_statuses_returns_group_key` y los tests de `monitor-alert-rules`, sin tocar).

- [ ] **Paso 4: commit**

```bash
git add app/routers/config.py tests/test_config_monitor.py
git commit -m "refactor(config): retira endpoints de operational-states — reemplazados por /config/taxonomies"
```

---

## Tarea 4: Backend — `GET /trips/meta` lee de `status_taxonomies`

**Files:**
- Modify: `monitor-app/backend/api/app/routers/trips.py:709-716` (query de `operational_states`), `:733` (query de `unassigned_reasons`)
- Test: `monitor-app/backend/api/tests/test_config_monitor.py` (o donde viva el test de `/trips/meta` — buscar `def test_.*trips_meta` o `def test_.*get_trips_meta`)

**Interfaces:**
- Consume: `app.status_taxonomies` (Tarea 1).
- Produce: sin cambio de shape — `TripsMeta.operational_states: list[OperationalStateMeta]`, `TripsMeta.unassigned_reasons: list[UnassignedReasonMeta]` (mismos tipos Pydantic, misma forma de respuesta).

- [ ] **Paso 1: localizar el test existente**

Run: `grep -n "def test.*meta\|get_trips_meta" tests/*.py`

Si existe un test que mockea `pool.fetch` con múltiples `side_effect` para `/trips/meta`, anotar su archivo — el Paso 2 agrega un assert ahí. Si no existe ningún test dedicado a `/trips/meta`, crear uno nuevo mínimo en `tests/test_trip_operation_type.py` (o el archivo de tests de `trips.py` más cercano al endpoint).

- [ ] **Paso 2: escribir/extender el test**

```python
def test_trips_meta_reads_operational_states_and_reasons_from_status_taxonomies():
    pool = AsyncMock()
    pool.fetch.side_effect = [
        [],  # statuses
        [{"id": "t1", "label": "En bodega", "bg_color": "#fff", "text_color": "#000", "group": "otro"}],  # operational_states
        [],  # alert_thresholds
        [],  # temperature_ranges
        [{"id": "t2", "label": "Documentación vencida"}],  # unassigned_reasons
    ]
    pool.fetchrow.return_value = None  # monitor_alert_rules (opcional)
    client = make_client(pool)  # mismo helper que ya usa este archivo, router=trips_router
    res = client.get("/api/v1/trips/meta")
    assert res.status_code == 200
    body = res.json()
    assert body["operational_states"][0]["label"] == "En bodega"
    assert body["unassigned_reasons"][0]["label"] == "Documentación vencida"
    op_query = pool.fetch.call_args_list[1].args[0]
    reason_query = pool.fetch.call_args_list[4].args[0]
    assert "app.status_taxonomies" in op_query and "OPERATIONAL_STATE" in op_query
    assert "app.status_taxonomies" in reason_query and "DRIVER_REASON" in reason_query
```

(Ajustar el índice de `side_effect`/`call_args_list` al orden real de queries del archivo de test que se esté extendiendo — verificar contra el cuerpo real de `get_trips_meta` en el Paso 4 antes de fijar el número.)

- [ ] **Paso 3: correr el test, confirmar que falla**

Run: `venv/bin/python -m pytest tests/<archivo>.py::test_trips_meta_reads_operational_states_and_reasons_from_status_taxonomies -v`
Expected: FAIL (assert sobre `"app.status_taxonomies" in op_query` — todavía dice `app.operational_states`)

- [ ] **Paso 4: cambiar las 2 queries en `trips.py`**

```python
    op_rows = await pool.fetch(
        'SELECT id::text, label, bg_color, text_color, group_id AS "group" '
        "FROM app.status_taxonomies WHERE domain = 'OPERATIONAL_STATE' AND active = true ORDER BY sort_order"
    )
```

```python
    unassigned_reason_rows = await pool.fetch(
        "SELECT id::text, label FROM app.status_taxonomies "
        "WHERE domain = 'DRIVER_REASON' AND active = true ORDER BY sort_order"
    )
```

- [ ] **Paso 5: correr el test, confirmar que pasa**

Run: `venv/bin/python -m pytest tests/<archivo>.py::test_trips_meta_reads_operational_states_and_reasons_from_status_taxonomies -v`
Expected: PASS

- [ ] **Paso 6: correr toda la suite backend**

Run: `venv/bin/python -m pytest -q`
Expected: todos pasan

- [ ] **Paso 7: commit**

```bash
git add app/routers/trips.py tests/
git commit -m "feat(trips): GET /trips/meta lee operational_states/unassigned_reasons de status_taxonomies"
```

---

## Tarea 5: Backend — `daily_closures.py`: label desde `status_taxonomies` + sugerencia de motivo

**Files:**
- Modify: `monitor-app/backend/api/app/routers/daily_closures.py:103-155` (`_DETAIL_SQL`, `_REPORT_SQL`)
- Modify: `monitor-app/backend/api/tests/test_daily_closures.py`

**Interfaces:**
- Consume: `_compliance_alert_lateral(alias, entity_type, id_expr, critical_codes)` y `_DRIVER_CRITICAL_DOC_CODES` — ya existen en `app/routers/trips.py` (líneas 310-359), se importan, no se duplican.
- Produce: cada fila de `GET /daily-closures?fecha=` gana 2 campos nuevos: `driver_pending_docs_critical: bool | None`, `suggested_reason_id: str | None`.

- [ ] **Paso 1: extender el fixture y escribir el test que falla**

En `tests/test_daily_closures.py`, extender `_driver_row`:

```python
def _driver_row(**overrides):
    base = {
        "driver_id": "d1", "full_name": "Juan Pérez", "tax_id": "11111111-1",
        "carrier_id": "c1", "carrier_name": "Transportes Sur Spa", "status": "ASSIGNED",
        "unassigned_reason_id": None, "unassigned_reason_label": None,
        "resolved_by": None, "resolved_at": None, "client_names": [],
        "driver_pending_docs_critical": None, "suggested_reason_id": None,
    }
    base.update(overrides)
    return base
```

Agregar el test nuevo (después de `test_get_daily_closure_status_includes_client_names`):

```python
def test_get_daily_closure_status_includes_pending_docs_and_suggestion():
    pool = AsyncMock()
    pool.fetch.return_value = [_driver_row(
        driver_id="d1", status="UNASSIGNED",
        driver_pending_docs_critical=True, suggested_reason_id="r-doc-vencida",
    )]
    client = make_client(pool)
    res = client.get("/api/v1/daily-closures?fecha=2026-07-22")
    assert res.status_code == 200
    driver = res.json()["drivers"][0]
    assert driver["driver_pending_docs_critical"] is True
    assert driver["suggested_reason_id"] == "r-doc-vencida"


def test_get_daily_closure_status_detail_sql_uses_status_taxonomies_and_compliance_join():
    pool = AsyncMock()
    pool.fetch.return_value = [_driver_row()]
    client = make_client(pool)
    client.get("/api/v1/daily-closures?fecha=2026-07-22")
    detail_sql = pool.fetch.call_args_list[0].args[0]
    assert "app.status_taxonomies" in detail_sql
    assert "app.unassigned_reasons" not in detail_sql
    assert "public.compliance_records" in detail_sql
```

Este segundo test ya pasaría trivialmente contra el mock (que no valida SQL real), pero el assert `"app.unassigned_reasons" not in detail_sql` sí falla contra el `_DETAIL_SQL` actual — ese es el fallo esperado.

- [ ] **Paso 2: correr los tests, confirmar que fallan**

Run: `venv/bin/python -m pytest tests/test_daily_closures.py -v -k "pending_docs_and_suggestion or uses_status_taxonomies"`
Expected: `test_get_daily_closure_status_detail_sql_uses_status_taxonomies_and_compliance_join` FAILS (`"app.unassigned_reasons" not in detail_sql` es False porque la query vieja sí la tiene)

- [ ] **Paso 3: reescribir `_DETAIL_SQL` y `_REPORT_SQL`**

Agregar el import al principio del archivo:

```python
from .trips import _compliance_alert_lateral, _DRIVER_CRITICAL_DOC_CODES
```

Reemplazar `_DETAIL_SQL` completo:

```python
_DETAIL_SQL = f"""
SELECT dds.driver_id, d.full_name, d.tax_id, c.id AS carrier_id, c.business_name AS carrier_name,
       dds.status, dds.unassigned_reason_id, ur.label AS unassigned_reason_label,
       dds.resolved_by, dds.resolved_at,
       COALESCE(clients.client_names, ARRAY[]::text[]) AS client_names,
       dcomp.has_critical_pending AS driver_pending_docs_critical,
       sugg.id AS suggested_reason_id
FROM app.driver_day_status dds
JOIN public.drivers d ON d.id = dds.driver_id
LEFT JOIN public.driver_assignments da ON da.driver_id = d.id AND da.status = 'ACTIVE'
LEFT JOIN public.carriers c ON c.id = da.carrier_id
LEFT JOIN app.status_taxonomies ur ON ur.id = dds.unassigned_reason_id
LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT COALESCE(sh.name, t.client_name)) AS client_names
    FROM app.trip_fleet_links fl
    JOIN app.trips t ON t.id = fl.trip_id
    LEFT JOIN public.shippers sh ON lower(trim(sh.name)) = lower(trim(t.client_name)) AND sh.status = 'ACTIVE'
    WHERE fl.driver_id = dds.driver_id AND t.planning_date = dds.business_date AND t.client_name IS NOT NULL
) clients ON true
{_compliance_alert_lateral('dcomp', 'DRIVER', 'dds.driver_id', _DRIVER_CRITICAL_DOC_CODES)}
LEFT JOIN app.status_taxonomies sugg
       ON sugg.domain = 'DRIVER_REASON' AND sugg.suggested_alert_source = 'compliance_expired' AND sugg.active = true
WHERE dds.business_date = $1
ORDER BY d.full_name
"""
```

Reemplazar `_REPORT_SQL` (solo cambia el JOIN del label, sin los campos de sugerencia — ese dataset es histórico plano para Reportería, no la resolución en vivo):

```python
_REPORT_SQL = """
SELECT dds.driver_id, dds.business_date, d.full_name, d.tax_id, c.business_name AS carrier_name,
       dds.status, dds.unassigned_reason_id, ur.label AS unassigned_reason_label,
       COALESCE(clients.client_names, ARRAY[]::text[]) AS client_names
FROM app.driver_day_status dds
JOIN public.drivers d ON d.id = dds.driver_id
LEFT JOIN public.driver_assignments da ON da.driver_id = d.id AND da.status = 'ACTIVE'
LEFT JOIN public.carriers c ON c.id = da.carrier_id
LEFT JOIN app.status_taxonomies ur ON ur.id = dds.unassigned_reason_id
LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT COALESCE(sh.name, t.client_name)) AS client_names
    FROM app.trip_fleet_links fl
    JOIN app.trips t ON t.id = fl.trip_id
    LEFT JOIN public.shippers sh ON lower(trim(sh.name)) = lower(trim(t.client_name)) AND sh.status = 'ACTIVE'
    WHERE fl.driver_id = dds.driver_id AND t.planning_date = dds.business_date AND t.client_name IS NOT NULL
) clients ON true
WHERE dds.business_date BETWEEN $1 AND $2
ORDER BY dds.business_date, d.full_name
"""
```

- [ ] **Paso 4: correr los tests, confirmar que pasan**

Run: `venv/bin/python -m pytest tests/test_daily_closures.py -v`
Expected: todos pasan (incluidos los 2 nuevos)

- [ ] **Paso 5: correr toda la suite backend**

Run: `venv/bin/python -m pytest -q`
Expected: todos pasan — prestar atención a `test_config_monitor.py`/`test_status_taxonomies.py` (Tareas 2-4) por si algo quedó inconsistente entre tareas.

- [ ] **Paso 6: commit**

```bash
git add app/routers/daily_closures.py tests/test_daily_closures.py
git commit -m "feat(cuadratura): label de motivo desde status_taxonomies + sugerencia por documentación vencida"
```

---

## Tarea 6: Frontend — `taxonomiesApi` + componente genérico `TaxonomyTab`

**Files:**
- Modify: `monitor-app/frontend/lib/api/config.ts`
- Modify: `monitor-app/frontend/app/dashboard/admin/configuracion/estados-tabs.tsx`
- Modify: `monitor-app/frontend/app/dashboard/admin/configuracion/estados-tabs.test.tsx` (o crear si no existe con ese nombre exacto — verificar con `ls` antes)

**Interfaces:**
- Produce: `taxonomiesApi.list(domain)`, `.create(body)`, `.patch(id, body)`, `.deactivate(id)` — mismo shape de respuesta que `configApi.getOperationalStates` (`TaxonomyRow = OperationalStateMeta & { sort_order: number; active: boolean }`).
- Produce: `TaxonomyTab({ domain, title, hint, newLabel })`, `EstadosOperacionalesTab` (wrapper) — usado por Tarea 7.

- [ ] **Paso 1: agregar `taxonomiesApi` a `lib/api/config.ts`**

Agregar al final del archivo (después de `configApi`, antes de nada más):

```ts
export type TaxonomyDomain = 'OPERATIONAL_STATE' | 'DRIVER_REASON' | 'EQUIPMENT_STATE'
export type TaxonomyRow = OperationalStateMeta & { sort_order: number; active: boolean }

export const taxonomiesApi = {
  list: (domain: TaxonomyDomain) =>
    apiFetch<TaxonomyRow[]>(`/api/v1/config/taxonomies?domain=${domain}`),

  create: (body: { domain: TaxonomyDomain; label: string; bg_color: string; text_color: string; sort_order?: number; group?: string }) =>
    apiFetch<TaxonomyRow>('/api/v1/config/taxonomies', {
      method: 'POST',
      body: JSON.stringify({ ...body, group: undefined, group_id: body.group }),
    }),

  patch: (id: string, body: Partial<{ label: string; bg_color: string; text_color: string; sort_order: number; active: boolean; group: string }>) =>
    apiFetch<TaxonomyRow>(`/api/v1/config/taxonomies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...body, group: undefined, group_id: body.group }),
    }),

  deactivate: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/config/taxonomies/${id}`, { method: 'DELETE' }),
}
```

- [ ] **Paso 2: escribir el test que falla, para `TaxonomyTab` con `domain="EQUIPMENT_STATE"`**

Crear/extender `estados-tabs.test.tsx` (revisar primero si ya existe un `describe('EstadosOperacionalesTab'...)` para no duplicar mocks — reusar su `vi.mock('@/lib/api/config', ...)` agregando `taxonomiesApi`):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TaxonomyTab } from './estados-tabs'
import { taxonomiesApi } from '@/lib/api/config'

vi.mock('@/lib/api/config', () => ({
  taxonomiesApi: { list: vi.fn(), create: vi.fn(), patch: vi.fn(), deactivate: vi.fn() },
}))

beforeEach(() => {
  vi.mocked(taxonomiesApi.list).mockReset()
  vi.mocked(taxonomiesApi.create).mockReset()
})

describe('TaxonomyTab', () => {
  it('lists rows for the given domain and hides the board-column select for non-OPERATIONAL_STATE domains', async () => {
    vi.mocked(taxonomiesApi.list).mockResolvedValue([
      { id: 't1', label: 'Disponible', bg_color: '#f0fdf4', text_color: '#166534', sort_order: 1, active: true },
    ])
    render(<TaxonomyTab domain="EQUIPMENT_STATE" title="Estados de Equipo" hint="hint" newLabel="estado de equipo" />)
    expect(await screen.findByDisplayValue('Disponible')).toBeInTheDocument()
    expect(taxonomiesApi.list).toHaveBeenCalledWith('EQUIPMENT_STATE')
    expect(screen.queryByText('Columna del tablero')).not.toBeInTheDocument()
  })

  it('creates a new row scoped to the domain', async () => {
    vi.mocked(taxonomiesApi.list).mockResolvedValue([])
    vi.mocked(taxonomiesApi.create).mockResolvedValue({
      id: 't2', label: 'En Pana', bg_color: '#fef2f2', text_color: '#b91c1c', sort_order: 3, active: true,
    })
    render(<TaxonomyTab domain="EQUIPMENT_STATE" title="Estados de Equipo" hint="hint" newLabel="estado de equipo" />)
    fireEvent.click(await screen.findByText('Nuevo estado de equipo'))
    fireEvent.change(screen.getByLabelText('Nombre de estado de equipo nuevo'), { target: { value: 'En Pana' } })
    fireEvent.click(screen.getByText('Crear'))
    await waitFor(() => expect(taxonomiesApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'EQUIPMENT_STATE', label: 'En Pana' }),
    ))
  })
})
```

- [ ] **Paso 3: correr el test, confirmar que falla**

Run: `cd monitor-app/frontend && npx vitest run app/dashboard/admin/configuracion/estados-tabs.test.tsx`
Expected: FAIL — `TaxonomyTab` no existe todavía en `estados-tabs.tsx`

- [ ] **Paso 4: reescribir `estados-tabs.tsx`** — reemplazar la función `EstadosOperacionalesTab` completa (líneas 129-287 del archivo actual) por:

```tsx
export type TaxonomyDomain = 'OPERATIONAL_STATE' | 'EQUIPMENT_STATE'

const emptyNew = (withGroup: boolean) =>
  ({ label: '', bg_color: '#f3f4f6', text_color: '#374151', group: withGroup ? 'otro' : undefined })

interface TaxonomyTabProps {
  domain:   TaxonomyDomain
  title:    string
  hint:     string
  newLabel: string
}

export function TaxonomyTab({ domain, hint, newLabel }: TaxonomyTabProps) {
  const fetcher = useCallback(() => taxonomiesApi.list(domain), [domain])
  const { items, setItems, loading, error, reload } = useConfigList<TaxonomyRow>(fetcher)
  const [drafts, setDrafts]     = useState<Record<string, Partial<TaxonomyRow>>>({})
  const showGroup = domain === 'OPERATIONAL_STATE'
  const [nuevo, setNuevo]       = useState<ReturnType<typeof emptyNew> | null>(null)
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)
  const fb = useRowFeedback()

  const visibles = items.filter(s => s.active)
  const merged = (row: TaxonomyRow) => ({ ...row, ...drafts[row.id] })
  const isDirty = (row: TaxonomyRow) => !!drafts[row.id] && Object.keys(drafts[row.id]).length > 0

  function setDraft(id: string, patch: Partial<TaxonomyRow>) {
    setDrafts(d => ({ ...d, [id]: { ...d[id], ...patch } }))
  }

  async function save(row: TaxonomyRow) {
    const draft = drafts[row.id]
    if (!draft) return
    await fb.run(row.id, async () => {
      const updated = await taxonomiesApi.patch(row.id, draft)
      setItems(prev => prev.map(r => (r.id === row.id ? updated : r)))
      setDrafts(d => { const n = { ...d }; delete n[row.id]; return n })
    })
  }

  async function move(idx: number, dir: -1 | 1) {
    const j = idx + dir
    const a = visibles[idx], b = visibles[j]
    if (!a || !b) return
    const aOrder = a.sort_order === b.sort_order ? j + 1 : b.sort_order
    const bOrder = a.sort_order === b.sort_order ? idx + 1 : a.sort_order
    setItems(prev => prev.map(r =>
      r.id === a.id ? { ...r, sort_order: aOrder } : r.id === b.id ? { ...r, sort_order: bOrder } : r,
    ).sort((x, y) => x.sort_order - y.sort_order))
    await fb.run(a.id, async () => {
      await taxonomiesApi.patch(a.id, { sort_order: aOrder })
      await taxonomiesApi.patch(b.id, { sort_order: bOrder })
    })
  }

  async function deactivate(row: TaxonomyRow) {
    if (!window.confirm(`¿Desactivar "${row.label}"? Dejará de aparecer como opción.`)) return
    await fb.run(row.id, async () => {
      await taxonomiesApi.deactivate(row.id)
      setItems(prev => prev.filter(r => r.id !== row.id))
    })
  }

  async function create() {
    if (!nuevo || !nuevo.label.trim()) { setCreateErr('El nombre es requerido'); return }
    setCreating(true); setCreateErr(null)
    try {
      const created = await taxonomiesApi.create({ domain, ...nuevo })
      setItems(prev => [...prev, created])
      setNuevo(null)
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : 'Error al crear')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="p-4 md:p-5 space-y-3">
      <p className="text-xs text-gray-400">{hint}</p>
      <LoadState loading={loading} error={error} onRetry={reload} />
      {!loading && !error && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[640px]">
              <thead>
                <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-wide border-b border-border">
                  <th className="py-2 pr-2 text-left w-8" aria-label="Orden" />
                  <th className="py-2 pr-3 text-left">Vista previa</th>
                  <th className="py-2 pr-3 text-left">Nombre</th>
                  <th className="py-2 pr-3 text-left">Color</th>
                  {showGroup && <th className="py-2 pr-3 text-left" title={GROUP_HINT}>Columna del tablero</th>}
                  <th className="py-2 text-right w-[120px]" aria-label="Acciones" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {visibles.map((row, idx) => {
                  const m = merged(row)
                  return (
                    <tr key={row.id} className={isDirty(row) ? 'bg-accent/[0.03]' : ''}>
                      <td className="py-2 pr-2">
                        <SortArrows name={row.label} onUp={() => move(idx, -1)} onDown={() => move(idx, 1)}
                          disabledUp={idx === 0} disabledDown={idx === visibles.length - 1} />
                      </td>
                      <td className="py-2 pr-3"><Badge label={m.label} bg={m.bg_color} text={m.text_color} /></td>
                      <td className="py-2 pr-3">
                        <input value={m.label} onChange={e => setDraft(row.id, { label: e.target.value })}
                          aria-label={`Nombre de ${row.label}`} className={INPUT + ' w-36'} />
                      </td>
                      <td className="py-2 pr-3">
                        <SwatchPicker name={row.label} bg={m.bg_color} text={m.text_color}
                          onPick={c => setDraft(row.id, { bg_color: c.bg, text_color: c.text })} />
                      </td>
                      {showGroup && (
                        <td className="py-2 pr-3">
                          <select value={m.group ?? 'otro'} onChange={e => setDraft(row.id, { group: e.target.value })}
                            aria-label={`Columna del tablero de ${row.label}`} title={GROUP_HINT} className={INPUT}>
                            {GROUP_OPTIONS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
                          </select>
                        </td>
                      )}
                      <td className="py-2 text-right whitespace-nowrap">
                        <SaveRowButton dirty={isDirty(row)} saving={fb.saving === row.id}
                          saved={!!fb.savedAt[row.id]} onClick={() => save(row)} />
                        <button type="button" onClick={() => deactivate(row)} aria-label={`Desactivar ${row.label}`}
                          className="ml-2 text-gray-300 hover:text-red-400 transition-colors align-middle">
                          <Trash2 size={13} />
                        </button>
                        {fb.errors[row.id] && <p className="text-[9px] text-red-500 mt-1">{fb.errors[row.id]}</p>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {nuevo ? (
            <div className="border border-accent/30 bg-accent/[0.03] rounded-xl p-3 space-y-2.5">
              <div className="flex items-center gap-3 flex-wrap">
                <input autoFocus value={nuevo.label} onChange={e => setNuevo({ ...nuevo, label: e.target.value })}
                  placeholder="Nombre" aria-label={`Nombre de ${newLabel} nuevo`} className={INPUT + ' w-44'} />
                <SwatchPicker name={`nuevo ${newLabel}`} bg={nuevo.bg_color} text={nuevo.text_color}
                  onPick={c => setNuevo({ ...nuevo, bg_color: c.bg, text_color: c.text })} />
                {showGroup && (
                  <select value={nuevo.group} onChange={e => setNuevo({ ...nuevo, group: e.target.value })}
                    aria-label={`Columna del tablero de ${newLabel} nuevo`} className={INPUT}>
                    {GROUP_OPTIONS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
                  </select>
                )}
                <Badge label={nuevo.label || 'Vista previa'} bg={nuevo.bg_color} text={nuevo.text_color} />
              </div>
              {createErr && <p className="text-[10px] text-red-500">{createErr}</p>}
              <div className="flex items-center gap-2">
                <button type="button" onClick={create} disabled={creating}
                  className="flex items-center gap-1.5 text-xs font-semibold text-white bg-accent hover:bg-accent/90 px-3 py-1.5 rounded-lg disabled:opacity-50">
                  {creating && <Loader2 size={12} className="animate-spin" />}
                  Crear
                </button>
                <button type="button" onClick={() => { setNuevo(null); setCreateErr(null) }}
                  className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setNuevo(emptyNew(showGroup))}
              className="flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent/80">
              <Plus size={13} /> Nuevo {newLabel}
            </button>
          )}
        </>
      )}
    </div>
  )
}

export const EstadosOperacionalesTab = () => (
  <TaxonomyTab
    domain="OPERATIONAL_STATE"
    title="Estados Operacionales"
    hint="Estados que operaciones asigna manualmente a un viaje (override). La columna del tablero define dónde cae la tarjeta al arrastrarla."
    newLabel="estado operacional"
  />
)
```

Actualizar el import al principio del archivo: agregar `taxonomiesApi, type TaxonomyRow` desde `@/lib/api/config`, y borrar el import de `configApi` si ya no se usa en este archivo (verificar que `EstadosTmsTab`, que sigue en el mismo archivo, no lo necesite — sí lo necesita, para `configApi.getStatuses`/`patchStatus`, así que el import de `configApi` se mantiene junto al de `taxonomiesApi`).

- [ ] **Paso 5: correr el test, confirmar que pasa**

Run: `npx vitest run app/dashboard/admin/configuracion/estados-tabs.test.tsx`
Expected: PASS (2 tests nuevos + los que ya existían para `EstadosOperacionalesTab`, si los había — revisar que sigan pasando con el wrapper nuevo)

- [ ] **Paso 6: typecheck + suite completa frontend**

Run: `npx tsc --noEmit && npx vitest run`
Expected: limpio

- [ ] **Paso 7: commit**

```bash
git add lib/api/config.ts app/dashboard/admin/configuracion/estados-tabs.tsx app/dashboard/admin/configuracion/estados-tabs.test.tsx
git commit -m "feat(config): componente genérico TaxonomyTab — reemplaza el cuerpo de EstadosOperacionalesTab"
```

---

## Tarea 7: Frontend — nuevo tab "Estados de Equipo" en Configuración

**Files:**
- Modify: `monitor-app/frontend/app/dashboard/admin/configuracion/estados-tabs.tsx` (agrega `EstadosEquipoTab`)
- Modify: `monitor-app/frontend/app/dashboard/admin/configuracion/page.tsx`

**Interfaces:**
- Consume: `TaxonomyTab` (Tarea 6).

- [ ] **Paso 1: agregar el wrapper** al final de `estados-tabs.tsx` (después de `EstadosOperacionalesTab`):

```tsx
export const EstadosEquipoTab = () => (
  <TaxonomyTab
    domain="EQUIPMENT_STATE"
    title="Estados de Equipo"
    hint="Motivo manual cuando un equipo/tracto activo no tiene viaje asignado hoy (en pana, en mantención, prestado, etc.)."
    newLabel="estado de equipo"
  />
)
```

- [ ] **Paso 2: cablear el tab en `page.tsx`**

```tsx
import { EstadosTmsTab, EstadosOperacionalesTab, EstadosEquipoTab } from './estados-tabs'
```

```tsx
type Tab = 'estados_tms' | 'estados_op' | 'estados_equipo' | 'alertas_monitor' | 'alertas' | 'rangos_temperatura'

const TABS: { key: Tab; label: string; desc: string }[] = [
  { key: 'estados_tms',        label: 'Estados TMS',            desc: 'Colores y columna del tablero' },
  { key: 'estados_op',         label: 'Estados Operacionales',  desc: 'Vocabulario del equipo' },
  { key: 'estados_equipo',     label: 'Estados de Equipo',      desc: 'Motivo cuando un equipo no sale hoy' },
  { key: 'alertas_monitor',    label: 'Alertas del Monitor',    desc: 'Umbrales operacionales' },
  { key: 'alertas',            label: 'Alertas de Vencimiento', desc: 'Documentos, en días' },
  { key: 'rangos_temperatura', label: 'Rangos de Temperatura',  desc: 'Por tipo de carga' },
]
```

```tsx
{tab === 'estados_op'         && <EstadosOperacionalesTab />}
{tab === 'estados_equipo'     && <EstadosEquipoTab />}
```

- [ ] **Paso 3: typecheck + suite completa frontend**

Run: `npx tsc --noEmit && npx vitest run`
Expected: limpio

- [ ] **Paso 4: verificación manual** (`/start-dev` o dev server ya corriendo) — entrar a `/dashboard/admin/configuracion`, confirmar que aparece el tab "Estados de Equipo" con las 6 semillas de la Tarea 1, y que "Estados Operacionales" se ve idéntico a antes.

- [ ] **Paso 5: commit**

```bash
git add app/dashboard/admin/configuracion/estados-tabs.tsx app/dashboard/admin/configuracion/page.tsx
git commit -m "feat(config): nuevo tab \"Estados de Equipo\" en Configuración"
```

---

## Tarea 8: Frontend — `CloseDayDialog.tsx`: hint de motivo sugerido

**Files:**
- Modify: `monitor-app/frontend/lib/types.ts` (`DriverDayStatusRow`)
- Modify: `monitor-app/frontend/components/dashboard/CloseDayDialog.tsx:172-184`
- Test: `monitor-app/frontend/components/dashboard/CloseDayDialog.test.tsx`

**Interfaces:**
- Consume: `driver_pending_docs_critical: boolean | null`, `suggested_reason_id: string | null` en cada fila de `DriverDayStatusRow` (Tarea 5, ya vienen del backend).

- [ ] **Paso 1: extender el tipo**

En `lib/types.ts`, dentro de `DriverDayStatusRow` (línea ~874), agregar 2 campos después de `client_names`:

```ts
export type DriverDayStatusRow = {
  driver_id:                  string
  full_name:                  string
  tax_id:                     string | null
  carrier_id:                  string | null
  carrier_name:                string | null
  status:                     DriverDayStatusValue
  unassigned_reason_id:        string | null
  unassigned_reason_label:     string | null
  resolved_by:                 string | null
  resolved_at:                 string | null
  client_names:                string[]
  /** Ronda 43: alerta de documentación vencida ya calculada — usada para
   *  sugerir un motivo en CloseDayDialog, no bloquea nada. */
  driver_pending_docs_critical: boolean | null
  suggested_reason_id:         string | null
}
```

- [ ] **Paso 2: escribir el test que falla**

Buscar el archivo de test existente de `CloseDayDialog` (`components/dashboard/CloseDayDialog.test.tsx` — si no existe, revisar cómo se testea hoy vía `app/dashboard/diario/page.test.tsx`, que es quien lo monta) y agregar:

```tsx
it('shows a clickable reason suggestion when the driver has a critical compliance alert and no reason yet', async () => {
  vi.mocked(dailyClosuresApi.get).mockResolvedValue({
    business_date: '2026-07-22', closed: false, closure: null,
    total_drivers: 1, assigned_count: 0, unassigned_count: 1, mismatch_count: 0, pending_count: 1,
    drivers: [{
      driver_id: 'd1', full_name: 'Juan Pérez', tax_id: null, carrier_id: null, carrier_name: null,
      status: 'UNASSIGNED', unassigned_reason_id: null, unassigned_reason_label: null,
      resolved_by: null, resolved_at: null, client_names: [],
      driver_pending_docs_critical: true, suggested_reason_id: 'r-doc-vencida',
    }],
  })
  render(
    <CloseDayDialog open fecha="2026-07-22" canAdmin
      unassignedReasons={[{ id: 'r-doc-vencida', label: 'Documentación vencida' }]}
      onClose={vi.fn()} />,
  )
  const hint = await screen.findByText('Sugerido: Documentación vencida')
  fireEvent.click(hint)
  await waitFor(() => expect(dailyClosuresApi.setReason).toHaveBeenCalledWith('d1', '2026-07-22', 'r-doc-vencida'))
})

it('does not show a suggestion when there is no critical compliance alert', async () => {
  vi.mocked(dailyClosuresApi.get).mockResolvedValue({
    business_date: '2026-07-22', closed: false, closure: null,
    total_drivers: 1, assigned_count: 0, unassigned_count: 1, mismatch_count: 0, pending_count: 1,
    drivers: [{
      driver_id: 'd1', full_name: 'Juan Pérez', tax_id: null, carrier_id: null, carrier_name: null,
      status: 'UNASSIGNED', unassigned_reason_id: null, unassigned_reason_label: null,
      resolved_by: null, resolved_at: null, client_names: [],
      driver_pending_docs_critical: false, suggested_reason_id: null,
    }],
  })
  render(
    <CloseDayDialog open fecha="2026-07-22" canAdmin unassignedReasons={[]} onClose={vi.fn()} />,
  )
  await screen.findByText('Juan Pérez')
  expect(screen.queryByText(/Sugerido:/)).not.toBeInTheDocument()
})
```

(Ajustar los imports/mocks de `dailyClosuresApi` al patrón real que ya use ese archivo de test — revisar `vi.mock('@/lib/api/dailyClosures', ...)` existente antes de escribir esto, para no duplicar un mock con forma distinta.)

- [ ] **Paso 3: correr los tests, confirmar que fallan**

Run: `npx vitest run components/dashboard/CloseDayDialog.test.tsx -t "reason suggestion"`
Expected: FAIL — `screen.findByText('Sugerido: Documentación vencida')` no encuentra nada todavía

- [ ] **Paso 4: agregar el hint en `CloseDayDialog.tsx`**

Reemplazar el bloque `{d.status === 'UNASSIGNED' && (...)}`(líneas 172-184) por:

```tsx
{d.status === 'UNASSIGNED' && (
  <>
    <select
      value={d.unassigned_reason_id ?? ''}
      disabled={savingReason === d.driver_id}
      onChange={e => handleSetReason(d.driver_id, e.target.value)}
      className="text-[11px] border border-border rounded-lg px-2 py-1 bg-white"
    >
      <option value="">— Sin especificar —</option>
      {unassignedReasons.map(r => (
        <option key={r.id} value={r.id}>{r.label}</option>
      ))}
    </select>
    {/* Ronda 43: sugerencia de UI, no un trigger de base de datos — el
        operador confirma con el click, no se escribe nada solo. */}
    {!d.unassigned_reason_id && d.driver_pending_docs_critical && d.suggested_reason_id && (
      <button
        type="button"
        onClick={() => handleSetReason(d.driver_id, d.suggested_reason_id!)}
        className="block text-[10px] text-amber-600 hover:text-amber-800 hover:underline mt-1"
      >
        Sugerido: {unassignedReasons.find(r => r.id === d.suggested_reason_id)?.label ?? 'Documentación vencida'}
      </button>
    )}
  </>
)}
```

- [ ] **Paso 5: correr los tests, confirmar que pasan**

Run: `npx vitest run components/dashboard/CloseDayDialog.test.tsx`
Expected: todos pasan

- [ ] **Paso 6: typecheck + suite completa frontend**

Run: `npx tsc --noEmit && npx vitest run`
Expected: limpio

- [ ] **Paso 7: commit**

```bash
git add lib/types.ts components/dashboard/CloseDayDialog.tsx components/dashboard/CloseDayDialog.test.tsx
git commit -m "feat(cuadratura): sugerencia de motivo en CloseDayDialog cuando hay documentación vencida"
```

---

## Tarea 9: Migración de limpieza — DROP de tablas viejas (diferida)

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260722050000_drop_legacy_taxonomy_tables.sql`

**No aplicar esta migración en el mismo pase que las Tareas 1-8.** Se escribe ahora para no perderla, pero se aplica solo después de:
1. Confirmar en producción, con datos reales, que nada quedó leyendo `app.operational_states`/`app.unassigned_reasons` directamente (grep final: `grep -rn "app.operational_states\|app.unassigned_reasons" monitor-app/backend/api/app` debe devolver 0 resultados una vez completadas las Tareas 2-5).
2. Confirmación explícita del usuario — mismo criterio que la Tarea 1.

- [ ] **Paso 1: escribir la migración**

```sql
-- Aplicar SOLO después de confirmar que ningún consumidor real (grep en
-- monitor-app/backend/api/app) sigue leyendo de estas 2 tablas — Tareas
-- 2-5 del plan de status_taxonomies ya las reemplazaron por completo.
DROP TABLE app.operational_states;
DROP TABLE app.unassigned_reasons;
```

- [ ] **Paso 2: commit (sin aplicar todavía)**

```bash
git add monitor-app/backend/supabase/migrations/20260722050000_drop_legacy_taxonomy_tables.sql
git commit -m "chore(config): migración de limpieza (DROP tablas legacy) — NO aplicada, diferida a confirmación"
```

---

## Verificación final

- [ ] Backend: `cd monitor-app/backend/api && venv/bin/python -m pytest -q` limpio.
- [ ] Frontend: `cd monitor-app/frontend && npx tsc --noEmit && npx vitest run` limpio.
- [ ] `npm run build` limpio en `monitor-app/frontend`.
- [ ] Manual: `/dashboard/admin/configuracion` — "Estados Operacionales" se ve idéntico a antes de este plan (regresión visual), "Estados de Equipo" es nuevo y funcional.
- [ ] Manual: abrir "Cerrar el día" con un conductor que tenga documentación vencida real (o mockear vía Supabase) y confirmar que aparece el hint "Sugerido: Documentación vencida", y que clickearlo guarda el motivo.
- [ ] Actualizar `AGENTLOG.md` (checkpoint de esta ronda) al terminar — regla de `CLAUDE.md`.
