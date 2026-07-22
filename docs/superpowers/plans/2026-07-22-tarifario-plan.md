# Tarifario 1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the "Tarifario 1.0" module — a new top-level page where users pick a generador de carga, see its locales (the same catalog Fase 4 built), and set a free-text tariff with a validity window per locale. No route/origin modeling, no coverage alerts, no numeric tariff logic — all explicitly cut from scope during brainstorming (see `docs/superpowers/specs/2026-07-22-tarifario-design.md`).

**Architecture:** A new `public.location_rates` table holds a time-series of tariffs per `public.locations` row (history preserved — every change is a new row, never an overwrite). The existing `app/routers/locations.py` gains an `include_rate` query param on `GET /locations` (resolves the currently-valid rate per location via `LEFT JOIN LATERAL`) plus a `/locations/{id}/rates` sub-resource (`GET` history, `POST` new period, `PATCH` correct without creating history). On the frontend, the "create a new locale" flow already built in Configuración → Locales gets extracted into a shared `LocationCreateForm` component so the new Tarifario page can reuse it verbatim instead of duplicating it.

**Tech Stack:** FastAPI + asyncpg (backend), Next.js 16 / React + Vitest + Testing Library (frontend), Supabase Postgres.

## Global Constraints

- `tarifa` is a free-text column, not numeric — this is a confirmed design decision (spec: *"es que el tarifario va a depender del contexto del viaje"*), not a placeholder for a future numeric type. Do not add validation, parsing, or numeric coercion to it.
- No alerts, no "missing tariff" detection, no origin/route modeling anywhere in this plan — explicitly out of scope.
- Every backend write endpoint uses `require_editor` (`monitor-app/backend/api/app/auth.py`), matching every other write endpoint in `locations.py`.
- Every migration must be dry-run (`BEGIN; ...; ROLLBACK;`) via the Supabase MCP tools before being applied for real via `apply_migration`, and the exact same SQL must be saved as a local file in `monitor-app/backend/supabase/migrations/` in the same task (this repo had a migration applied live but never committed earlier this session — do not repeat that).
- `cd monitor-app/backend/api && venv/bin/python -m pytest -q` and `cd monitor-app/frontend && npx tsc --noEmit && npx vitest run` must be clean at the end of every task.
- Supabase project ID for MCP calls: `viclzoftiudkepqnhekv`.

---

### Task 1: Migration — `public.location_rates`

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260722020000_location_rates.sql`

**Interfaces:**
- Produces: table `public.location_rates` with columns `id, location_id, tarifa, valid_from, valid_to, created_at, updated_at, created_by`. Consumed by Task 2 (backend endpoints).

- [ ] **Step 1: Write the migration file**

```sql
-- Fase 5 (HU-17, Tarifario 1.0, 2026-07-22): tarifa por local, con
-- vigencia. Tabla separada de public.locations (no columnas nuevas ahí) a
-- propósito — locations es consumida por el Diario y por el banner de
-- completitud de Fase 4, que no necesitan saber nada de tarifas ni de su
-- historial; mezclar ambos forzaría a esos consumidores a filtrar "fila
-- vigente" sin que les importe. Mismo patrón que carriers/drivers/assets
-- vs. compliance_records/insurance_policies (entidad descriptiva actual vs.
-- historial de eventos sobre esa entidad).
--
-- tarifa es texto libre a propósito, no numérico — la tarifa real depende
-- de contexto de viaje (tipo de carga, condiciones negociadas) que este
-- proyecto no modela; imponerle estructura numérica sería falsa precisión
-- (decisión explícita del usuario, ver
-- docs/superpowers/specs/2026-07-22-tarifario-design.md).
--
-- "Vigente" se calcula, no se almacena: valid_from <= hoy AND (valid_to IS
-- NULL OR valid_to >= hoy). Cada cambio de tarifa es una fila nueva — el
-- historial se preserva, nunca se pisa una fila existente.
CREATE TABLE public.location_rates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id),
  tarifa      text NOT NULL,
  valid_from  date NOT NULL DEFAULT CURRENT_DATE,
  valid_to    date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES public.profiles(id)
);

CREATE INDEX idx_location_rates_location ON public.location_rates (location_id, valid_from DESC);

ALTER TABLE public.location_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Location rates are viewable by authenticated users"
  ON public.location_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Location rates can be managed by authenticated users"
  ON public.location_rates FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Dry-run the migration**

Call `mcp__claude_ai_Supabase__execute_sql` with `project_id: viclzoftiudkepqnhekv` and the file's contents wrapped in `BEGIN; ... ROLLBACK;`. Confirm it runs with no errors. Then run this in the same dry-run transaction to sanity-check the shape end to end:

```sql
BEGIN;
-- (paste the CREATE TABLE/INDEX/RLS statements from Step 1 here)

INSERT INTO public.location_rates (location_id, tarifa, valid_from)
SELECT id, '450.000 CLP', CURRENT_DATE FROM public.locations LIMIT 1
RETURNING id, location_id, tarifa, valid_from, valid_to;

ROLLBACK;
```

Expected: the `INSERT ... RETURNING` returns exactly one row with `valid_to` NULL.

- [ ] **Step 3: Apply the migration for real**

Call `mcp__claude_ai_Supabase__apply_migration` with `project_id: viclzoftiudkepqnhekv`, `name: location_rates`, and the exact SQL from Step 1 (the file, not the dry-run wrapper).

- [ ] **Step 4: Verify it applied**

```sql
SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.location_rates'::regclass; -- expect empty, no triggers on this table
SELECT indexname FROM pg_indexes WHERE tablename = 'location_rates';
```

