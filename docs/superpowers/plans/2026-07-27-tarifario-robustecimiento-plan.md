# Robustecer Tarifario — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-clasificar RM/Zona Cero/Región Norte/Región Sur para los locales de `public.locations` usando la región que ya reporta el TMS (`app.trip_stops.destination_region`), y rediseñar la pantalla de Tarifario para que no dependa de elegir un generador de carga primero.

**Architecture:** Backend: una función SQL única de clasificación (`app.classify_operation_type`) usada por un backfill de una sola vez y por el trigger existente de auto-registro de locales, más un patrón `is_manual_override` para que las correcciones a mano no se pisen. Frontend: `TarifarioPage` pasa de "selector de generador → tabla" a dos tabs ("Por revisar" / "Todos los locales") sin gate, con el generador de carga como filtro opcional dentro de "Todos los locales" y como campo dentro del formulario de creación.

**Tech Stack:** FastAPI + asyncpg (backend), Next.js + React Query (frontend), Supabase Postgres, pytest, vitest.

## Global Constraints

- Fuente de la spec: `docs/superpowers/specs/2026-07-27-tarifario-robustecimiento-design.md`. No reabrir el alcance recortado de `docs/superpowers/specs/2026-07-22-tarifario-design.md` (tarifa en texto libre, sin rutas, sin alertas de cobertura).
- Mapeo de regiones confirmado por el usuario: RM = región 13. Zona Cero = regiones 5, 6, 7. Región Norte = regiones 1, 2, 3, 4, 15. Región Sur = regiones 8, 9, 10, 11, 12, 14, 16.
- "Por revisar" es únicamente sobre clasificación de zona (`operation_type IS NULL`) — no sobre otros campos incompletos (formato/dirección).
- Backend venv: `monitor-app/backend/api/venv` (no `.venv`, no Python de Anaconda). Comando: `./venv/bin/python -m pytest tests/ -v`.
- Frontend: `npm run test` (vitest) y `npx tsc --noEmit` desde `monitor-app/frontend`.
- Cualquier endpoint de escritura en `config.py`/`status_taxonomies.py` invalida la cache de `/trips/meta` — este plan no toca esos archivos, no aplica acá.

---

### Task 1: Migración — clasificación automática de locales

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260727100000_locations_auto_classification.sql`

**Interfaces:**
- Produce: función `app.classify_operation_type(smallint) RETURNS text`, columnas `public.locations.is_manual_override boolean`, `public.locations.overridden_by uuid`, `public.locations.overridden_at timestamptz`.

- [ ] **Step 1: Escribir la migración completa**

```sql
-- Robustecer Tarifario (2026-07-27): clasificación automática RM/Zona
-- Cero/Región Norte/Región Sur desde la región que ya reporta el TMS en
-- cada parada (app.trip_stops.destination_region), en vez de un
-- diccionario de comunas manual. Ver
-- docs/superpowers/specs/2026-07-27-tarifario-robustecimiento-design.md
-- para el hallazgo completo (240 de 262 locales sin clasificar ya tienen
-- región disponible en su historial de viajes).

ALTER TABLE public.locations
  ADD COLUMN is_manual_override boolean NOT NULL DEFAULT false,
  ADD COLUMN overridden_by      uuid REFERENCES public.profiles(id),
  ADD COLUMN overridden_at      timestamptz;

-- Única fuente de verdad de la regla de clasificación — la usan el
-- backfill de abajo y el trigger de auto-registro de locales.
CREATE OR REPLACE FUNCTION app.classify_operation_type(p_region_number smallint)
RETURNS text AS $$
  SELECT CASE
    WHEN p_region_number = 13 THEN 'RM'
    WHEN p_region_number IN (5, 6, 7) THEN 'Z0'
    WHEN p_region_number IN (1, 2, 3, 4, 15) THEN 'Region Norte'
    WHEN p_region_number IN (8, 9, 10, 11, 12, 14, 16) THEN 'Region Sur'
    ELSE NULL
  END;
$$ LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp;

-- Backfill único: para cada local activo sin clasificar, busca la región
-- más frecuente entre sus paradas históricas (cruce por nombre, mismo
-- criterio de match que ya usa el trigger de auto-registro) y aplica la
-- regla. is_manual_override queda false — son inferencias automáticas.
WITH inferred AS (
  SELECT DISTINCT ON (l.id)
    l.id AS location_id,
    ts.destination_region::smallint AS region_number
  FROM public.locations l
  JOIN app.trip_stops ts ON lower(trim(ts.local)) = lower(l.name)
  JOIN app.trips t ON t.id = ts.trip_id
  WHERE l.operation_type IS NULL
    AND l.operational_status = 'ACTIVE'
    AND ts.destination_region IS NOT NULL
    AND ts.destination_region ~ '^\d+$'
  GROUP BY l.id, ts.destination_region
  ORDER BY l.id, count(*) DESC
)
UPDATE public.locations l
SET region_number = i.region_number,
    operation_type = app.classify_operation_type(i.region_number),
    updated_at = now()
FROM inferred i
WHERE l.id = i.location_id
  AND app.classify_operation_type(i.region_number) IS NOT NULL;

-- Extiende el trigger existente (20260722010000): además de registrar un
-- local nuevo, lo clasifica de una si la parada que lo originó ya trae
-- región. Si el local ya existe y sigue sin clasificar, lo completa con
-- la primera parada que traiga región — sin pisar nunca un
-- is_manual_override = true.
CREATE OR REPLACE FUNCTION app.reconcile_new_trip_stop_location()
RETURNS TRIGGER AS $$
DECLARE
    v_shipper_id uuid;
    v_region_number smallint;
    v_operation_type text;