Expected: `idx_location_rates_location` present.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260722020000_location_rates.sql
git commit -m "feat(tarifario): migración public.location_rates (Fase 5)"
```

---

### Task 2: Backend — `location_rates` schema + endpoints

**Files:**
- Create: `monitor-app/backend/api/app/schemas/location_rate.py`
- Modify: `monitor-app/backend/api/app/routers/locations.py`
- Test: `monitor-app/backend/api/tests/test_locations.py`

**Interfaces:**
- Consumes: `public.location_rates` (Task 1), `log_change()` (`app/services/audit.py`, signature: `log_change(conn, *, actor, entity_type, entity_id, action, field=None, old_value=None, new_value=None, source="api")`).
- Produces: `GET /locations?include_rate=true` (adds `current_rate`/`current_rate_valid_from`/`current_rate_valid_to` to each row), `GET /locations/{id}/rates`, `POST /locations/{id}/rates`, `PATCH /locations/{id}/rates/{rate_id}`. Consumed by Task 3 (frontend API client).

- [ ] **Step 1: Write the failing tests**

Add to `monitor-app/backend/api/tests/test_locations.py`, right after the existing `test_list_locations_ignores_incomplete_when_not_true` test (keep `_location_row` as-is — it already accepts `**overrides` so `current_rate` etc. pass through untouched):

```python
def _location_rate_row(**overrides):
    base = {
        "id": "r1", "location_id": "loc-1", "tarifa": "450.000 CLP",
        "valid_from": "2026-07-22", "valid_to": None, "created_at": None, "updated_at": None,
    }
    base.update(overrides)
    return base


# ── HU-17 (Fase 5, Tarifario 1.0): GET ?include_rate= ────────────────────────

def test_list_locations_include_rate_joins_current_rate():
    pool = AsyncMock()
    pool.fetch.return_value = [_location_row(
        current_rate="450.000 CLP", current_rate_valid_from="2026-07-01", current_rate_valid_to=None,
    )]
    client = make_client(pool)

    res = client.get("/api/v1/locations?include_rate=true")

    assert res.status_code == 200
    assert res.json()[0]["current_rate"] == "450.000 CLP"
    query = pool.fetch.call_args.args[0]
    assert "public.location_rates" in query
    assert "current_rate" in query


def test_list_locations_omits_rate_join_by_default():
    pool = AsyncMock()
    pool.fetch.return_value = [_location_row()]
    client = make_client(pool)

    res = client.get("/api/v1/locations")

    assert res.status_code == 200
    query = pool.fetch.call_args.args[0]
    assert "public.location_rates" not in query


# ── GET/POST/PATCH /locations/{id}/rates ─────────────────────────────────────

def test_list_location_rates_orders_by_valid_from_desc():
    pool = AsyncMock()
    pool.fetch.return_value = [_location_rate_row()]
    client = make_client(pool)

    res = client.get("/api/v1/locations/loc-1/rates")

    assert res.status_code == 200
    assert res.json()[0]["tarifa"] == "450.000 CLP"
    query = pool.fetch.call_args.args[0]
    assert "ORDER BY valid_from DESC" in query


def test_create_location_rate_404_when_location_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = None
    client = make_client(pool)

    res = client.post("/api/v1/locations/loc-1/rates", json={"tarifa": "450.000 CLP"})

    assert res.status_code == 404


def test_create_location_rate_inserts_new_row():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.side_effect = [
        {"entity_type": "SHIPPER", "entity_id": "shipper-1"},
        _location_rate_row(),
    ]
    client = make_client(pool)

    res = client.post("/api/v1/locations/loc-1/rates", json={"tarifa": "450.000 CLP", "valid_from": "2026-07-22"})

    assert res.status_code == 201
    assert res.json()["tarifa"] == "450.000 CLP"
    insert_sql = conn.fetchrow.call_args_list[-1].args[0]
    assert "INSERT INTO public.location_rates" in insert_sql


def test_patch_location_rate_404_when_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = None
    client = make_client(pool)

    res = client.patch("/api/v1/locations/loc-1/rates/r1", json={"tarifa": "500.000 CLP"})

    assert res.status_code == 404


def test_patch_location_rate_no_fields_422():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.patch("/api/v1/locations/loc-1/rates/r1", json={})

    assert res.status_code == 422


def test_patch_location_rate_updates_without_creating_history():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.side_effect = [
        _location_rate_row(),
        {"entity_type": "SHIPPER", "entity_id": "shipper-1"},
    ]
    pool.fetchrow.return_value = _location_rate_row(tarifa="500.000 CLP")
    client = make_client(pool)

    res = client.patch("/api/v1/locations/loc-1/rates/r1", json={"tarifa": "500.000 CLP"})

    assert res.status_code == 200
    assert res.json()["tarifa"] == "500.000 CLP"
    update_sql = conn.execute.call_args_list[0].args[0]
    assert "UPDATE public.location_rates SET" in update_sql
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_locations.py -v
```

Expected: the 8 new tests FAIL (`ModuleNotFoundError` for `location_rate` schema, or 404/405 for the new routes not existing yet). The pre-existing tests in this file still PASS.

- [ ] **Step 3: Write the schema file**

```python
"""Pydantic schemas para public.location_rates — historial de tarifas por
local (Fase 5, Tarifario 1.0). `tarifa` es texto libre a propósito: la
tarifa real depende de contexto de viaje (tipo de carga, condiciones
negociadas) que este proyecto no modela — imponerle una estructura
numérica sería falsa precisión (decisión explícita del usuario, ver
docs/superpowers/specs/2026-07-22-tarifario-design.md)."""
from datetime import date
from typing import Optional

from pydantic import BaseModel, Field


class LocationRateCreateBody(BaseModel):
    tarifa: str
    valid_from: date = Field(default_factory=date.today)
    valid_to: Optional[date] = None


class LocationRatePatchBody(BaseModel):
    tarifa: Optional[str] = None
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None

    def sent_fields(self) -> list[str]:
        return [f for f in type(self).model_fields if getattr(self, f) is not None]