BEGIN
    IF NEW.stop_type IS DISTINCT FROM 'DESTINATION' OR NEW.local IS NULL OR trim(NEW.local) = '' THEN
        RETURN NEW;
    END IF;

    SELECT sh.id INTO v_shipper_id
    FROM app.trips t
    JOIN public.shippers sh ON lower(trim(sh.name)) = lower(trim(t.client_name)) AND sh.status = 'ACTIVE'
    WHERE t.id = NEW.trip_id;

    IF v_shipper_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.destination_region ~ '^\d+$' THEN
        v_region_number := NEW.destination_region::smallint;
        v_operation_type := app.classify_operation_type(v_region_number);
    END IF;

    INSERT INTO public.locations (entity_type, entity_id, name, region_name, region_number, operation_type, operational_status)
    VALUES ('SHIPPER', v_shipper_id, trim(NEW.local), NEW.destination_region, v_region_number, v_operation_type, 'ACTIVE')
    ON CONFLICT (entity_type, entity_id, lower(name), site_number) DO UPDATE SET
        region_number  = COALESCE(public.locations.region_number, EXCLUDED.region_number),
        operation_type = COALESCE(public.locations.operation_type, EXCLUDED.operation_type),
        updated_at     = now()
    WHERE public.locations.operation_type IS NULL AND NOT public.locations.is_manual_override;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = app, public, pg_temp;
```

- [ ] **Step 2: Aplicar la migración contra Supabase (proyecto `viclzoftiudkepqnhekv`)**

Usar el MCP de Supabase (`execute_sql` o `apply_migration`) o el flujo habitual del proyecto. Antes de aplicar, correr el `SELECT` de conteo de abajo para tener el "antes":

```sql
select count(*) filter (where operation_type is null) as sin_clasificar
from public.locations where operational_status = 'ACTIVE';
```

- [ ] **Step 3: Verificar el resultado contra datos reales**

```sql
select count(*) filter (where operation_type is null) as sin_clasificar,
       count(*) filter (where operation_type is not null and not is_manual_override) as auto_clasificados
from public.locations where operational_status = 'ACTIVE';
```

Esperado: `sin_clasificar` baja de 262 a ~22 (el residual sin ningún viaje histórico — el número exacto puede variar levemente si hubo viajes nuevos desde el diseño). Si `sin_clasificar` no baja, revisar que `ts.destination_region` realmente tenga valores numéricos para esos locales antes de seguir (no asumir, consultar).

- [ ] **Step 4: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260727100000_locations_auto_classification.sql
git commit -m "feat(locations): clasificar RM/Zona Cero automáticamente desde destination_region"
```

---

### Task 2: Backend — exponer clasificación automática y override manual

**Files:**
- Modify: `monitor-app/backend/api/app/routers/locations.py:18-22` (`_LOCATION_FIELDS`), `:236-281` (`patch_location`), `:25-107` (`list_locations`)
- Test: `monitor-app/backend/api/tests/test_locations.py`

**Interfaces:**
- Consumes: columnas `is_manual_override`, `overridden_by`, `overridden_at` de Task 1.
- Produces: `GET /locations` acepta `needs_manual_classification=true`; respuesta de locations incluye `is_manual_override`; `PATCH /locations/{id}` con `operation_type` en el body marca `is_manual_override=true`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `monitor-app/backend/api/tests/test_locations.py` (junto a `_location_row`, que ya existe):

```python
def test_list_locations_filters_needs_manual_classification():
    pool = AsyncMock()
    pool.fetch.return_value = []
    pool.fetchval.return_value = 0
    client = make_client(pool)

    res = client.get("/api/v1/locations?needs_manual_classification=true")

    assert res.status_code == 200
    query = pool.fetch.call_args.args[0]
    assert "operation_type IS NULL" in query
    assert "region_number IS NULL" in query


def test_patch_location_operation_type_marks_manual_override():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = _location_row(operation_type=None, is_manual_override=False)
    pool.fetchrow.return_value = _location_row(operation_type="Z0", is_manual_override=True)
    client = make_client(pool)

    res = client.patch("/api/v1/locations/loc-1", json={"operation_type": "Z0"})

    assert res.status_code == 200
    update_sql = conn.execute.call_args_list[0].args[0]
    assert "is_manual_override = true" in update_sql
    assert "overridden_by" in update_sql


def test_patch_location_other_fields_do_not_touch_override():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = _location_row()
    pool.fetchrow.return_value = _location_row(address="Nueva dirección")
    client = make_client(pool)

    res = client.patch("/api/v1/locations/loc-1", json={"address": "Nueva dirección"})

    assert res.status_code == 200
    update_sql = conn.execute.call_args_list[0].args[0]
    assert "is_manual_override" not in update_sql
```

Actualizar `_location_row` (línea ~20) para que acepte `is_manual_override` en los overrides con default `False`:

```python
def _location_row(**overrides):
    base = {
        "id": "loc-1", "entity_type": "SHIPPER", "entity_id": "shipper-1",
        "site_number": "72", "name": "Alameda", "country_code": "CL",
        "format": "Express", "address": "Av. Alameda 123", "region_name": "RM. Metropolitana",
        "region_number": 13, "opens_at": None, "closes_at": None, "operation_type": "RM",
        "operational_status": "ACTIVE", "is_manual_override": False,
        "created_at": None, "updated_at": None,
    }
    base.update(overrides)
    return base
```

- [ ] **Step 2: Correr los tests nuevos y confirmar que fallan**

Run: `cd monitor-app/backend/api && ./venv/bin/python -m pytest tests/test_locations.py -v -k "needs_manual_classification or manual_override"`
Expected: FAIL (columna/filtro no existen todavía en el router).

- [ ] **Step 3: Implementar en `locations.py`**

`_LOCATION_FIELDS` (línea 18):
```python
_LOCATION_FIELDS = (
    "id, entity_type, entity_id, site_number, name, country_code, format, address, "
    "region_name, region_number, opens_at, closes_at, operation_type, "
    "operational_status, is_manual_override, created_at, updated_at"
)
```

En `list_locations`, agregar el parámetro y el filtro (junto al bloque `incomplete`, línea ~59-65):
```python
    needs_manual_classification: str = Query("", description="true = sin región disponible, requiere elegir zona a mano"),
```
y en el cuerpo:
```python
    if needs_manual_classification == "true":
        clauses.append("operation_type IS NULL AND region_number IS NULL")
```