```

- [ ] **Step 4: Extend `app/routers/locations.py`**

Add the import at the top, alongside the existing schema import:

```python
from ..schemas.location import LocationCreateBody, LocationPatchBody
from ..schemas.location_rate import LocationRateCreateBody, LocationRatePatchBody
```

Add `include_rate` to `list_locations`'s signature (right after `incomplete`):

```python
    incomplete: str = Query("", description="true = solo locales sin clasificación (HU-16)"),
    include_rate: str = Query("", description="true = agrega la tarifa vigente (Fase 5, Tarifario 1.0)"),
    pool=Depends(get_pool),
```

Replace the function's final block (from `where = ...` to the `return`) with:

```python
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

    # Fase 5 (Tarifario 1.0): opt-in — el Diario y Configuración > Locales
    # no lo piden, sin cambio de comportamiento para ellos. "Vigente" se
    # calcula acá, no se almacena: valid_from <= hoy <= valid_to (o
    # valid_to NULL = vigente indefinidamente). public.locations.id (sin
    # alias) porque el FROM de esta consulta no alías la tabla.
    rate_select = ""
    rate_join = ""
    if include_rate == "true":
        rate_select = ", cr.tarifa AS current_rate, cr.valid_from AS current_rate_valid_from, cr.valid_to AS current_rate_valid_to"
        rate_join = """
            LEFT JOIN LATERAL (
                SELECT tarifa, valid_from, valid_to
                FROM public.location_rates lr
                WHERE lr.location_id = public.locations.id
                  AND lr.valid_from <= CURRENT_DATE
                  AND (lr.valid_to IS NULL OR lr.valid_to >= CURRENT_DATE)
                ORDER BY lr.valid_from DESC
                LIMIT 1
            ) cr ON true
        """

    rows = await pool.fetch(
        f"SELECT {_LOCATION_FIELDS}{rate_select} FROM public.locations {rate_join} {where} ORDER BY name",
        *params,
    )
    return [dict(r) for r in rows]


_LOCATION_RATE_FIELDS = "id, location_id, tarifa, valid_from, valid_to, created_at, updated_at"


@router.get("/{location_id}/rates")
async def list_location_rates(location_id: str, pool=Depends(get_pool), _=Depends(get_current_user)):
    rows = await pool.fetch(
        f"SELECT {_LOCATION_RATE_FIELDS} FROM public.location_rates "
        "WHERE location_id = $1 ORDER BY valid_from DESC",
        location_id,
    )
    return [dict(r) for r in rows]


@router.post("/{location_id}/rates", status_code=201)
async def create_location_rate(
    location_id: str, body: LocationRateCreateBody, pool=Depends(get_pool), user=Depends(require_editor),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            loc = await conn.fetchrow(
                "SELECT entity_type, entity_id FROM public.locations WHERE id = $1", location_id,
            )
            if not loc:
                raise HTTPException(404, "Local no encontrado")

            row = await conn.fetchrow(
                f"""
                INSERT INTO public.location_rates (location_id, tarifa, valid_from, valid_to, created_by)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING {_LOCATION_RATE_FIELDS}
                """,
                location_id, body.tarifa, body.valid_from, body.valid_to, user["sub"],
            )
            await log_change(
                conn, actor=user["sub"], entity_type=loc["entity_type"], entity_id=loc["entity_id"],
                action="create", field="location_rate", new_value=body.tarifa, source="api",
            )
    return dict(row)


@router.patch("/{location_id}/rates/{rate_id}")
async def patch_location_rate(
    location_id: str, rate_id: str, body: LocationRatePatchBody, pool=Depends(get_pool), user=Depends(require_editor),
):
    touched = body.sent_fields()
    if not touched:
        raise HTTPException(422, "Ningún campo enviado")

    async with pool.acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchrow(
                f"SELECT {_LOCATION_RATE_FIELDS} FROM public.location_rates "
                "WHERE id = $1 AND location_id = $2",
                rate_id, location_id,
            )
            if not current:
                raise HTTPException(404, "Tarifa no encontrada")

            loc = await conn.fetchrow(
                "SELECT entity_type, entity_id FROM public.locations WHERE id = $1", location_id,
            )

            await conn.execute(
                """
                UPDATE public.location_rates SET
                    tarifa     = COALESCE($2, tarifa),
                    valid_from = COALESCE($3, valid_from),
                    valid_to   = COALESCE($4, valid_to),
                    updated_at = NOW()
                WHERE id = $1
                """,
                rate_id, body.tarifa, body.valid_from, body.valid_to,
            )
            for field in touched:
                await log_change(
                    conn, actor=user["sub"], entity_type=loc["entity_type"], entity_id=loc["entity_id"],
                    action="update", field=f"location_rate.{field}",
                    old_value=str(current[field]) if current[field] is not None else None,
                    new_value=str(getattr(body, field)), source="api",
                )

    row = await pool.fetchrow(
        f"SELECT {_LOCATION_RATE_FIELDS} FROM public.location_rates WHERE id = $1", rate_id,
    )
    return dict(row)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_locations.py -v
```

Expected: all tests in this file PASS (the 10 pre-existing + 8 new = 18 total).

- [ ] **Step 6: Run the full backend suite**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest -q
```

Expected: all tests pass, no regressions in other routers.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/backend/api/app/schemas/location_rate.py \
        monitor-app/backend/api/app/routers/locations.py \
        monitor-app/backend/api/tests/test_locations.py
git commit -m "feat(tarifario): endpoints de location_rates + include_rate en GET /locations"
```

---

### Task 3: Frontend — types + API client

**Files:**
- Modify: `monitor-app/frontend/lib/types.ts`
- Modify: `monitor-app/frontend/lib/api/locations.ts`

**Interfaces:**
- Consumes: backend response shapes from Task 2 (`current_rate`/`current_rate_valid_from`/`current_rate_valid_to` on `Location`; `LocationRate` shape from the rates endpoints).
- Produces: `Location.current_rate`/`current_rate_valid_from`/`current_rate_valid_to` (optional fields), `LocationRate`, `LocationRateCreatePayload`, `LocationRatePatchPayload` types; `locationsApi.listRates(locationId)`, `.createRate(locationId, body)`, `.patchRate(locationId, rateId, body)`; `LocationListParams.include_rate`. Consumed by Task 4 (`LocationCreateForm` — no rate fields needed there) and Task 5 (Tarifario page — needs all of the above).

No test file — this task only adds types and thin API wrappers; `lib/api/locations.ts` has no existing test file (consistent with every other API client file in this codebase, all tested indirectly through the components that use them).

- [ ] **Step 1: Extend `Location` and add rate types in `lib/types.ts`**

Find the `Location` type (currently ends at `updated_at: string | null` before the closing brace) and change it to:

```typescript
export type Location = {
  id:                  string
  entity_type:         'SHIPPER'
  entity_id:           string
  site_number:         string | null
  name:                string
  country_code:        string
  format:              string | null
  address:             string | null
  region_name:         string | null
  region_number:       number | null
  opens_at:            string | null
  closes_at:           string | null
  operation_type:      string | null
  operational_status:  'ACTIVE' | 'INACTIVE'
  created_at:          string | null
  updated_at:          string | null
  /** Solo presentes cuando se pide ?include_rate=true (Fase 5, Tarifario
   *  1.0) — tarifa vigente resuelta en el momento de la consulta
   *  (valid_from <= hoy <= valid_to, o valid_to NULL). */
  current_rate?:                string | null
  current_rate_valid_from?:     string | null
  current_rate_valid_to?:       string | null
}

// ── Tarifario (public.location_rates, Fase 5) ──────────────────────────────
// tarifa es texto libre a propósito, no numérico — depende de contexto de
// viaje que este proyecto no modela (ver docs/superpowers/specs/
// 2026-07-22-tarifario-design.md).

export type LocationRate = {
  id:          string
  location_id: string
  tarifa:      string
  valid_from:  string
  valid_to:    string | null
  created_at:  string | null
  updated_at:  string | null
}

export type LocationRateCreatePayload = {
  tarifa:      string
  valid_from?: string
  valid_to?:   string | null
}

export type LocationRatePatchPayload = Partial<LocationRateCreatePayload>
```

- [ ] **Step 2: Extend `lib/api/locations.ts`**

Change the top import and `LocationListParams`:

```typescript
import type { Location, LocationCreatePayload, LocationPatchPayload, LocationRate, LocationRateCreatePayload, LocationRatePatchPayload } from '@/lib/types'
import { apiFetch } from './client'

export type LocationListParams = {
  entity_type?:         'SHIPPER' | ''
  entity_id?:            string
  q?:                     string
  operation_type?:        string
  operational_status?:   'ACTIVE' | 'INACTIVE' | ''
  /** HU-16 (Fase 4): solo locales sin clasificación — auto-registrados
   *  incompletos por trg_reconcile_new_trip_stop_location. */
  incomplete?:            boolean
  /** Fase 5 (Tarifario 1.0): agrega la tarifa vigente de cada local. */
  include_rate?:          boolean
}
```

In the `list` function body, add the new query param right after the `incomplete` line:

```typescript
    if (params?.incomplete)         qs.set('incomplete', 'true')
    if (params?.include_rate)       qs.set('include_rate', 'true')
    const suffix = qs.toString() ? `?${qs}` : ''
```

Add the three new methods to the `locationsApi` object, right after `patch`:

```typescript
  patch: (id: string, body: LocationPatchPayload) =>
    apiFetch<Location>(`/api/v1/locations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // ── Tarifario (Fase 5) ──────────────────────────────────────────────────

  listRates: (locationId: string) =>
    apiFetch<LocationRate[]>(`/api/v1/locations/${locationId}/rates`),

  createRate: (locationId: string, body: LocationRateCreatePayload) =>
    apiFetch<LocationRate>(`/api/v1/locations/${locationId}/rates`, { method: 'POST', body: JSON.stringify(body) }),

  patchRate: (locationId: string, rateId: string, body: LocationRatePatchPayload) =>
    apiFetch<LocationRate>(`/api/v1/locations/${locationId}/rates/${rateId}`, { method: 'PATCH', body: JSON.stringify(body) }),
```

- [ ] **Step 3: Verify it compiles**

```bash
cd monitor-app/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add monitor-app/frontend/lib/types.ts monitor-app/frontend/lib/api/locations.ts
git commit -m "feat(tarifario): tipos y cliente API de location_rates"
```

---

### Task 4: Frontend — extract `LocationCreateForm`, refactor Locales tab

**Files:**
- Create: `monitor-app/frontend/components/dashboard/LocationCreateForm.tsx`
- Create: `monitor-app/frontend/components/dashboard/LocationCreateForm.test.tsx`
- Modify: `monitor-app/frontend/app/dashboard/admin/configuracion/locales-tab.tsx`

**Interfaces:**
- Consumes: `locationsApi.create` (existing, `lib/api/locations.ts`), `Location` type (existing).
- Produces: `<LocationCreateForm shipperId={string} onCreated={(location: Location) => void} />`. Consumed by Task 5 (Tarifario page) and by the refactored `locales-tab.tsx` in this same task.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LocationCreateForm } from './LocationCreateForm'
import { locationsApi } from '@/lib/api/locations'
import type { Location } from '@/lib/types'

vi.mock('@/lib/api/locations', () => ({
  locationsApi: { create: vi.fn() },
}))

const CREATED: Location = {
  id: 'loc-1', entity_type: 'SHIPPER', entity_id: 'shipper-1', site_number: null,
  name: 'Local Nuevo', country_code: 'CL', format: null, address: null,
  region_name: null, region_number: null, opens_at: null, closes_at: null,
  operation_type: null, operational_status: 'ACTIVE', created_at: null, updated_at: null,
}

beforeEach(() => {
  vi.mocked(locationsApi.create).mockReset()
})

describe('LocationCreateForm', () => {
  it('shows only the trigger button until clicked', () => {
    render(<LocationCreateForm shipperId="shipper-1" onCreated={vi.fn()} />)
    expect(screen.getByText('Nuevo local')).toBeInTheDocument()
    expect(screen.queryByLabelText('Nombre del local nuevo')).not.toBeInTheDocument()
  })

  it('opens the form and requires a name before creating', () => {
    render(<LocationCreateForm shipperId="shipper-1" onCreated={vi.fn()} />)
    fireEvent.click(screen.getByText('Nuevo local'))
    fireEvent.click(screen.getByText('Crear local'))
    expect(screen.getByText('Nombre es requerido')).toBeInTheDocument()
    expect(locationsApi.create).not.toHaveBeenCalled()
  })

  it('creates the location and calls onCreated with the result', async () => {
    vi.mocked(locationsApi.create).mockResolvedValue(CREATED)
    const onCreated = vi.fn()
    render(<LocationCreateForm shipperId="shipper-1" onCreated={onCreated} />)
    fireEvent.click(screen.getByText('Nuevo local'))
    fireEvent.change(screen.getByLabelText('Nombre del local nuevo'), { target: { value: 'Local Nuevo' } })
    fireEvent.click(screen.getByText('Crear local'))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED))
    expect(locationsApi.create).toHaveBeenCalledWith(expect.objectContaining({
      entity_type: 'SHIPPER', entity_id: 'shipper-1', name: 'Local Nuevo',
    }))
  })

  it('closes the form back to the trigger after a successful create', async () => {
    vi.mocked(locationsApi.create).mockResolvedValue(CREATED)
    render(<LocationCreateForm shipperId="shipper-1" onCreated={vi.fn()} />)
    fireEvent.click(screen.getByText('Nuevo local'))
    fireEvent.change(screen.getByLabelText('Nombre del local nuevo'), { target: { value: 'Local Nuevo' } })
    fireEvent.click(screen.getByText('Crear local'))
    await waitFor(() => expect(screen.getByText('Nuevo local')).toBeInTheDocument())
  })

  it('shows an error and keeps the form open when create fails', async () => {
    vi.mocked(locationsApi.create).mockRejectedValue(new Error('Ya existe un local con ese nombre'))
    render(<LocationCreateForm shipperId="shipper-1" onCreated={vi.fn()} />)
    fireEvent.click(screen.getByText('Nuevo local'))
    fireEvent.change(screen.getByLabelText('Nombre del local nuevo'), { target: { value: 'Local Nuevo' } })
    fireEvent.click(screen.getByText('Crear local'))
    expect(await screen.findByText('Ya existe un local con ese nombre')).toBeInTheDocument()
  })

  it('cancel button clears the draft and returns to the trigger', () => {
    render(<LocationCreateForm shipperId="shipper-1" onCreated={vi.fn()} />)
    fireEvent.click(screen.getByText('Nuevo local'))
    fireEvent.click(screen.getByText('Cancelar'))
    expect(screen.getByText('Nuevo local')).toBeInTheDocument()
  })
})
```

Save this as `monitor-app/frontend/components/dashboard/LocationCreateForm.test.tsx`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/LocationCreateForm.test.tsx
```