En `patch_location` (línea 236), después de calcular `touched` y antes del `UPDATE`:
```python
    manual_override = "operation_type" in touched
```
Extender el `UPDATE` para setear los 3 campos de override cuando corresponde — usar `CASE` para no bifurcar la query:
```python
            await conn.execute(
                """
                UPDATE public.locations SET
                    name               = COALESCE($2, name),
                    site_number        = COALESCE($3, site_number),
                    country_code       = COALESCE($4, country_code),
                    format             = COALESCE($5, format),
                    address            = COALESCE($6, address),
                    region_name        = COALESCE($7, region_name),
                    region_number      = COALESCE($8, region_number),
                    opens_at           = COALESCE($9, opens_at),
                    closes_at          = COALESCE($10, closes_at),
                    operation_type     = COALESCE($11, operation_type),
                    operational_status = COALESCE($12, operational_status),
                    is_manual_override = CASE WHEN $13 THEN true ELSE is_manual_override END,
                    overridden_by      = CASE WHEN $13 THEN $14 ELSE overridden_by END,
                    overridden_at      = CASE WHEN $13 THEN NOW() ELSE overridden_at END,
                    updated_at         = NOW()
                WHERE id = $1
                """,
                location_id, body.name, body.site_number, body.country_code, body.format,
                body.address, body.region_name, body.region_number, body.opens_at, body.closes_at,
                body.operation_type, body.operational_status, manual_override, user["sub"],
            )
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `./venv/bin/python -m pytest tests/test_locations.py -v`
Expected: PASS (todos, incluidos los 3 nuevos).

- [ ] **Step 5: Correr la suite completa del backend**

Run: `./venv/bin/python -m pytest -q`
Expected: PASS, ningún test existente roto.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api/app/routers/locations.py monitor-app/backend/api/tests/test_locations.py
git commit -m "feat(locations): filtro needs_manual_classification + override manual en PATCH"
```

---

### Task 3: Frontend — tipos y cliente API

**Files:**
- Modify: `monitor-app/frontend/lib/types.ts` (tipo `Location`, línea ~372-392)
- Modify: `monitor-app/frontend/lib/api/locations.ts`

**Interfaces:**
- Consumes: forma de respuesta de `GET /locations` de Task 2 (agrega `is_manual_override`).
- Produces: `Location.is_manual_override: boolean`; `locationsApi.list()` acepta `needs_manual_classification?: boolean`.

- [ ] **Step 1: Actualizar el tipo `Location`**

En `lib/types.ts`, agregar el campo junto a `operational_status` (línea ~386):
```typescript
  operational_status:  'ACTIVE' | 'INACTIVE'
  is_manual_override:  boolean
  created_at:          string | null
```

- [ ] **Step 2: Actualizar `locationsApi.list` en `lib/api/locations.ts`**

En `LocationListParams` (línea ~4-19), agregar:
```typescript
  /** Robustecer Tarifario (2026-07-27): locales sin ninguna región
   *  disponible en su historial de viajes — el residual real que necesita
   *  elección manual, distinto de `incomplete` (que incluye todo lo que
   *  no tiene operation_type, aunque ya se pueda auto-clasificar). */
  needs_manual_classification?: boolean
```

En la función `list` (línea ~35-48), agregar:
```typescript
    if (params?.needs_manual_classification) qs.set('needs_manual_classification', 'true')
```

- [ ] **Step 3: Verificar tipos**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: sin errores (ningún consumidor existente rompe — el campo nuevo es aditivo).

- [ ] **Step 4: Commit**

```bash
git add monitor-app/frontend/lib/types.ts monitor-app/frontend/lib/api/locations.ts
git commit -m "feat(locations): tipos y cliente para is_manual_override / needs_manual_classification"
```

---

### Task 4: Frontend — extraer `LocationsTable` de `page.tsx`

**Files:**
- Create: `monitor-app/frontend/components/dashboard/LocationsTable.tsx`
- Create: `monitor-app/frontend/components/dashboard/LocationsTable.test.tsx`
- Modify: `monitor-app/frontend/app/dashboard/tarifario/page.tsx` (se reescribe completo en Task 6 — en este task queda como único consumidor temporal, sin cambiar su comportamiento)

**Interfaces:**
- Consumes: `Location[]`, `locationsApi.patch`, `locationsApi.createRate` (de `lib/api/locations`).
- Produces: componente `LocationsTable` con props `{ items: Location[]; onChanged: () => void }` — sin filtro de shipper interno, sin fetching propio (recibe los items ya cargados por el padre).

Este task es una extracción pura (mover código, no cambiar comportamiento) — la tabla completa de "Todos los locales" que hoy vive inline en `page.tsx` (líneas 197-282: helpers `RowDraft`/`emptyDraft`/`draftFor`/`isDirty`/`setDraft`/`save`/`toggleActive` + el JSX de la tabla) pasa a este componente tal cual, parametrizado por `items` y `onChanged` en vez de leer `listQuery`/`invalidate` directo.

- [ ] **Step 1: Escribir el test (mismo comportamiento que ya cubría `page.test.tsx`, ahora aislado)**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LocationsTable } from './LocationsTable'
import { locationsApi } from '@/lib/api/locations'
import type { Location } from '@/lib/types'

vi.mock('@/lib/api/locations', () => ({
  locationsApi: { patch: vi.fn(), createRate: vi.fn() },
}))

const LOCATION: Location = {
  id: 'loc-1', entity_type: 'SHIPPER', entity_id: 'shipper-1', site_number: '72',
  name: 'Alameda', country_code: 'CL', format: null, address: null, region_name: null,
  region_number: null, opens_at: null, closes_at: null, operation_type: 'RM',
  operational_status: 'ACTIVE', is_manual_override: false, created_at: null, updated_at: null,
  current_rate: null, current_rate_valid_from: null, current_rate_valid_to: null,
}

beforeEach(() => {
  vi.mocked(locationsApi.patch).mockReset()
  vi.mocked(locationsApi.createRate).mockReset()
})