Expected: FAIL — `Cannot find module './LocationCreateForm'`.

- [ ] **Step 3: Write the component**

```tsx
'use client'

import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import type { Location } from '@/lib/types'
import { locationsApi } from '@/lib/api/locations'

const OPERATION_TYPE_OPTIONS = ['RM', 'Z0', 'Region Norte', 'Region Sur']

const EMPTY_LOCATION = {
  name: '', site_number: '', format: '', address: '',
  region_name: '', operation_type: '',
}

const INPUT = 'text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all'

interface Props {
  shipperId: string
  onCreated: (location: Location) => void
}

/** Alta de local — extraído de Configuración > Locales (Fase 4) para
 *  reusarlo tal cual en Tarifario (Fase 5), que también necesita poder
 *  crear locales nuevos sin salir de su pantalla (spec
 *  2026-07-22-tarifario-design.md: "el motor de update de public.locations
 *  también y al tarifario"). */
export function LocationCreateForm({ shipperId, onCreated }: Props) {
  const [nuevo, setNuevo]         = useState<typeof EMPTY_LOCATION | null>(null)
  const [creating, setCreating]   = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)

  async function create() {
    if (!nuevo || !nuevo.name.trim() || !shipperId) {
      setCreateErr('Nombre es requerido'); return
    }
    setCreating(true); setCreateErr(null)
    try {
      const created = await locationsApi.create({
        entity_type: 'SHIPPER', entity_id: shipperId, name: nuevo.name,
        site_number: nuevo.site_number || null, format: nuevo.format || null,
        address: nuevo.address || null, region_name: nuevo.region_name || null,
        operation_type: nuevo.operation_type || null,
      })
      onCreated(created)
      setNuevo(null)
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : 'Error al crear')
    } finally {
      setCreating(false)
    }
  }

  if (!nuevo) {
    return (
      <button type="button" onClick={() => setNuevo(EMPTY_LOCATION)}
        className="flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent/80">
        <Plus size={13} /> Nuevo local
      </button>
    )
  }

  return (
    <div className="border border-accent/30 bg-accent/[0.03] rounded-xl p-3 space-y-2.5 max-w-2xl">
      <div className="flex items-center gap-2 flex-wrap">
        <input autoFocus value={nuevo.name} onChange={e => setNuevo({ ...nuevo, name: e.target.value })}
          placeholder="Nombre del local" aria-label="Nombre del local nuevo" className={INPUT + ' w-40'} />
        <input value={nuevo.site_number} onChange={e => setNuevo({ ...nuevo, site_number: e.target.value })}
          placeholder="N° Local (opcional)" aria-label="N° de local nuevo" className={INPUT + ' w-28'} />
        <input value={nuevo.address} onChange={e => setNuevo({ ...nuevo, address: e.target.value })}
          placeholder="Dirección" aria-label="Dirección del local nuevo" className={INPUT + ' w-48'} />
        <select value={nuevo.operation_type} onChange={e => setNuevo({ ...nuevo, operation_type: e.target.value })}
          aria-label="Clasificación del local nuevo" className={INPUT + ' w-32'}>
          <option value="">Sin clasificar</option>
          {OPERATION_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      {createErr && <p className="text-[10px] text-red-500">{createErr}</p>}
      <div className="flex items-center gap-2">
        <button type="button" onClick={create} disabled={creating}
          className="flex items-center gap-1.5 text-xs font-semibold text-white bg-accent hover:bg-accent/90 px-3 py-1.5 rounded-lg disabled:opacity-50">
          {creating && <Loader2 size={12} className="animate-spin" />}
          Crear local
        </button>
        <button type="button" onClick={() => { setNuevo(null); setCreateErr(null) }}
          className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/LocationCreateForm.test.tsx
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Refactor `locales-tab.tsx` to use the extracted component**

In `monitor-app/frontend/app/dashboard/admin/configuracion/locales-tab.tsx`:

1. Change the import line from:
```typescript
import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import type { Location } from '@/lib/types'
import { locationsApi, shippersApi, type Shipper } from '@/lib/api/locations'
import { INPUT, LoadState, SaveRowButton, useConfigList, useRowFeedback } from './shared'

const OPERATION_TYPE_OPTIONS = ['RM', 'Z0', 'Region Norte', 'Region Sur']

const EMPTY_LOCATION = {
  name: '', site_number: '', format: '', address: '',
  region_name: '', operation_type: '',
}
```
to:
```typescript
import { useCallback, useEffect, useState } from 'react'
import type { Location } from '@/lib/types'
import { locationsApi, shippersApi, type Shipper } from '@/lib/api/locations'
import { INPUT, LoadState, SaveRowButton, useConfigList, useRowFeedback } from './shared'
import { LocationCreateForm } from '@/components/dashboard/LocationCreateForm'

// OPERATION_TYPE_OPTIONS se mantiene acá (además de en LocationCreateForm)
// porque esta tabla la usa para el selector de clasificación por FILA
// existente, un caso de uso distinto del formulario de alta — duplicar un
// array de 4 strings es más barato que forzar un import cruzado para algo
// tan chico.
const OPERATION_TYPE_OPTIONS = ['RM', 'Z0', 'Region Norte', 'Region Sur']
```

2. Remove the entire `nuevo`/`creating`/`createErr` state block and the `create()` function (the block that reads, in the current file):
```typescript
  const [nuevo, setNuevo]         = useState<typeof EMPTY_LOCATION | null>(null)
  const [creating, setCreating]   = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)
```
and:
```typescript
  async function create() {
    if (!nuevo || !nuevo.name.trim() || !shipperId) {
      setCreateErr('Nombre es requerido'); return
    }
    setCreating(true); setCreateErr(null)
    try {
      const created = await locationsApi.create({
        entity_type: 'SHIPPER', entity_id: shipperId, name: nuevo.name,
        site_number: nuevo.site_number || null, format: nuevo.format || null,
        address: nuevo.address || null, region_name: nuevo.region_name || null,
        operation_type: nuevo.operation_type || null,
      })
      setItems(prev => [...prev, created])
      setNuevo(null)
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : 'Error al crear')
    } finally {
      setCreating(false)
    }
  }
```

3. Replace the JSX ternary block at the bottom (from `{nuevo ? (` through the closing `)}` of the "+ Nuevo local" button) with:
```tsx
              <LocationCreateForm shipperId={shipperId} onCreated={created => setItems(prev => [...prev, created])} />
```

- [ ] **Step 6: Verify the refactor compiles and nothing regressed**

```bash
cd monitor-app/frontend && npx tsc --noEmit
```

Expected: no errors (confirms no leftover references to `nuevo`/`creating`/`createErr`/`EMPTY_LOCATION`/unused `Plus`/`Loader2` imports).

```bash
cd monitor-app/frontend && npx vitest run
```

Expected: all existing tests still pass, plus the 6 new `LocationCreateForm` tests.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/frontend/components/dashboard/LocationCreateForm.tsx \
        monitor-app/frontend/components/dashboard/LocationCreateForm.test.tsx \
        monitor-app/frontend/app/dashboard/admin/configuracion/locales-tab.tsx
git commit -m "refactor(locales): extrae LocationCreateForm para reusar en Tarifario"
```

---