describe('LocationsTable', () => {
  it('renders one row per location', () => {
    render(<LocationsTable items={[LOCATION]} onChanged={vi.fn()} />)
    expect(screen.getByDisplayValue('Alameda')).toBeInTheDocument()
  })

  it('saving a tariff calls createRate, not patch', async () => {
    vi.mocked(locationsApi.createRate).mockResolvedValue({
      id: 'r1', location_id: 'loc-1', tarifa: '450.000 CLP', valid_from: '2026-07-27', valid_to: null,
      created_at: null, updated_at: null,
    })
    const onChanged = vi.fn()
    render(<LocationsTable items={[LOCATION]} onChanged={onChanged} />)

    fireEvent.change(screen.getByLabelText('Tarifa de Alameda'), { target: { value: '450.000 CLP' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(locationsApi.createRate).toHaveBeenCalledWith('loc-1', {
      tarifa: '450.000 CLP', valid_from: undefined, valid_to: null,
    }))
    expect(locationsApi.patch).not.toHaveBeenCalled()
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('editing clasificación calls patch, not createRate', async () => {
    vi.mocked(locationsApi.patch).mockResolvedValue({ ...LOCATION, operation_type: 'Z0' })
    render(<LocationsTable items={[LOCATION]} onChanged={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Clasificación de Alameda'), { target: { value: 'Z0' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(locationsApi.patch).toHaveBeenCalledWith('loc-1', {
      name: 'Alameda', format: null, address: null, operation_type: 'Z0',
    }))
    expect(locationsApi.createRate).not.toHaveBeenCalled()
  })

  it('toggling Activo/Inactivo calls patch immediately', async () => {
    vi.mocked(locationsApi.patch).mockResolvedValue({ ...LOCATION, operational_status: 'INACTIVE' })
    render(<LocationsTable items={[LOCATION]} onChanged={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('Desactivar Alameda'))

    await waitFor(() => expect(locationsApi.patch).toHaveBeenCalledWith('loc-1', { operational_status: 'INACTIVE' }))
  })

  it('shows "auto" tag next to classification when not manually overridden', () => {
    render(<LocationsTable items={[LOCATION]} onChanged={vi.fn()} />)
    expect(screen.getByText('auto')).toBeInTheDocument()
  })

  it('does not show "auto" tag when classification was manually overridden', () => {
    render(<LocationsTable items={[{ ...LOCATION, is_manual_override: true }]} onChanged={vi.fn()} />)
    expect(screen.queryByText('auto')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/LocationsTable.test.tsx`
Expected: FAIL (`LocationsTable` no existe todavía).

- [ ] **Step 3: Crear `LocationsTable.tsx`**

Mover el bloque de `page.tsx` (helpers `RowDraft`/`emptyDraft`/`draftFor`/`isDirty`/`setDraft`/`save`/`toggleActive` + tabla, líneas 16-34 y 87-282 actuales) a este archivo nuevo, adaptando:
- Recibe `{ items, onChanged }: { items: Location[]; onChanged: () => void }` en vez de leer `listQuery`.
- `save`/`toggleActive` llaman `onChanged()` en vez de `invalidate()`.
- Se agrega una columna/tag "auto" junto a "Clasificación": `{!loc.is_manual_override && loc.operation_type && <span className="text-[9px] text-gray-400 ml-1">auto</span>}`.

```typescript
'use client'

import { useState } from 'react'
import type { Location } from '@/lib/types'
import { locationsApi } from '@/lib/api/locations'
import { INPUT, SaveRowButton, useRowFeedback } from '@/app/dashboard/admin/configuracion/shared'

const OPERATION_TYPE_OPTIONS = ['RM', 'Z0', 'Region Norte', 'Region Sur']

type RowDraft = {
  name: string
  format: string
  address: string
  operation_type: string
  tarifa: string
  valid_from: string
  valid_to: string
}

const emptyDraft = (loc: Location): RowDraft => ({
  name: loc.name,
  format: loc.format ?? '',
  address: loc.address ?? '',
  operation_type: loc.operation_type ?? '',
  tarifa: loc.current_rate ?? '',
  valid_from: loc.current_rate_valid_from ?? '',
  valid_to: loc.current_rate_valid_to ?? '',
})

export function LocationsTable({ items, onChanged }: { items: Location[]; onChanged: () => void }) {
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({})
  const fb = useRowFeedback()

  const draftFor = (loc: Location) => drafts[loc.id] ?? emptyDraft(loc)
  const isDirty = (loc: Location) => {
    const d = drafts[loc.id]
    if (!d) return false
    const base = emptyDraft(loc)
    return d.name !== base.name || d.format !== base.format || d.address !== base.address
      || d.operation_type !== base.operation_type
      || d.tarifa !== base.tarifa || d.valid_from !== base.valid_from || d.valid_to !== base.valid_to
  }

  function setDraft(loc: Location, patch: Partial<RowDraft>) {
    setDrafts(d => ({ ...d, [loc.id]: { ...draftFor(loc), ...patch } }))
  }

  async function save(loc: Location) {
    const d = draftFor(loc)
    const base = emptyDraft(loc)
    await fb.run(loc.id, async () => {
      const locationChanged = d.name !== base.name || d.format !== base.format
        || d.address !== base.address || d.operation_type !== base.operation_type
      if (locationChanged) {
        await locationsApi.patch(loc.id, {
          name: d.name, format: d.format || null, address: d.address || null,
          operation_type: d.operation_type || null,
        })
      }
      const rateChanged = d.tarifa !== base.tarifa || d.valid_from !== base.valid_from || d.valid_to !== base.valid_to
      if (rateChanged && d.tarifa.trim()) {
        await locationsApi.createRate(loc.id, {
          tarifa: d.tarifa, valid_from: d.valid_from || undefined, valid_to: d.valid_to || null,
        })
      }
      setDrafts(dr => { const n = { ...dr }; delete n[loc.id]; return n })
      onChanged()
    })
  }

  async function toggleActive(loc: Location) {
    const next = loc.operational_status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    await fb.run(loc.id, async () => {
      await locationsApi.patch(loc.id, { operational_status: next })
      onChanged()
    })
  }

  return (
    <div className="bg-white border border-border rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[1080px]">
        <thead>
          <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-wide border-b border-border bg-gray-50">
            <th className="py-2.5 px-3 text-left">N° Local</th>
            <th className="py-2.5 px-3 text-left">Nombre</th>
            <th className="py-2.5 px-3 text-left">Formato</th>
            <th className="py-2.5 px-3 text-left">Dirección</th>
            <th className="py-2.5 px-3 text-left">Región</th>
            <th className="py-2.5 px-3 text-left">Clasificación</th>
            <th className="py-2.5 px-3 text-left">Activo</th>
            <th className="py-2.5 px-3 text-left">Tarifa vigente</th>
            <th className="py-2.5 px-3 text-left">Válido desde</th>
            <th className="py-2.5 px-3 text-left">Válido hasta</th>
            <th className="py-2.5 px-3 text-right w-[100px]" aria-label="Acciones" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {items.map(loc => {
            const d = draftFor(loc)
            const dirty = isDirty(loc)
            const incomplete = !loc.operation_type
            return (
              <tr key={loc.id} className={`hover:bg-gray-50/60 transition-colors ${dirty ? 'bg-accent/[0.03]' : incomplete ? 'bg-amber-50/50' : ''}`}>
                <td className="py-2.5 px-3 font-mono text-gray-500">{loc.site_number ?? '—'}</td>
                <td className="py-2.5 px-3">
                  <input value={d.name} onChange={e => setDraft(loc, { name: e.target.value })}
                    aria-label={`Nombre de ${loc.name}`} className={INPUT + ' w-36'} />
                </td>
                <td className="py-2.5 px-3">
                  <input value={d.format} onChange={e => setDraft(loc, { format: e.target.value })}
                    aria-label={`Formato de ${loc.name}`} className={INPUT + ' w-24'} />
                </td>
                <td className="py-2.5 px-3">
                  <input value={d.address} onChange={e => setDraft(loc, { address: e.target.value })}
                    aria-label={`Dirección de ${loc.name}`} className={INPUT + ' w-40'} />
                </td>
                <td className="py-2.5 px-3 text-gray-500 max-w-[100px] truncate">{loc.region_name ?? '—'}</td>
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-1">
                    <select value={d.operation_type}
                      onChange={e => setDraft(loc, { operation_type: e.target.value })}
                      aria-label={`Clasificación de ${loc.name}`} className={INPUT + ' w-28'}>
                      <option value="">Sin clasificar</option>
                      {OPERATION_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    {!loc.is_manual_override && loc.operation_type && (
                      <span className="text-[9px] text-gray-400">auto</span>
                    )}
                  </div>
                </td>
                <td className="py-2.5 px-3">
                  <button type="button" onClick={() => toggleActive(loc)}
                    aria-label={`${loc.operational_status === 'ACTIVE' ? 'Desactivar' : 'Activar'} ${loc.name}`}
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      loc.operational_status === 'ACTIVE'
                        ? 'bg-green-50 text-green-600 border border-green-100'
                        : 'bg-gray-50 text-gray-400 border border-gray-100'
                    }`}>
                    {loc.operational_status === 'ACTIVE' ? 'Activo' : 'Inactivo'}
                  </button>
                </td>
                <td className="py-2.5 px-3">
                  <input value={d.tarifa} onChange={e => setDraft(loc, { tarifa: e.target.value })}
                    placeholder="Ej. 450.000 CLP" aria-label={`Tarifa de ${loc.name}`} className={INPUT + ' w-32'} />
                </td>
                <td className="py-2.5 px-3">
                  <input type="date" value={d.valid_from} onChange={e => setDraft(loc, { valid_from: e.target.value })}
                    aria-label={`Válido desde de ${loc.name}`} className={INPUT + ' w-36'} />
                </td>
                <td className="py-2.5 px-3">
                  <input type="date" value={d.valid_to} onChange={e => setDraft(loc, { valid_to: e.target.value })}
                    aria-label={`Válido hasta de ${loc.name}`} className={INPUT + ' w-36'} />
                </td>
                <td className="py-2.5 px-3 text-right whitespace-nowrap">
                  <SaveRowButton dirty={dirty} saving={fb.saving === loc.id}
                    saved={!!fb.savedAt[loc.id]} onClick={() => save(loc)} />
                  {fb.errors[loc.id] && <p className="text-[9px] text-red-500 mt-1">{fb.errors[loc.id]}</p>}
                </td>
              </tr>
            )
          })}
          {items.length === 0 && (
            <tr><td colSpan={11} className="py-4 text-center text-gray-300 italic">Sin locales para este filtro</td></tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `npx vitest run components/dashboard/LocationsTable.test.tsx`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/LocationsTable.tsx monitor-app/frontend/components/dashboard/LocationsTable.test.tsx
git commit -m "refactor(tarifario): extraer LocationsTable como componente independiente"
```

---

### Task 5: Frontend — `LocationCreateForm` con selector de generador adentro

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/LocationCreateForm.tsx`
- Modify: `monitor-app/frontend/components/dashboard/LocationCreateForm.test.tsx`

**Interfaces:**
- Consumes: `Shipper[]` (de `lib/api/locations`).
- Produces: `LocationCreateForm` con props `{ shippers: Shipper[]; onCreated: (loc: Location) => void }` (antes `{ shipperId: string; onCreated }`) — ya no depende de que el padre haya elegido un generador.

- [ ] **Step 1: Actualizar los tests existentes al nuevo contrato**

Reemplazar cada `render(<LocationCreateForm shipperId="shipper-1" onCreated={...} />)` en `LocationCreateForm.test.tsx` por:
```typescript
const SHIPPERS = [{ id: 'shipper-1', name: 'Walmart', status: 'ACTIVE' }]
// ...
render(<LocationCreateForm shippers={SHIPPERS} onCreated={onCreated} />)
```
y agregar, antes del `fireEvent.change` del nombre en cada test que crea un local:
```typescript
fireEvent.change(screen.getByLabelText('Generador de carga del local nuevo'), { target: { value: 'shipper-1' } })
```

Agregar un test nuevo:
```typescript
it('requires a generador de carga before creating', () => {
  render(<LocationCreateForm shippers={SHIPPERS} onCreated={vi.fn()} />)
  fireEvent.click(screen.getByText('Nuevo local'))
  fireEvent.change(screen.getByLabelText('Nombre del local nuevo'), { target: { value: 'Local Nuevo' } })
  fireEvent.click(screen.getByText('Crear local'))
  expect(screen.getByText('Elegí un generador de carga')).toBeInTheDocument()
  expect(locationsApi.create).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run components/dashboard/LocationCreateForm.test.tsx`
Expected: FAIL (prop `shippers` no existe todavía, `shipperId` sigue siendo requerido).

- [ ] **Step 3: Reescribir `LocationCreateForm.tsx`**

```typescript
'use client'

import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import type { Location } from '@/lib/types'
import { locationsApi, type Shipper } from '@/lib/api/locations'

const OPERATION_TYPE_OPTIONS = ['RM', 'Z0', 'Region Norte', 'Region Sur']

const EMPTY_LOCATION = {
  shipperId: '', name: '', site_number: '', format: '', address: '',
  region_name: '', operation_type: '',
}

const INPUT = 'text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all'

interface Props {
  shippers: Shipper[]
  onCreated: (location: Location) => void
}

/** Alta de local — el generador de carga se elige adentro del formulario
 *  (Robustecer Tarifario, 2026-07-27) en vez de depender de un filtro de
 *  página, para que "+ Nuevo local" quede visible siempre, no solo con un
 *  generador ya elegido. */
export function LocationCreateForm({ shippers, onCreated }: Props) {
  const [nuevo, setNuevo]         = useState<typeof EMPTY_LOCATION | null>(null)
  const [creating, setCreating]   = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)

  async function create() {
    if (!nuevo || !nuevo.name.trim()) {
      setCreateErr('Nombre es requerido'); return
    }
    if (!nuevo.shipperId) {
      setCreateErr('Elegí un generador de carga'); return
    }
    setCreating(true); setCreateErr(null)
    try {
      const created = await locationsApi.create({
        entity_type: 'SHIPPER', entity_id: nuevo.shipperId, name: nuevo.name,
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
        <select value={nuevo.shipperId} onChange={e => setNuevo({ ...nuevo, shipperId: e.target.value })}
          aria-label="Generador de carga del local nuevo" className={INPUT + ' w-40'}>
          <option value="">Generador de carga…</option>
          {shippers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
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

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run components/dashboard/LocationCreateForm.test.tsx`
Expected: PASS (6/6, incluido el nuevo).

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/LocationCreateForm.tsx monitor-app/frontend/components/dashboard/LocationCreateForm.test.tsx
git commit -m "feat(locations): selector de generador de carga adentro de Nuevo local"
```

---

### Task 6: Frontend — `LocationsPendingTab` (triage)

**Files:**
- Create: `monitor-app/frontend/components/dashboard/LocationsPendingTab.tsx`
- Create: `monitor-app/frontend/components/dashboard/LocationsPendingTab.test.tsx`

**Interfaces:**
- Consumes: `Location[]` con `needs_manual_classification=true`, `locationsApi.patch`.
- Produces: componente `LocationsPendingTab` con props `{ items: Location[]; shipperName: (entityId: string) => string; onChanged: () => void }` — tarjetas simples, sin tabla de 10 columnas.

- [ ] **Step 1: Escribir el test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LocationsPendingTab } from './LocationsPendingTab'
import { locationsApi } from '@/lib/api/locations'
import type { Location } from '@/lib/types'

vi.mock('@/lib/api/locations', () => ({
  locationsApi: { patch: vi.fn() },
}))

const LOCATION: Location = {
  id: 'loc-9', entity_type: 'SHIPPER', entity_id: 'shipper-1', site_number: null,
  name: 'Empresas Carozzi S.A.', country_code: 'CL', format: null, address: null,
  region_name: null, region_number: null, opens_at: null, closes_at: null,
  operation_type: null, operational_status: 'ACTIVE', is_manual_override: false,
  created_at: null, updated_at: null,
}

beforeEach(() => {
  vi.mocked(locationsApi.patch).mockReset()
})

describe('LocationsPendingTab', () => {
  it('shows one card per pending location with its generador de carga', () => {
    render(<LocationsPendingTab items={[LOCATION]} shipperName={() => 'Iansa'} onChanged={vi.fn()} />)
    expect(screen.getByText('Empresas Carozzi S.A.')).toBeInTheDocument()
    expect(screen.getByText('Iansa')).toBeInTheDocument()
  })

  it('shows an empty state when there is nothing pending', () => {
    render(<LocationsPendingTab items={[]} shipperName={() => ''} onChanged={vi.fn()} />)
    expect(screen.getByText(/Sin locales por revisar/)).toBeInTheDocument()
  })

  it('classifying a card calls patch with the chosen zone and refreshes', async () => {
    vi.mocked(locationsApi.patch).mockResolvedValue({ ...LOCATION, operation_type: 'Z0' })
    const onChanged = vi.fn()
    render(<LocationsPendingTab items={[LOCATION]} shipperName={() => 'Iansa'} onChanged={onChanged} />)

    fireEvent.change(screen.getByLabelText(`Clasificar ${LOCATION.name}`), { target: { value: 'Z0' } })

    await waitFor(() => expect(locationsApi.patch).toHaveBeenCalledWith('loc-9', { operation_type: 'Z0' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `npx vitest run components/dashboard/LocationsPendingTab.test.tsx`
Expected: FAIL (`LocationsPendingTab` no existe).

- [ ] **Step 3: Crear `LocationsPendingTab.tsx`**

```typescript
'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { Location } from '@/lib/types'
import { locationsApi } from '@/lib/api/locations'

const OPERATION_TYPE_OPTIONS = ['RM', 'Z0', 'Region Norte', 'Region Sur']

/** Tab "Por revisar" (Robustecer Tarifario, 2026-07-27) — solo locales sin
 *  ninguna región disponible en su historial de viajes (needs_manual_
 *  classification=true del backend). Todo lo demás se auto-clasifica solo
 *  y nunca llega acá — ver docs/superpowers/specs/2026-07-27-tarifario-
 *  robustecimiento-design.md. */
export function LocationsPendingTab({
  items, shipperName, onChanged,
}: {
  items: Location[]
  shipperName: (entityId: string) => string
  onChanged: () => void
}) {
  const [saving, setSaving] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function classify(loc: Location, operationType: string) {
    if (!operationType) return
    setSaving(loc.id)
    setErrors(e => { const n = { ...e }; delete n[loc.id]; return n })
    try {
      await locationsApi.patch(loc.id, { operation_type: operationType })
      onChanged()
    } catch (e) {
      setErrors(prev => ({ ...prev, [loc.id]: e instanceof Error ? e.message : 'Error al guardar' }))
    } finally {
      setSaving(null)
    }
  }

  if (items.length === 0) {
    return (
      <p className="bg-white rounded-2xl border border-border px-4 py-14 text-center text-sm text-gray-400">
        Sin locales por revisar — todo lo que llega del TMS con datos de viaje se clasifica solo.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {items.map(loc => (
        <div key={loc.id} className="flex items-center justify-between bg-white border border-border rounded-xl px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-text-primary">{loc.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{shipperName(loc.entity_id)} · sin viajes registrados todavía</p>
            {errors[loc.id] && <p className="text-[10px] text-red-500 mt-1">{errors[loc.id]}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {saving === loc.id && <Loader2 size={13} className="animate-spin text-accent" />}
            <select
              defaultValue=""
              disabled={saving === loc.id}
              onChange={e => classify(loc, e.target.value)}
              aria-label={`Clasificar ${loc.name}`}
              className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              <option value="" disabled>Elegir zona…</option>
              {OPERATION_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `npx vitest run components/dashboard/LocationsPendingTab.test.tsx`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/LocationsPendingTab.tsx monitor-app/frontend/components/dashboard/LocationsPendingTab.test.tsx
git commit -m "feat(tarifario): tab Por revisar para locales sin señal de región"
```

---

### Task 7: Frontend — reescribir `TarifarioPage` con tabs, sin gate de generador

**Files:**
- Modify: `monitor-app/frontend/app/dashboard/tarifario/page.tsx` (reescritura completa)
- Modify: `monitor-app/frontend/app/dashboard/tarifario/page.test.tsx` (reescritura completa)

**Interfaces:**
- Consumes: `LocationsTable` (Task 4), `LocationCreateForm` (Task 5), `LocationsPendingTab` (Task 6), `locationsApi.list({ needs_manual_classification })`.
- Produces: página sin gate — carga de entrada muestra la tab "Por revisar" con datos ya visibles, sin exigir ninguna selección previa.

- [ ] **Step 1: Reescribir `page.test.tsx` completo**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TarifarioPage from './page'
import { locationsApi, shippersApi, type Shipper } from '@/lib/api/locations'
import type { Location } from '@/lib/types'

vi.mock('@/lib/api/locations', () => ({
  locationsApi: { list: vi.fn(), create: vi.fn(), patch: vi.fn(), createRate: vi.fn(), patchRate: vi.fn(), listRates: vi.fn() },
  shippersApi: { list: vi.fn() },
}))

const SHIPPER: Shipper = { id: 'shipper-1', name: 'Walmart', status: 'ACTIVE' }
const PENDING: Location = {
  id: 'loc-9', entity_type: 'SHIPPER', entity_id: 'shipper-1', site_number: null,
  name: 'Empresas Carozzi S.A.', country_code: 'CL', format: null, address: null,
  region_name: null, region_number: null, opens_at: null, closes_at: null,
  operation_type: null, operational_status: 'ACTIVE', is_manual_override: false,
  created_at: null, updated_at: null,
}
const CLASSIFIED: Location = {
  ...PENDING, id: 'loc-1', name: 'Alameda', site_number: '72', operation_type: 'RM',
  current_rate: null, current_rate_valid_from: null, current_rate_valid_to: null,
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TarifarioPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(shippersApi.list).mockReset().mockResolvedValue([SHIPPER])
  vi.mocked(locationsApi.list).mockReset().mockImplementation(async (params) => {
    if (params?.needs_manual_classification) return { data: [PENDING], count: 1, page: 1, limit: 50 }
    return { data: [CLASSIFIED], count: 1, page: 1, limit: 50 }
  })
  vi.mocked(locationsApi.create).mockReset()
  vi.mocked(locationsApi.patch).mockReset()
})

describe('TarifarioPage', () => {
  it('shows the "Por revisar" tab by default, with no shipper selection required', async () => {
    renderPage()
    expect(await screen.findByText('Empresas Carozzi S.A.')).toBeInTheDocument()
    expect(screen.queryByText('Elegí un generador de carga')).not.toBeInTheDocument()
  })

  it('"Nuevo local" is visible immediately, without picking a shipper first', async () => {
    renderPage()
    expect(await screen.findByText('Nuevo local')).toBeInTheDocument()
  })

  it('switches to "Todos los locales" and shows the full table', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Todos los locales/ }))
    expect(await screen.findByDisplayValue('Alameda')).toBeInTheDocument()
  })

  it('generador de carga is an optional filter inside "Todos los locales", not a gate', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Todos los locales/ }))
    await screen.findByDisplayValue('Alameda')
    expect(locationsApi.list).toHaveBeenCalledWith(expect.objectContaining({ entity_id: '' }))
  })
})
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `npx vitest run app/dashboard/tarifario/page.test.tsx`
Expected: FAIL (la página vieja sigue exigiendo shipper).

- [ ] **Step 3: Reescribir `page.tsx`**

```typescript
'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { locationsApi, shippersApi, type Shipper } from '@/lib/api/locations'
import { LocationCreateForm } from '@/components/dashboard/LocationCreateForm'
import { LocationsTable } from '@/components/dashboard/LocationsTable'
import { LocationsPendingTab } from '@/components/dashboard/LocationsPendingTab'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { INPUT, LoadState } from '../admin/configuracion/shared'

type Tab = 'pending' | 'all'
const LIMIT = 50

/** Tarifario robustecido (2026-07-27) — reemplaza el gate "elegí un
 *  generador de carga primero" (spec 2026-07-22) por dos tabs: "Por
 *  revisar" (triage, default) y "Todos los locales" (gestión completa,
 *  generador de carga como filtro opcional). Ver
 *  docs/superpowers/specs/2026-07-27-tarifario-robustecimiento-design.md. */
export default function TarifarioPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('pending')
  const [shippers, setShippers] = useState<Shipper[]>([])
  const [shipperId, setShipperId] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const qDebounced = useDebouncedValue(q, 300)

  useEffect(() => { shippersApi.list().then(setShippers).catch(() => setShippers([])) }, [])
  useEffect(() => { setPage(1) }, [shipperId, qDebounced])

  const pendingQuery = useQuery({
    queryKey: ['tarifario-pending'],
    queryFn: () => locationsApi.list({ needs_manual_classification: true, limit: 200 }),
  })
  const pendingItems = pendingQuery.data?.data ?? []

  const allQuery = useQuery({
    queryKey: ['tarifario-all', shipperId, qDebounced, page],
    queryFn: () => locationsApi.list({
      entity_type: 'SHIPPER', entity_id: shipperId, q: qDebounced,
      include_rate: true, page, limit: LIMIT,
    }),
    enabled: tab === 'all',
  })
  const allItems = allQuery.data?.data ?? []
  const allCount = allQuery.data?.count ?? 0
  const totalPages = Math.max(1, Math.ceil(allCount / LIMIT))

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['tarifario-pending'] })
    queryClient.invalidateQueries({ queryKey: ['tarifario-all'] })
  }

  function shipperName(entityId: string) {
    return shippers.find(s => s.id === entityId)?.name ?? '—'
  }

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-mulish font-bold text-xl text-text-primary">Tarifario</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Local, formato, dirección, clasificación y tarifa vigente — la zona se clasifica sola desde los viajes del TMS.
          </p>
        </div>
        <LocationCreateForm shippers={shippers} onCreated={invalidate} />
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit flex-wrap">
        <button
          onClick={() => setTab('pending')}
          aria-pressed={tab === 'pending'}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            tab === 'pending' ? 'bg-white text-text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Por revisar <span className="ml-1 text-gray-400">{pendingItems.length}</span>
        </button>
        <button
          onClick={() => setTab('all')}
          aria-pressed={tab === 'all'}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            tab === 'all' ? 'bg-white text-text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Todos los locales
        </button>
      </div>

      {tab === 'pending' && (
        <>
          <LoadState loading={pendingQuery.isPending} error={pendingQuery.error ? 'Error al cargar' : null} onRetry={() => pendingQuery.refetch()} />
          {!pendingQuery.isPending && <LocationsPendingTab items={pendingItems} shipperName={shipperName} onChanged={invalidate} />}
        </>
      )}

      {tab === 'all' && (
        <>
          <div className="bg-white border border-border rounded-2xl px-3.5 py-2.5 flex items-center gap-2 flex-wrap">
            <select value={shipperId} onChange={e => setShipperId(e.target.value)} aria-label="Filtrar por generador de carga" className={INPUT + ' w-56'}>
              <option value="">Todos los generadores de carga</option>
              {shippers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre o N° de local…" aria-label="Buscar local" className={INPUT + ' w-64'} />
          </div>

          <LoadState loading={allQuery.isPending} error={allQuery.error ? 'Error al cargar' : null} onRetry={() => allQuery.refetch()} />
          {!allQuery.isPending && <LocationsTable items={allItems} onChanged={invalidate} />}

          {!allQuery.isPending && totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-3">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-border text-gray-500 disabled:opacity-40">
                Anterior
              </button>
              <span className="text-xs text-gray-400">Página {page} de {totalPages} ({allCount} locales)</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-border text-gray-500 disabled:opacity-40">
                Siguiente
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `npx vitest run app/dashboard/tarifario/page.test.tsx`
Expected: PASS (4/4).

- [ ] **Step 5: Correr toda la suite de frontend + tsc + build**

Run: `npx vitest run`
Expected: PASS, ningún test existente roto (revisar en especial que no quede ningún consumidor de la firma vieja de `LocationCreateForm`/`Location` sin `is_manual_override`).

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run build`
Expected: build limpio.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/app/dashboard/tarifario/page.tsx monitor-app/frontend/app/dashboard/tarifario/page.test.tsx
git commit -m "feat(tarifario): tabs Por revisar/Todos los locales, sin gate de generador de carga"
```

---

### Task 8: Verificación end-to-end contra producción

**Files:** ninguno — solo verificación manual.

- [ ] **Step 1: Confirmar en Supabase que el backfill cerró la gran mayoría del gap**

```sql
select count(*) filter (where operation_type is null) as sin_clasificar
from public.locations where operational_status = 'ACTIVE';
```
Expected: baja de 262 a un número chico (el residual real sin viajes históricos).

- [ ] **Step 2: Verificar en el navegador (`webcarga-frontend-dev`, sesión autenticada) contra `/dashboard/tarifario`**

- La pantalla carga directo en "Por revisar" sin pedir ningún generador de carga.
- El conteo de "Por revisar" es chico (el residual, no 262).
- Clasificar un local desde "Por revisar" lo saca de esa tab de inmediato.
- "Todos los locales" muestra la tabla completa; filtrar por generador de carga es opcional.
- Un local recién auto-clasificado muestra el tag "auto" junto a su zona; uno clasificado a mano desde "Por revisar" no.
- "+ Nuevo local" funciona sin haber tocado el filtro de generador.

- [ ] **Step 3: Actualizar `AGENTLOG.md`**

Documentar el cierre del bloqueante de Hito 3 (RM/Zona Cero), con el conteo real antes/después del backfill y confirmación de la verificación manual — mismo formato que rondas anteriores.