### Task 5: Frontend — Sidebar nav item + Tarifario page

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/Sidebar.tsx`
- Create: `monitor-app/frontend/app/dashboard/tarifario/page.tsx`
- Create: `monitor-app/frontend/app/dashboard/tarifario/page.test.tsx`

**Interfaces:**
- Consumes: `locationsApi.list({..., include_rate: true})`, `locationsApi.createRate` (Task 3), `LocationCreateForm` (Task 4), `useConfigList`/`useRowFeedback`/`LoadState`/`SaveRowButton`/`INPUT` (`../admin/configuracion/shared`, unchanged).
- Produces: `/dashboard/tarifario` route, reachable from the Sidebar.

- [ ] **Step 1: Add the Sidebar nav item**

In `monitor-app/frontend/components/dashboard/Sidebar.tsx`, change the icon import:
```typescript
import {
  Truck, Building2, Users, LogOut,
  ChevronLeft, ChevronRight, ChevronDown, Shield, Settings, BarChart3, Receipt,
} from 'lucide-react'
```

And add the item to `NAV_ITEMS`:
```typescript
const NAV_ITEMS = [
  { href: '/dashboard/transportistas', label: 'Empresas',  icon: Building2 },
  { href: '/dashboard/seguros',        label: 'Seguros',   icon: Shield },
  { href: '/dashboard/tarifario',      label: 'Tarifario', icon: Receipt },
]
```

`MOBILE_NAV_ITEMS` already spreads `...NAV_ITEMS`, so it picks this up with no further change.

- [ ] **Step 2: Write the failing page test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TarifarioPage from './page'
import { locationsApi, shippersApi } from '@/lib/api/locations'
import type { Location, Shipper } from '@/lib/types'

vi.mock('@/lib/api/locations', () => ({
  locationsApi: { list: vi.fn(), create: vi.fn(), createRate: vi.fn(), patchRate: vi.fn(), listRates: vi.fn() },
  shippersApi: { list: vi.fn() },
}))

const SHIPPER: Shipper = { id: 'shipper-1', name: 'Walmart', status: 'ACTIVE' }
const LOCATION: Location = {
  id: 'loc-1', entity_type: 'SHIPPER', entity_id: 'shipper-1', site_number: '72',
  name: 'Alameda', country_code: 'CL', format: null, address: null, region_name: null,
  region_number: null, opens_at: null, closes_at: null, operation_type: 'RM',
  operational_status: 'ACTIVE', created_at: null, updated_at: null,
  current_rate: null, current_rate_valid_from: null, current_rate_valid_to: null,
}

beforeEach(() => {
  vi.mocked(shippersApi.list).mockReset().mockResolvedValue([SHIPPER])
  vi.mocked(locationsApi.list).mockReset().mockResolvedValue([LOCATION])
  vi.mocked(locationsApi.createRate).mockReset()
  vi.mocked(locationsApi.create).mockReset()
})

async function selectShipper() {
  render(<TarifarioPage />)
  fireEvent.change(await screen.findByLabelText('Generador de carga'), { target: { value: 'shipper-1' } })
  await screen.findByText('Alameda')
}

describe('TarifarioPage', () => {
  it('prompts to pick a generador de carga before showing anything', async () => {
    render(<TarifarioPage />)
    await screen.findByText('Elegí un generador de carga para ver sus locales.')
  })

  it('lists locations for the selected shipper with include_rate requested', async () => {
    await selectShipper()
    expect(locationsApi.list).toHaveBeenCalledWith({ entity_type: 'SHIPPER', entity_id: 'shipper-1', include_rate: true })
  })

  it('saving a tariff calls createRate, not patch, and reloads the list', async () => {
    vi.mocked(locationsApi.createRate).mockResolvedValue({
      id: 'r1', location_id: 'loc-1', tarifa: '450.000 CLP', valid_from: '2026-07-22', valid_to: null,
      created_at: null, updated_at: null,
    })
    await selectShipper()

    fireEvent.change(screen.getByLabelText('Tarifa de Alameda'), { target: { value: '450.000 CLP' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(locationsApi.createRate).toHaveBeenCalledWith('loc-1', {
      tarifa: '450.000 CLP', valid_from: undefined, valid_to: null,
    }))
    expect(locationsApi.patchRate).not.toHaveBeenCalled()
    await waitFor(() => expect(locationsApi.list).toHaveBeenCalledTimes(2))
  })

  it('lets the user create a new local from the same page', async () => {
    vi.mocked(locationsApi.create).mockResolvedValue({ ...LOCATION, id: 'loc-2', name: 'Local Nuevo' })
    await selectShipper()

    fireEvent.click(screen.getByText('Nuevo local'))
    fireEvent.change(screen.getByLabelText('Nombre del local nuevo'), { target: { value: 'Local Nuevo' } })
    fireEvent.click(screen.getByText('Crear local'))

    await waitFor(() => expect(screen.getByText('Local Nuevo')).toBeInTheDocument())
  })
})
```

Save as `monitor-app/frontend/app/dashboard/tarifario/page.test.tsx`.

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd monitor-app/frontend && npx vitest run app/dashboard/tarifario/page.test.tsx
```

Expected: FAIL — `Cannot find module './page'`.

- [ ] **Step 4: Write the page**

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Location } from '@/lib/types'
import { locationsApi, shippersApi, type Shipper } from '@/lib/api/locations'
import { LocationCreateForm } from '@/components/dashboard/LocationCreateForm'
import { INPUT, LoadState, SaveRowButton, useConfigList, useRowFeedback } from '../admin/configuracion/shared'

type RateDraft = { tarifa: string; valid_from: string; valid_to: string }

const emptyDraft = (loc: Location): RateDraft => ({
  tarifa: loc.current_rate ?? '',
  valid_from: loc.current_rate_valid_from ?? '',
  valid_to: loc.current_rate_valid_to ?? '',
})

/** Tarifario 1.0 (Fase 5, HU-17) — spec
 *  docs/superpowers/specs/2026-07-22-tarifario-design.md. Sin lógica de
 *  rutas/origen ni alertas de cobertura (recortado explícitamente por el
 *  usuario durante el brainstorming) — solo tarifa (texto libre) + vigencia
 *  por local, sobre el mismo catálogo que Configuración > Locales (Fase 4).
 *  También puede crear locales nuevos ("el motor de update de
 *  public.locations también y al tarifario"). */
export default function TarifarioPage() {
  const [shippers, setShippers]   = useState<Shipper[]>([])
  const [shipperId, setShipperId] = useState('')

  useEffect(() => { shippersApi.list().then(setShippers).catch(() => setShippers([])) }, [])

  const fetcher = useCallback(
    () => (shipperId
      ? locationsApi.list({ entity_type: 'SHIPPER', entity_id: shipperId, include_rate: true })
      : Promise.resolve([])),
    [shipperId],
  )
  const { items, setItems, loading, error, reload } = useConfigList<Location>(fetcher)
  const [drafts, setDrafts] = useState<Record<string, RateDraft>>({})
  const fb = useRowFeedback()

  const draftFor = (loc: Location) => drafts[loc.id] ?? emptyDraft(loc)
  const isDirty = (loc: Location) => {
    const d = drafts[loc.id]
    if (!d) return false
    const base = emptyDraft(loc)
    return d.tarifa !== base.tarifa || d.valid_from !== base.valid_from || d.valid_to !== base.valid_to
  }

  function setDraft(loc: Location, patch: Partial<RateDraft>) {
    setDrafts(d => ({ ...d, [loc.id]: { ...draftFor(loc), ...patch } }))
  }

  async function save(loc: Location) {
    const d = draftFor(loc)
    if (!d.tarifa.trim()) return
    await fb.run(loc.id, async () => {
      await locationsApi.createRate(loc.id, {
        tarifa: d.tarifa,
        valid_from: d.valid_from || undefined,
        valid_to: d.valid_to || null,
      })
      setDrafts(dr => { const n = { ...dr }; delete n[loc.id]; return n })
      reload()
    })
  }

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div>
        <h1 className="text-lg font-bold text-text-primary">Tarifario</h1>
        <p className="text-xs text-gray-400 mt-1">
          Tarifa por local, con vigencia — texto libre a propósito (depende del contexto de cada viaje, sin cálculo automático en esta versión).
        </p>
      </div>

      <select
        value={shipperId}
        onChange={e => setShipperId(e.target.value)}
        aria-label="Generador de carga"
        className={INPUT + ' w-56'}
      >
        <option value="">Seleccionar generador de carga…</option>
        {shippers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      {!shipperId && (
        <p className="text-xs text-gray-300 italic py-4">Elegí un generador de carga para ver sus locales.</p>
      )}

      {shipperId && (
        <>
          <LoadState loading={loading} error={error} onRetry={reload} />
          {!loading && !error && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[760px]">
                  <thead>
                    <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-wide border-b border-border">
                      <th className="py-2 pr-3 text-left">N° Local</th>
                      <th className="py-2 pr-3 text-left">Nombre</th>
                      <th className="py-2 pr-3 text-left">Tarifa vigente</th>
                      <th className="py-2 pr-3 text-left">Válido desde</th>
                      <th className="py-2 pr-3 text-left">Válido hasta</th>
                      <th className="py-2 text-right w-[100px]" aria-label="Acciones" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {items.map(loc => {
                      const d = draftFor(loc)
                      const dirty = isDirty(loc)
                      return (
                        <tr key={loc.id} className={dirty ? 'bg-accent/[0.03]' : ''}>
                          <td className="py-2.5 pr-3 font-mono text-gray-500">{loc.site_number ?? '—'}</td>
                          <td className="py-2.5 pr-3">{loc.name}</td>
                          <td className="py-2.5 pr-3">
                            <input value={d.tarifa} onChange={e => setDraft(loc, { tarifa: e.target.value })}
                              placeholder="Ej. 450.000 CLP" aria-label={`Tarifa de ${loc.name}`} className={INPUT + ' w-32'} />
                          </td>
                          <td className="py-2.5 pr-3">
                            <input type="date" value={d.valid_from} onChange={e => setDraft(loc, { valid_from: e.target.value })}
                              aria-label={`Válido desde de ${loc.name}`} className={INPUT + ' w-36'} />
                          </td>
                          <td className="py-2.5 pr-3">
                            <input type="date" value={d.valid_to} onChange={e => setDraft(loc, { valid_to: e.target.value })}
                              aria-label={`Válido hasta de ${loc.name}`} className={INPUT + ' w-36'} />
                          </td>
                          <td className="py-2.5 text-right whitespace-nowrap">
                            <SaveRowButton dirty={dirty} saving={fb.saving === loc.id}
                              saved={!!fb.savedAt[loc.id]} onClick={() => save(loc)} />
                            {fb.errors[loc.id] && <p className="text-[9px] text-red-500 mt-1">{fb.errors[loc.id]}</p>}
                          </td>
                        </tr>
                      )
                    })}
                    {items.length === 0 && (
                      <tr><td colSpan={6} className="py-4 text-center text-gray-300 italic">Sin locales para este generador de carga</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <LocationCreateForm shipperId={shipperId} onCreated={created => setItems(prev => [...prev, created])} />
            </>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd monitor-app/frontend && npx vitest run app/dashboard/tarifario/page.test.tsx
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/components/dashboard/Sidebar.tsx \
        monitor-app/frontend/app/dashboard/tarifario/page.tsx \
        monitor-app/frontend/app/dashboard/tarifario/page.test.tsx
git commit -m "feat(tarifario): página Tarifario 1.0 + ítem de Sidebar"
```

---

### Task 6: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Full backend suite**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest -q
```

Expected: all tests pass (297 pre-existing + 8 new from Task 2 = 305).

- [ ] **Step 2: Full frontend suite + typecheck**

```bash
cd monitor-app/frontend && npx tsc --noEmit && npx vitest run
```

Expected: no type errors; all tests pass (486 pre-existing + 6 `LocationCreateForm` + 4 `TarifarioPage` = 496).

- [ ] **Step 3: Production build**

```bash
cd monitor-app/frontend && npm run build
```

Expected: succeeds, `/dashboard/tarifario` listed in the route output.

- [ ] **Step 4: Update `AGENTLOG.md`**

Per `CLAUDE.md`'s standing rule, before this task is considered done: overwrite `AGENTLOG.md` with a new round describing Fase 5 (Tarifario 1.0) — what was built, that HU-17's original route/origin/alert scope was explicitly cut by the user during brainstorming, and that this closes the last phase of the post-refinamiento roadmap (Fases 0-5 all complete as of this round). Archive the previous round to `AGENTLOG_ARCHIVE.md` first, per the same rule (`AGENTLOG_ARCHIVE.md` is gitignored, `AGENTLOG.md` is not).
