# Diario — Rediseño Completo (Tabla + Tablero) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el rediseño anterior del Diario (fila expandible + ficha sin tabs, que el usuario evaluó como insuficiente) por una experiencia que refleje datos reales de `app.trips` — cumplimiento por parada visible sin clics extra, campos congelados por edición manual señalizados, atribución completa de quién editó, y un selector Tabla/Tablero para que el operador elija cómo visualizar "En Curso".

**Architecture:** Extiende componentes existentes (`IndicatorDots`, `StopTimeline`) y agrega componentes nuevos reutilizables (`TripCard`, `TripBoard`, `StopProgressDots`, `ViewToggle`). Se elimina `TripRowExpanded` (el paso intermedio "fila expandida" que el rediseño anterior introdujo y que quedó vacío de información). Backend gana `edited_by`/`created_at` en `app.trips` (ya existen en la tabla, no se exponían).

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind CSS, Vitest + React Testing Library (ya instalado), FastAPI/asyncpg.

## Global Constraints

- Ningún error de `PATCH`/`DELETE` se silencia — mismo estándar ya establecido en `IndicatorDots`/`TripSlideOver`.
- El toggle Tabla/Tablero es puro de presentación (mismos datos ya cargados por `page.tsx`, sin llamadas de red nuevas) y solo aplica a la pestaña "En Curso" — "Historial" queda fijo en tabla por volumen.
- `on_time_status`/`milestone_status` por parada ya existen en `stops` (jsonb) — no requieren cambio de backend, solo reorganización de UI.
- `edited_by` (uuid en `app.trips`, referencia `auth.users.id`) se resuelve con `LEFT JOIN public.profiles` — mismo patrón ya usado en `monitor-app/backend/api/app/routers/users.py` para no consultar el schema `auth` directamente desde la API.
- No se toca el módulo Empresas ni Configuración.
- El fix de RLS en `app.trips` (crítico, marcado por el Supabase advisor) es un ajuste de backend separado, fuera de este plan — el usuario pidió tratarlo aparte.

---

### Task 1: Backend — `edited_by` + `created_at` en `app.trips`

**Files:**
- Modify: `monitor-app/backend/api/app/routers/trips.py:23-64` (`_TRIP_SELECT`, `_TRIP_FROM`)
- Modify: `monitor-app/frontend/lib/types.ts:267-299` (`Trip`)

**Interfaces:**
- Produces: `Trip.edited_by: string | null` (email o nombre del último editor, ya resuelto — nunca un uuid crudo), `Trip.created_at: string | null` — consumidos por Task 4 (`IndicatorDots`) y Task 6 (`TripSlideOver`).

**Contexto:** `app.trips` ya tiene las columnas `edited_by` (uuid, FK a `auth.users.id`) y `created_at` — confirmado contra el schema real vía Supabase. Ningún router de este proyecto consulta `auth.users` directamente; el patrón existente (`users.py`) usa `public.profiles` (tabla espejo con `full_name`/`email`, poblada por trigger `handle_new_user`).

- [ ] **Step 1: Reemplazar `_TRIP_SELECT`**

Reemplazar (líneas 23-58 del archivo actual):

```python
_TRIP_SELECT = """
    t.id,
    t.source_system,
    t.client_name,
    t.planning_date,
    t.status_reported_at,
    t.trip_status                                  AS current_status,
    COALESCE(fl.tractor_plate,
             t.fleet->>'tractor_plate')           AS tractor_plate,
    COALESCE(fl.trailer_plate,
             t.fleet->>'trailer_plate')           AS trailer_plate,
    COALESCE(fl.driver_name_raw,
             t.fleet->>'driver_name_tms')         AS driver_name,
    t.fleet->>'driver_rut_tms'                    AS driver_rut,
    fl.driver_phone                               AS driver_phone,
    tp.business_name                              AS transporter,
    t.fleet->>'transporter_name_tms'              AS transporter_tms,
    t.origin,
    t.cargo_type,
    t.stops,
    t.activo,
    t.trabajando,
    t.asignado,
    t.primera_vuelta,
    t.estado_manual,
    t.observaciones,
    t.comentarios,
    t.manually_edited_fields,
    t.fleet_link_id,
    fl.transporter_id                             AS transporter_profile_id,
    t.edited_at,
    t.updated_at,
    t.source_system_trip_id,
    t.milestone_status,
    t.pipeline_updated_at
"""
```

por:

```python
_TRIP_SELECT = """
    t.id,
    t.source_system,
    t.client_name,
    t.planning_date,
    t.status_reported_at,
    t.trip_status                                  AS current_status,
    COALESCE(fl.tractor_plate,
             t.fleet->>'tractor_plate')           AS tractor_plate,
    COALESCE(fl.trailer_plate,
             t.fleet->>'trailer_plate')           AS trailer_plate,
    COALESCE(fl.driver_name_raw,
             t.fleet->>'driver_name_tms')         AS driver_name,
    t.fleet->>'driver_rut_tms'                    AS driver_rut,
    fl.driver_phone                               AS driver_phone,
    tp.business_name                              AS transporter,
    t.fleet->>'transporter_name_tms'              AS transporter_tms,
    t.origin,
    t.cargo_type,
    t.stops,
    t.activo,
    t.trabajando,
    t.asignado,
    t.primera_vuelta,
    t.estado_manual,
    t.observaciones,
    t.comentarios,
    t.manually_edited_fields,
    t.fleet_link_id,
    fl.transporter_id                             AS transporter_profile_id,
    t.edited_at,
    t.updated_at,
    t.created_at,
    COALESCE(p.full_name, p.email)                 AS edited_by,
    t.source_system_trip_id,
    t.milestone_status,
    t.pipeline_updated_at
"""
```

- [ ] **Step 2: Reemplazar `_TRIP_FROM`**

Reemplazar (líneas 60-64 del archivo actual):

```python
_TRIP_FROM = """
    FROM app.trips t
    LEFT JOIN app.trip_fleet_links fl ON fl.id = t.fleet_link_id
    LEFT JOIN app.transporter_profiles tp ON tp.id = fl.transporter_id
"""
```

por:

```python
_TRIP_FROM = """
    FROM app.trips t
    LEFT JOIN app.trip_fleet_links fl ON fl.id = t.fleet_link_id
    LEFT JOIN app.transporter_profiles tp ON tp.id = fl.transporter_id
    LEFT JOIN public.profiles p ON p.id = t.edited_by
"""
```

- [ ] **Step 3: Verificar que el backend arranca y responde correctamente**

Run:
```bash
cd monitor-app/backend/api
./venv/bin/python -m py_compile app/routers/trips.py
./venv/bin/python -m pytest tests/ -q
```
Expected: compila sin error, `12 passed` (mismo baseline, este cambio no toca lógica de negocio, solo columnas seleccionadas).

Run (con el servidor local levantado — ver `/start-dev` o `uvicorn app.main:app --port 8001` desde `monitor-app/backend/api`):
```bash
curl -s http://localhost:8001/api/v1/trips/?limit=1 | python3 -m json.tool | grep -E "edited_by|created_at"
```
Expected: ambas claves presentes en la respuesta (pueden ser `null` si el viaje de prueba no tiene edición manual, eso es correcto).

- [ ] **Step 4: Actualizar el tipo `Trip` en el frontend**

Reemplazar (líneas 267-299 del archivo actual, `monitor-app/frontend/lib/types.ts`):

```ts
export type Trip = {
  id:                     string
  source_system:          string
  client_name:            string | null
  planning_date:          string | null
  status_reported_at:     string | null
  current_status:         string | null
  tractor_plate:          string | null
  trailer_plate:          string | null
  driver_name:            string | null
  driver_rut:             string | null
  driver_phone:           string | null
  transporter:            string | null   // linked company (tp.business_name) only
  transporter_tms:        string | null   // TMS-reported name (fleet->>'transporter_name_tms')
  origin:                 string | null
  cargo_type:             string | null
  stops:                  TripStop[]
  activo:                 boolean
  trabajando:             boolean
  asignado:               boolean
  primera_vuelta:         boolean
  estado_manual:          string | null
  observaciones:          string | null
  comentarios:            string | null
  fleet_link_id:          string | null
  transporter_profile_id: string | null
  manually_edited_fields: string[]
  edited_at:              string | null
  updated_at:             string | null
  source_system_trip_id:  string | null
  milestone_status:       string | null  // trip-level, distinct from TripStop.milestone_status
  pipeline_updated_at:    string | null
}
```

por:

```ts
export type Trip = {
  id:                     string
  source_system:          string
  client_name:            string | null
  planning_date:          string | null
  status_reported_at:     string | null
  current_status:         string | null
  tractor_plate:          string | null
  trailer_plate:          string | null
  driver_name:            string | null
  driver_rut:             string | null
  driver_phone:           string | null
  transporter:            string | null   // linked company (tp.business_name) only
  transporter_tms:        string | null   // TMS-reported name (fleet->>'transporter_name_tms')
  origin:                 string | null
  cargo_type:             string | null
  stops:                  TripStop[]
  activo:                 boolean
  trabajando:             boolean
  asignado:               boolean
  primera_vuelta:         boolean
  estado_manual:          string | null
  observaciones:          string | null
  comentarios:            string | null
  fleet_link_id:          string | null
  transporter_profile_id: string | null
  manually_edited_fields: string[]
  edited_at:              string | null
  edited_by:              string | null  // nombre/email ya resueltos por el backend, nunca un uuid
  updated_at:             string | null
  created_at:             string | null
  source_system_trip_id:  string | null
  milestone_status:       string | null  // trip-level, distinct from TripStop.milestone_status
  pipeline_updated_at:    string | null
}
```

- [ ] **Step 5: Verificar tipos**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: sin errores (los tests existentes usan `baseTrip` fixtures que ya incluyen todos los campos requeridos por spread — si algún test fixture no incluye `edited_by`/`created_at`, `tsc` lo va a marcar; en ese caso agregar `edited_by: null, created_at: null` a cada fixture `baseTrip` en `IndicatorDots.test.tsx`, `TripRowExpanded.test.tsx`, `TripTable.test.tsx`, `TripSlideOver.test.tsx`, `GroupBuilder.test.tsx` no aplica — ese no usa Trip).

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api/app/routers/trips.py monitor-app/frontend/lib/types.ts
git commit -m "feat(diario): exponer edited_by/created_at de app.trips

edited_by se resuelve a nombre/email vía LEFT JOIN public.profiles
(mismo patrón que users.py, evita tocar el schema auth directamente).
Ninguno de los dos campos requería cambio de schema — ya existían en
app.trips, solo no se seleccionaban."
```

---

### Task 2: `lib/utils/compliance.ts` — resumen de cumplimiento por viaje

**Files:**
- Create: `monitor-app/frontend/lib/utils/compliance.ts`
- Test: `monitor-app/frontend/lib/utils/compliance.test.ts`

**Interfaces:**
- Produces: `stopComplianceSummary(stops: TripStop[]): 'ok' | 'warn' | null` — usado por `TripTable` (Task 5), `TripCard` (Task 7).

- [ ] **Step 1: Escribir el test**

```ts
// monitor-app/frontend/lib/utils/compliance.test.ts
import { describe, it, expect } from 'vitest'
import { stopComplianceSummary } from './compliance'
import type { TripStop } from '@/lib/types'

function makeStop(overrides: Partial<TripStop>): TripStop {
  return {
    stop_id: 's1', local: 'Parada', planning_date: null,
    arrival_date: null, departure_date: null, unload_start: null, unload_end: null,
    gps_arrival_date: null, gps_departure_date: null, on_time_status: null,
    destination_city: null, destination_region: null, s2s: null,
    temperature: null, milestone_status: null,
    ...overrides,
  }
}

describe('stopComplianceSummary', () => {
  it('returns null for an empty stop list', () => {
    expect(stopComplianceSummary([])).toBeNull()
  })

  it('returns null when no stop has on_time_status data yet', () => {
    const stops = [makeStop({}), makeStop({})]
    expect(stopComplianceSummary(stops)).toBeNull()
  })

  it('returns "ok" when all stops with data are ON TIME', () => {
    const stops = [makeStop({ on_time_status: 'ON TIME' }), makeStop({ on_time_status: 'ON TIME' }), makeStop({})]
    expect(stopComplianceSummary(stops)).toBe('ok')
  })

  it('returns "warn" when at least one stop is OFF TIME', () => {
    const stops = [makeStop({ on_time_status: 'ON TIME' }), makeStop({ on_time_status: 'OFF TIME' })]
    expect(stopComplianceSummary(stops)).toBe('warn')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd monitor-app/frontend && npm test -- compliance`
Expected: FAIL — `Cannot find module './compliance'`

- [ ] **Step 3: Implementar `compliance.ts`**

```ts
// monitor-app/frontend/lib/utils/compliance.ts
import type { TripStop } from '@/lib/types'

export type StopComplianceSummary = 'ok' | 'warn' | null

export function stopComplianceSummary(stops: TripStop[]): StopComplianceSummary {
  if (!stops?.length) return null
  const withStatus = stops.filter(s => s.on_time_status != null)
  if (withStatus.length === 0) return null
  return withStatus.some(s => s.on_time_status === 'OFF TIME') ? 'warn' : 'ok'
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd monitor-app/frontend && npm test -- compliance`
Expected: `Test Files  1 passed (1)`, 4 tests passed

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/lib/utils/compliance.ts monitor-app/frontend/lib/utils/compliance.test.ts
git commit -m "feat(diario): stopComplianceSummary — señal de cumplimiento agregada

Una sola fuente de verdad para 'este viaje tiene un problema de
cumplimiento', reutilizada por fila, tarjeta y detalle."
```

---

### Task 3: `StopProgressDots` — tira de puntos de cumplimiento por parada

**Files:**
- Create: `monitor-app/frontend/components/dashboard/StopProgressDots.tsx`
- Test: `monitor-app/frontend/components/dashboard/StopProgressDots.test.tsx`

**Interfaces:**
- Produces: `StopProgressDots({ stops: TripStop[] }): JSX.Element | null` — usado por `TripCard` (Task 7).

- [ ] **Step 1: Escribir el test**

```tsx
// monitor-app/frontend/components/dashboard/StopProgressDots.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StopProgressDots } from './StopProgressDots'
import type { TripStop } from '@/lib/types'

function makeStop(overrides: Partial<TripStop>): TripStop {
  return {
    stop_id: 's1', local: 'Parada Test', planning_date: null,
    arrival_date: null, departure_date: null, unload_start: null, unload_end: null,
    gps_arrival_date: null, gps_departure_date: null, on_time_status: null,
    destination_city: null, destination_region: null, s2s: null,
    temperature: null, milestone_status: null,
    ...overrides,
  }
}

describe('StopProgressDots', () => {
  it('renders nothing for an empty stop list', () => {
    const { container } = render(<StopProgressDots stops={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one dot per stop, titled with the stop name', () => {
    const stops = [
      makeStop({ stop_id: 'a', local: 'Parada A', on_time_status: 'ON TIME' }),
      makeStop({ stop_id: 'b', local: 'Parada B', on_time_status: 'OFF TIME' }),
      makeStop({ stop_id: 'c', local: 'Parada C' }),
    ]
    render(<StopProgressDots stops={stops} />)
    expect(screen.getByTitle('Parada A')).toBeInTheDocument()
    expect(screen.getByTitle('Parada B')).toBeInTheDocument()
    expect(screen.getByTitle('Parada C')).toBeInTheDocument()
  })

  it('colors ON TIME dots green and OFF TIME dots red', () => {
    const stops = [
      makeStop({ stop_id: 'a', local: 'Parada A', on_time_status: 'ON TIME' }),
      makeStop({ stop_id: 'b', local: 'Parada B', on_time_status: 'OFF TIME' }),
    ]
    render(<StopProgressDots stops={stops} />)
    expect(screen.getByTitle('Parada A')).toHaveClass('bg-green-500')
    expect(screen.getByTitle('Parada B')).toHaveClass('bg-red-500')
  })

  it('colors stops without on_time_status data gray', () => {
    const stops = [makeStop({ stop_id: 'a', local: 'Parada A' })]
    render(<StopProgressDots stops={stops} />)
    expect(screen.getByTitle('Parada A')).toHaveClass('bg-gray-200')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd monitor-app/frontend && npm test -- StopProgressDots`
Expected: FAIL — `Cannot find module './StopProgressDots'`

- [ ] **Step 3: Implementar `StopProgressDots.tsx`**

```tsx
// monitor-app/frontend/components/dashboard/StopProgressDots.tsx
'use client'

import type { TripStop } from '@/lib/types'

interface Props {
  stops: TripStop[]
}

export function StopProgressDots({ stops }: Props) {
  if (!stops?.length) return null

  return (
    <div className="flex gap-0.5 items-center">
      {stops.map((stop, i) => (
        <span
          key={stop.stop_id ?? i}
          title={stop.local ?? stop.destination_city ?? undefined}
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            stop.on_time_status === 'ON TIME' ? 'bg-green-500' :
            stop.on_time_status === 'OFF TIME' ? 'bg-red-500' :
            'bg-gray-200'
          }`}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd monitor-app/frontend && npm test -- StopProgressDots`
Expected: `Test Files  1 passed (1)`, 4 tests passed

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/StopProgressDots.tsx monitor-app/frontend/components/dashboard/StopProgressDots.test.tsx
git commit -m "feat(diario): StopProgressDots — tira de puntos de cumplimiento

Building block para TripCard (tablero) — verde/rojo/gris según
on_time_status de cada parada."
```

---

### Task 4: `IndicatorDots` — candado en campos congelados por edición manual

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/IndicatorDots.tsx`
- Modify: `monitor-app/frontend/components/dashboard/IndicatorDots.test.tsx`

**Interfaces:**
- Consumes: `Trip.manually_edited_fields`, `Trip.edited_by`, `Trip.edited_at` (Task 1), `fmtDT` de `lib/utils/datetime.ts` (ya existe).
- Produces: sin cambio de firma pública (`{ trip, onSaved, size? }`) — el candado es puramente derivado de `trip`.

**Contexto — archivo actual completo (70 líneas):** ver el componente ya implementado. Este task solo agrega el indicador visual de campo congelado, no toca la lógica de toggle/rollback ya aprobada.

- [ ] **Step 1: Escribir el test (falla porque el candado no existe)**

Agregar estos 2 tests al `describe('IndicatorDots', ...)` existente en `IndicatorDots.test.tsx` (junto a los 6 ya existentes — no borrar ninguno):

```tsx
it('shows a lock icon with attribution tooltip when a field is in manually_edited_fields', () => {
  const trip = { ...baseTrip, manually_edited_fields: ['asignado'], edited_by: 'Felipe Sumadots', edited_at: '2026-07-02 10:15:00' }
  render(<IndicatorDots trip={trip} onSaved={vi.fn()} />)
  expect(screen.getByTitle(/Felipe Sumadots/)).toBeInTheDocument()
})

it('does not show a lock icon for a field not in manually_edited_fields', () => {
  const trip = { ...baseTrip, manually_edited_fields: ['asignado'], edited_by: 'Felipe Sumadots', edited_at: '2026-07-02 10:15:00' }
  render(<IndicatorDots trip={trip} onSaved={vi.fn()} />)
  // Trabajando no está congelado — su title queda exactamente "Trabajando", sin sufijo "congelado por..."
  expect(screen.getByTitle('Trabajando')).toBeInTheDocument()
})
```

También actualizar el fixture `baseTrip` del mismo archivo agregando `edited_by: null, created_at: null` a los campos ya listados (requerido por el tipo `Trip` actualizado en Task 1).

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd monitor-app/frontend && npm test -- IndicatorDots`
Expected: FAIL — no existe ningún elemento con `title` conteniendo "Felipe Sumadots"

- [ ] **Step 3: Agregar el candado**

Reemplazar el bloque de render de cada punto (líneas 47-65 del archivo actual):

```tsx
  return (
    <div onClick={e => e.stopPropagation()}>
      <div className="flex gap-1 items-center">
        {INDICATORS.map(ind => {
          const active = optimistic[ind.field] ?? trip[ind.field]
          return (
            <button
              key={ind.field}
              type="button"
              title={ind.title}
              disabled={!!pending[ind.field]}
              onClick={e => toggle(ind.field, e)}
              className={`${dotSize} rounded-full transition-all hover:scale-110 disabled:opacity-50 ${
                active ? ind.color : 'bg-gray-200'
              }`}
            />
          )
        })}
      </div>
      {error && <p className="text-[9px] text-red-500 mt-0.5 max-w-[140px]">{error}</p>}
    </div>
  )
}
```

por:

```tsx
  return (
    <div onClick={e => e.stopPropagation()}>
      <div className="flex gap-1 items-center">
        {INDICATORS.map(ind => {
          const active = optimistic[ind.field] ?? trip[ind.field]
          const frozen = trip.manually_edited_fields?.includes(ind.field) ?? false
          return (
            <span key={ind.field} className="relative inline-flex">
              <button
                type="button"
                title={frozen
                  ? `${ind.title} — congelado por ${trip.edited_by ?? 'alguien'} el ${fmtDT(trip.edited_at)}`
                  : ind.title}
                disabled={!!pending[ind.field]}
                onClick={e => toggle(ind.field, e)}
                className={`${dotSize} rounded-full transition-all hover:scale-110 disabled:opacity-50 ${
                  active ? ind.color : 'bg-gray-200'
                }`}
              />
              {frozen && (
                <span className="absolute -top-1 -right-1 text-[7px] leading-none pointer-events-none">🔒</span>
              )}
            </span>
          )
        })}
      </div>
      {error && <p className="text-[9px] text-red-500 mt-0.5 max-w-[140px]">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Agregar el import de `fmtDT`**

Reemplazar (línea 4 del archivo actual):

```tsx
import { tripsApi, type TripPatch } from '@/lib/api/trips'
```

por:

```tsx
import { tripsApi, type TripPatch } from '@/lib/api/trips'
import { fmtDT } from '@/lib/utils/datetime'
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd monitor-app/frontend && npm test -- IndicatorDots`
Expected: `Test Files  1 passed (1)`, 8 tests passed

- [ ] **Step 6: Correr todos los tests y verificar tipos**

Run: `cd monitor-app/frontend && npm test && npx tsc --noEmit`
Expected: todos los tests pasan, sin errores de tipo

- [ ] **Step 7: Commit**

```bash
git add monitor-app/frontend/components/dashboard/IndicatorDots.tsx monitor-app/frontend/components/dashboard/IndicatorDots.test.tsx
git commit -m "feat(diario): candado + atribución en indicadores congelados

Si un indicador está en manually_edited_fields (protegido por el
trigger del pipeline), se ve un candado con tooltip 'congelado por
{editor} el {fecha}' — antes no había ninguna señal visual de que el
campo dejó de seguir al TMS."
```

---

### Task 5: `TripTable` enriquecida — elimina `TripRowExpanded`, `StopTimeline` sin modo compacto

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/TripTable.tsx`
- Modify: `monitor-app/frontend/components/dashboard/TripTable.test.tsx`
- Modify: `monitor-app/frontend/components/dashboard/StopTimeline.tsx`
- Modify: `monitor-app/frontend/components/dashboard/StopTimeline.test.tsx`
- Delete: `monitor-app/frontend/components/dashboard/TripRowExpanded.tsx`
- Delete: `monitor-app/frontend/components/dashboard/TripRowExpanded.test.tsx`

**Interfaces:**
- Consumes: `stopComplianceSummary` (Task 2).
- Produces: `TripTable`'s `onSelect` ahora se invoca directo al hacer click en la fila (ya no hay expandir intermedio) — mismo prop, comportamiento distinto.

**Contexto:** Este task es una unidad — `StopTimeline`'s modo `compact` solo lo usaba `TripRowExpanded`, así que quitar uno sin el otro deja el árbol sin compilar. Se hacen los tres cambios (StopTimeline, TripTable, borrar TripRowExpanded) en el mismo commit.

- [ ] **Step 1: Escribir/actualizar los tests de `StopTimeline`**

Reemplazar el archivo completo `StopTimeline.test.tsx`:

```tsx
// monitor-app/frontend/components/dashboard/StopTimeline.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StopTimeline } from './StopTimeline'
import type { TripStop } from '@/lib/types'

function makeStop(overrides: Partial<TripStop>): TripStop {
  return {
    stop_id: 's1', local: 'Parada Test', planning_date: null,
    arrival_date: null, departure_date: null, unload_start: null, unload_end: null,
    gps_arrival_date: null, gps_departure_date: null, on_time_status: null,
    destination_city: null, destination_region: null, s2s: null,
    temperature: null, milestone_status: null,
    ...overrides,
  }
}

describe('StopTimeline', () => {
  it('returns nothing when there are no stops', () => {
    const { container } = render(<StopTimeline stops={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one row per stop with its name', () => {
    const stops = [
      makeStop({ stop_id: 'a', local: 'Parada A', arrival_date: '2026-07-02 10:00:00', departure_date: '2026-07-02 11:00:00' }),
      makeStop({ stop_id: 'b', local: 'Parada B' }),
    ]
    render(<StopTimeline stops={stops} />)
    expect(screen.getByText('Parada A')).toBeInTheDocument()
    expect(screen.getByText('Parada B')).toBeInTheDocument()
  })

  it('marks the first stop without arrival_date/gps_arrival_date/on_time_status as active, the rest before it as done, the rest after as pending', () => {
    const stops = [
      makeStop({ stop_id: 'a', local: 'Hecha', arrival_date: '2026-07-02 10:00:00' }),
      makeStop({ stop_id: 'b', local: 'Activa' }),
      makeStop({ stop_id: 'c', local: 'Pendiente' }),
    ]
    render(<StopTimeline stops={stops} />)
    expect(screen.getByText(/✓ llegó/)).toBeInTheDocument()
    expect(screen.getByText('en camino')).toBeInTheDocument()
    expect(screen.getByText('pendiente')).toBeInTheDocument()
  })

  it('shows an ON TIME badge for a stop with on_time_status ON TIME', () => {
    const stops = [makeStop({ stop_id: 'a', local: 'Parada A', on_time_status: 'ON TIME' })]
    render(<StopTimeline stops={stops} />)
    expect(screen.getByText('ON TIME')).toBeInTheDocument()
  })

  it('shows an OFF TIME badge for a stop with on_time_status OFF TIME', () => {
    const stops = [makeStop({ stop_id: 'a', local: 'Parada A', on_time_status: 'OFF TIME' })]
    render(<StopTimeline stops={stops} />)
    expect(screen.getByText('OFF TIME')).toBeInTheDocument()
  })

  it('shows the milestone_status badge when present', () => {
    const stops = [makeStop({ stop_id: 'a', local: 'Parada A', milestone_status: 'CERRADO SAP' })]
    render(<StopTimeline stops={stops} />)
    expect(screen.getByText('CERRADO SAP')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd monitor-app/frontend && npm test -- StopTimeline`
Expected: FAIL — el componente actual no acepta la ausencia de `compact` de esta forma (los tests de badges ON TIME/OFF TIME/milestone_status fallan porque no se renderiza ningún badge hoy)

- [ ] **Step 3: Reemplazar `StopTimeline.tsx` completo**

```tsx
// monitor-app/frontend/components/dashboard/StopTimeline.tsx
'use client'

import type { TripStop } from '@/lib/types'
import { stopWasVisited } from '@/lib/utils/temperature'
import { fmtShort } from '@/lib/utils/datetime'

type StopState = 'done' | 'active' | 'pending'

function isCompleted(s: TripStop): boolean {
  return !!(s.arrival_date || s.gps_arrival_date || s.on_time_status)
}

function stateFor(i: number, currentIdx: number, stop: TripStop): StopState {
  if (currentIdx < 0) return isCompleted(stop) ? 'done' : 'pending'
  if (i < currentIdx) return 'done'
  if (i === currentIdx) return 'active'
  return 'pending'
}

interface Props {
  stops: TripStop[]
}

export function StopTimeline({ stops }: Props) {
  if (!stops?.length) return null

  const currentIdx = stops.findIndex(s => !isCompleted(s))

  return (
    <div className="flex flex-col">
      {stops.map((stop, i) => {
        const state = stateFor(i, currentIdx, stop)
        const name = stop.local ?? stop.destination_city ?? '—'
        const isLast = i === stops.length - 1
        return (
          <div key={stop.stop_id ?? i} className="flex items-start gap-2 relative pb-2.5 last:pb-0">
            {!isLast && (
              <span className="absolute left-[4px] top-3 bottom-0 w-px bg-gray-200" />
            )}
            <span
              className={`w-2.5 h-2.5 rounded-full mt-0.5 shrink-0 z-10 ${
                state === 'done' ? 'bg-green-500' : state === 'active' ? 'bg-blue-500 ring-4 ring-blue-100' : 'bg-gray-200'
              }`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-xs font-semibold text-slate-700 truncate">{name}</p>
                {stop.on_time_status === 'ON TIME' && (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-green-50 text-green-600 border border-green-100">ON TIME</span>
                )}
                {stop.on_time_status === 'OFF TIME' && (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-100">OFF TIME</span>
                )}
                {stop.milestone_status && (
                  <span className="text-[9px] text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">{stop.milestone_status}</span>
                )}
              </div>
              <p className="text-[10px] text-gray-400">
                {state === 'done' && `✓ llegó ${fmtShort(stop.arrival_date)} · salió ${fmtShort(stop.departure_date)}`}
                {state === 'active' && 'en camino'}
                {state === 'pending' && 'pendiente'}
                {stopWasVisited(stop) && stop.temperature != null && ` · ${stop.temperature}°C`}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Correr el test de `StopTimeline` y verificar que pasa**

Run: `cd monitor-app/frontend && npm test -- StopTimeline`
Expected: `Test Files  1 passed (1)`, 6 tests passed

- [ ] **Step 5: Borrar `TripRowExpanded`**

```bash
rm monitor-app/frontend/components/dashboard/TripRowExpanded.tsx
rm monitor-app/frontend/components/dashboard/TripRowExpanded.test.tsx
```

- [ ] **Step 6: Actualizar/reescribir `TripTable.test.tsx`**

Reemplazar el archivo completo:

```tsx
// monitor-app/frontend/components/dashboard/TripTable.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TripTable } from './TripTable'
import type { Trip } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { patch: vi.fn().mockResolvedValue({}) },
}))

function makeTrip(id: string, overrides: Partial<Trip> = {}): Trip {
  return {
    id, source_system: 'qanalytics', client_name: 'walmart', planning_date: '2026-07-02',
    status_reported_at: null, current_status: 'ORIGEN', tractor_plate: 'ABCD12', trailer_plate: null,
    driver_name: 'Juan Perez', driver_rut: null, driver_phone: null, transporter: null, transporter_tms: null,
    origin: 'CD Quilicura', cargo_type: 'FRIO', stops: [], activo: true, trabajando: false, asignado: true,
    primera_vuelta: false, estado_manual: null, observaciones: null, comentarios: null,
    fleet_link_id: null, transporter_profile_id: null, manually_edited_fields: [], edited_at: null,
    edited_by: null, updated_at: null, created_at: null,
    source_system_trip_id: '2000711', milestone_status: null, pipeline_updated_at: null,
    ...overrides,
  }
}

describe('TripTable', () => {
  it('renders an "Indicadores" column with clickable dots for each trip row', () => {
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getAllByTitle('Activo').length).toBeGreaterThan(0)
  })

  it('calls onSelect directly when a row is clicked (no intermediate expand step)', () => {
    const onSelect = vi.fn()
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={onSelect} onSaved={vi.fn()} meta={null} />)
    fireEvent.click(screen.getAllByText('ABCD12')[0])
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
  })

  it('clicking an indicator dot does not call onSelect', () => {
    const onSelect = vi.fn()
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={onSelect} onSaved={vi.fn()} meta={null} />)
    fireEvent.click(screen.getAllByTitle('Activo')[0])
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows an OFF TIME compliance badge when a stop is off time', () => {
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: null, departure_date: null,
      unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: 'OFF TIME', destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null,
    }]
    render(<TripTable trips={[makeTrip('t1', { stops })]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getAllByText(/OFF TIME/).length).toBeGreaterThan(0)
  })

  it('does not show a compliance badge when no stop has on_time_status data', () => {
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.queryByText(/OFF TIME/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 7: Reemplazar los imports de `TripTable.tsx`**

Reemplazar (líneas 1-10 del archivo actual):

```tsx
'use client'

import { useState, useEffect, useMemo, Fragment } from 'react'
import { Check, Loader2, PenLine, X, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import type { AlertStatus, ComplianceAlertSummary, Trip, TripStop, TripsMeta } from '@/lib/types'
import { ComplianceBadge } from './ComplianceBadge'
import { tripsApi } from '@/lib/api/trips'
import { getLatestTemp, classifyTemperature } from '@/lib/utils/temperature'
import { IndicatorDots } from './IndicatorDots'
import { TripRowExpanded } from './TripRowExpanded'
```

por:

```tsx
'use client'

import { useState, useEffect, useMemo } from 'react'
import { Check, Loader2, PenLine, X, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import type { AlertStatus, ComplianceAlertSummary, Trip, TripStop, TripsMeta } from '@/lib/types'
import { ComplianceBadge } from './ComplianceBadge'
import { tripsApi } from '@/lib/api/trips'
import { getLatestTemp, classifyTemperature } from '@/lib/utils/temperature'
import { stopComplianceSummary } from '@/lib/utils/compliance'
import { IndicatorDots } from './IndicatorDots'
```

- [ ] **Step 8: Agregar el punto de cumplimiento a `StopPills`**

Reemplazar la función `StopPills` completa (líneas 28-62 del archivo actual):

```tsx
function StopPills({ stops }: { stops: TripStop[] }) {
  if (!stops?.length) return <span className="text-gray-200 text-xs">—</span>

  const isCompleted = (s: TripStop) =>
    !!(s.arrival_date || s.gps_arrival_date || s.on_time_status)
  const currentIdx = stops.findIndex(s => !isCompleted(s))
  const activeIdx  = currentIdx >= 0 ? currentIdx : stops.length - 1

  return (
    <div className="flex flex-col gap-0.5">
      {stops.map((stop, i) => {
        const name     = stop.local ?? stop.destination_city ?? '—'
        const isActive = i === activeIdx
        const isDone   = currentIdx < 0 ? isCompleted(stop) : i < activeIdx
        return (
          <span
            key={stop.stop_id ?? i}
            title={name}
            className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full w-fit max-w-[120px] truncate flex items-center gap-0.5 ${
              isActive
                ? 'bg-accent/10 text-accent border border-accent/20'
                : isDone
                ? 'text-gray-300 bg-gray-50'
                : 'text-gray-200'
            }`}
          >
            {isActive && <span className="shrink-0 text-[8px]">→</span>}
            {isDone && !isActive && <span className="shrink-0 text-[8px]">✓</span>}
            <span className="truncate">{name}</span>
          </span>
        )
      })}
    </div>
  )
}
```

por:

```tsx
function StopPills({ stops }: { stops: TripStop[] }) {
  if (!stops?.length) return <span className="text-gray-200 text-xs">—</span>

  const isCompleted = (s: TripStop) =>
    !!(s.arrival_date || s.gps_arrival_date || s.on_time_status)
  const currentIdx = stops.findIndex(s => !isCompleted(s))
  const activeIdx  = currentIdx >= 0 ? currentIdx : stops.length - 1

  return (
    <div className="flex flex-col gap-0.5">
      {stops.map((stop, i) => {
        const name     = stop.local ?? stop.destination_city ?? '—'
        const isActive = i === activeIdx
        const isDone   = currentIdx < 0 ? isCompleted(stop) : i < activeIdx
        return (
          <span
            key={stop.stop_id ?? i}
            title={name}
            className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full w-fit max-w-[120px] truncate flex items-center gap-1 ${
              isActive
                ? 'bg-accent/10 text-accent border border-accent/20'
                : isDone
                ? 'text-gray-300 bg-gray-50'
                : 'text-gray-200'
            }`}
          >
            {stop.on_time_status && (
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${stop.on_time_status === 'ON TIME' ? 'bg-green-500' : 'bg-red-500'}`} />
            )}
            {isActive && <span className="shrink-0 text-[8px]">→</span>}
            {isDone && !isActive && <span className="shrink-0 text-[8px]">✓</span>}
            <span className="truncate">{name}</span>
          </span>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 9: Quitar el estado de expansión y agregar cumplimiento en el componente `TripTable`**

Reemplazar (líneas correspondientes al inicio del componente, con `expandedId`/`toggleExpand`):

```tsx
export function TripTable({ trips, selectedId, onSelect, onSaved, alertSummary, meta }: Props) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  function toggleExpand(id: string) {
    setExpandedId(prev => (prev === id ? null : id))
  }

  function handleSort(col: SortKey) {
```

por:

```tsx
export function TripTable({ trips, selectedId, onSelect, onSaved, alertSummary, meta }: Props) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  function handleSort(col: SortKey) {
```

- [ ] **Step 10: Mobile — click directo, badge de cumplimiento, sin bloque expandido**

Reemplazar el `onClick` de la card mobile:

```tsx
              onClick={() => toggleExpand(trip.id)}
```

por:

```tsx
              onClick={() => onSelect(trip)}
```

Reemplazar el bloque del badge de estado en la fila 1 mobile (donde se muestra `statusMeta`) agregando el badge de cumplimiento justo después del span de estado:

```tsx
                  <span
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                    style={statusMeta
                      ? { backgroundColor: statusMeta.bg_color, color: statusMeta.text_color }
                      : { backgroundColor: '#f3f4f6', color: '#9ca3af' }}
                  >
                    {currentStatus ?? '—'}
                  </span>
                </div>
              </div>
```

por:

```tsx
                  <span
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                    style={statusMeta
                      ? { backgroundColor: statusMeta.bg_color, color: statusMeta.text_color }
                      : { backgroundColor: '#f3f4f6', color: '#9ca3af' }}
                  >
                    {currentStatus ?? '—'}
                  </span>
                  {stopComplianceSummary(trip.stops ?? []) === 'warn' && (
                    <span className="text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full whitespace-nowrap">OFF TIME</span>
                  )}
                </div>
              </div>
```

Reemplazar el cierre de la card mobile (actual, después de "fila 3: EETT + origen"):

```tsx
              {/* fila 3: EETT + origen */}
              <div className="flex items-center gap-1.5 mt-1 text-[10px] text-gray-400 min-w-0">
                {trip.transporter_profile_id
                  ? <span className="font-medium text-slate-500 truncate max-w-[160px]">{trip.transporter}</span>
                  : <span className="italic">sin EETT</span>}
                {trip.origin && <><span>·</span><span className="truncate max-w-[100px]">{trip.origin}</span></>}
              </div>

              {expandedId === trip.id && (
                <div className="mt-2 -mx-4 border-t border-border/60">
                  <TripRowExpanded
                    trip={trip}
                    meta={meta}
                    onSaved={onSaved}
                    onOpenFull={() => onSelect(trip)}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
```

por:

```tsx
              {/* fila 3: EETT + origen */}
              <div className="flex items-center gap-1.5 mt-1 text-[10px] text-gray-400 min-w-0">
                {trip.transporter_profile_id
                  ? <span className="font-medium text-slate-500 truncate max-w-[160px]">{trip.transporter}</span>
                  : <span className="italic">sin EETT</span>}
                {trip.origin && <><span>·</span><span className="truncate max-w-[100px]">{trip.origin}</span></>}
              </div>
            </div>
          )
        })}
      </div>
```

- [ ] **Step 11: Desktop — quitar `Fragment`/fila expandida, click directo, badge de cumplimiento**

Reemplazar la apertura del `return` dentro del `.map(trip => {...})` (actual):

```tsx
              return (
                <Fragment key={trip.id}>
                <tr
                  onClick={() => toggleExpand(trip.id)}
                  className={`border-b border-border/60 last:border-0 cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-accent/5 border-l-2 border-l-accent'
                      : i % 2 === 1
                      ? 'bg-gray-50/40 hover:bg-gray-50'
                      : 'hover:bg-gray-50/70'
                  }`}
                >
```

por:

```tsx
              return (
                <tr
                  key={trip.id}
                  onClick={() => onSelect(trip)}
                  className={`border-b border-border/60 last:border-0 cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-accent/5 border-l-2 border-l-accent'
                      : i % 2 === 1
                      ? 'bg-gray-50/40 hover:bg-gray-50'
                      : 'hover:bg-gray-50/70'
                  }`}
                >
```

Reemplazar el cierre de la fila (actual, después de la celda Chevron):

```tsx
                  {/* Chevron */}
                  <td className="px-2 py-2.5 text-center">
                    <span className={`text-xs ${isActive ? 'text-accent' : 'text-gray-200'}`}>›</span>
                  </td>
                </tr>
                {expandedId === trip.id && (
                  <tr className="border-b border-border/60">
                    <td colSpan={14} className="p-0">
                      <TripRowExpanded
                        trip={trip}
                        meta={meta}
                        onSaved={onSaved}
                        onOpenFull={() => onSelect(trip)}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              )
            })}
```

por:

```tsx
                  {/* Chevron */}
                  <td className="px-2 py-2.5 text-center">
                    <span className={`text-xs ${isActive ? 'text-accent' : 'text-gray-200'}`}>›</span>
                  </td>
                </tr>
              )
            })}
```

Reemplazar la celda ESTADO para agregar el badge de cumplimiento:

```tsx
                  {/* ESTADO */}
                  <td className="px-3 py-2.5">
                    <span
                      className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
                      style={statusMeta
                        ? { backgroundColor: statusMeta.bg_color, color: statusMeta.text_color }
                        : { backgroundColor: '#f3f4f6', color: '#9ca3af' }}
                    >
                      {currentStatus ?? '—'}
                    </span>
                    {trip.estado_manual && (
                      <span className="text-[8px] text-accent block mt-0.5">override</span>
                    )}
                  </td>
```

por:

```tsx
                  {/* ESTADO */}
                  <td className="px-3 py-2.5">
                    <span
                      className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
                      style={statusMeta
                        ? { backgroundColor: statusMeta.bg_color, color: statusMeta.text_color }
                        : { backgroundColor: '#f3f4f6', color: '#9ca3af' }}
                    >
                      {currentStatus ?? '—'}
                    </span>
                    {trip.estado_manual && (
                      <span className="text-[8px] text-accent block mt-0.5">override</span>
                    )}
                    {stopComplianceSummary(trip.stops ?? []) === 'warn' && (
                      <span className="text-[8px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full block mt-0.5 w-fit">OFF TIME</span>
                    )}
                  </td>
```

Quitar el `return (` que envuelve la fila en `<Fragment key={trip.id}>...` y el `<tr>` condicional de la fila expandida — volver a un `return (<tr ...>...</tr>)` simple (mismo patrón de antes de la sesión anterior, sin `Fragment`, sin la segunda `<tr>` de `colSpan={14}`, sin el `<td colSpan={14}>` con `TripRowExpanded`). La columna "Indicadores" y su `<td><IndicatorDots .../></td>` se mantienen sin cambios.

- [ ] **Step 12: Correr el test de `TripTable` y verificar que pasa**

Run: `cd monitor-app/frontend && npm test -- TripTable`
Expected: `Test Files  1 passed (1)`, 5 tests passed

- [ ] **Step 13: Correr todos los tests y verificar tipos**

Run: `cd monitor-app/frontend && npm test && npx tsc --noEmit`
Expected: todos los tests pasan (StopTimeline sin TripRowExpanded como consumidor, TripTable, y el resto sin regresión), sin errores de tipo

- [ ] **Step 14: Commit**

```bash
git add -A monitor-app/frontend/components/dashboard/TripTable.tsx monitor-app/frontend/components/dashboard/TripTable.test.tsx monitor-app/frontend/components/dashboard/StopTimeline.tsx monitor-app/frontend/components/dashboard/StopTimeline.test.tsx
git rm monitor-app/frontend/components/dashboard/TripRowExpanded.tsx monitor-app/frontend/components/dashboard/TripRowExpanded.test.tsx
git commit -m "feat(diario): fila enriquecida, elimina el paso de 'fila expandida'

El usuario evaluó el rediseño anterior en producción: la fila
expandida no mostraba nada relevante. Se elimina TripRowExpanded — la
fila/card ahora trae la señal de cumplimiento (punto verde/rojo por
parada en Destinos, badge OFF TIME junto a Estado) directamente, sin
necesidad de expandir. Click en la fila abre el detalle completo
directo. StopTimeline promueve on_time_status/milestone_status a la
vista principal (antes solo en el acordeón 'detalle técnico') y pierde
el modo compact, que ya no tiene consumidor."
```

---

### Task 6: `TripSlideOver` — `created_at` + atribución completa del override

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/TripSlideOver.tsx`
- Modify: `monitor-app/frontend/components/dashboard/TripSlideOver.test.tsx`

**Interfaces:**
- Consumes: `Trip.created_at`, `Trip.edited_by` (Task 1).

- [ ] **Step 1: Agregar el test**

Agregar al `describe('TripSlideOver — sin tabs', ...)` existente (junto a los 6 tests ya presentes):

```tsx
it('shows created_at in Resumen', () => {
  const tripWithCreated = { ...baseTrip, created_at: '2026-06-30 08:00:00' }
  render(<TripSlideOver trip={tripWithCreated} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
  expect(screen.getByText('Ingresó al sistema')).toBeInTheDocument()
})

it('shows the editor name in the override attribution when estado_manual is set', () => {
  const tripWithOverride = { ...baseTrip, estado_manual: 'en_seguimiento', edited_at: '2026-07-02 10:15:00', edited_by: 'Felipe Sumadots' }
  render(<TripSlideOver trip={tripWithOverride} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
  expect(screen.getByText(/Felipe Sumadots/)).toBeInTheDocument()
})
```

También actualizar el fixture `baseTrip` del mismo archivo agregando `edited_by: null, created_at: null` (requerido por el tipo `Trip` de Task 1).

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd monitor-app/frontend && npm test -- TripSlideOver`
Expected: FAIL — "Ingresó al sistema" y "Felipe Sumadots" no aparecen en el DOM

- [ ] **Step 3: Agregar `created_at` a la sección Resumen**

Reemplazar (bloque de `MetaField`s en la sección Resumen):

```tsx
              {trip.pipeline_updated_at && (
                <MetaField
                  label="Sincronización pipeline"
                  value={fmtDT(trip.pipeline_updated_at)}
                  icon={<RefreshCw size={9} className="text-gray-400 shrink-0" />}
                />
              )}
            </div>
          </section>
```

por:

```tsx
              {trip.pipeline_updated_at && (
                <MetaField
                  label="Sincronización pipeline"
                  value={fmtDT(trip.pipeline_updated_at)}
                  icon={<RefreshCw size={9} className="text-gray-400 shrink-0" />}
                />
              )}
              {trip.created_at && (
                <MetaField label="Ingresó al sistema" value={fmtDT(trip.created_at)} />
              )}
            </div>
          </section>
```

- [ ] **Step 4: Agregar el nombre del editor a la atribución del override**

Reemplazar:

```tsx
                <span className="text-[10px] text-gray-400">
                  confirmado manualmente el {fmtDT(trip.edited_at)}
                </span>
```

por:

```tsx
                <span className="text-[10px] text-gray-400">
                  confirmado manualmente {trip.edited_by ? `por ${trip.edited_by} ` : ''}el {fmtDT(trip.edited_at)}
                </span>
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd monitor-app/frontend && npm test -- TripSlideOver`
Expected: `Test Files  1 passed (1)`, 8 tests passed

- [ ] **Step 6: Correr todos los tests y verificar tipos**

Run: `cd monitor-app/frontend && npm test && npx tsc --noEmit`
Expected: todos los tests pasan, sin errores de tipo

- [ ] **Step 7: Commit**

```bash
git add monitor-app/frontend/components/dashboard/TripSlideOver.tsx monitor-app/frontend/components/dashboard/TripSlideOver.test.tsx
git commit -m "feat(diario): created_at + nombre del editor en la ficha completa

Resumen gana 'Ingresó al sistema' (created_at). La atribución del
override manual pasa de solo mostrar la fecha a mostrar quién lo hizo
(edited_by, ya resuelto por el backend en Task 1)."
```

---

### Task 7: `TripCard` — tarjeta de viaje para el tablero

**Files:**
- Create: `monitor-app/frontend/components/dashboard/TripCard.tsx`
- Test: `monitor-app/frontend/components/dashboard/TripCard.test.tsx`

**Interfaces:**
- Consumes: `stopComplianceSummary` (Task 2), `StopProgressDots` (Task 3), `IndicatorDots` (ya existe), `classifyTemperature`/`getLatestTemp` (ya existen).
- Produces: `TripCard({ trip: Trip, meta?: TripsMeta | null, onSaved: (t: Trip) => void, onSelect: (t: Trip) => void }): JSX.Element` — usado por `TripBoard` (Task 8).

- [ ] **Step 1: Escribir el test**

```tsx
// monitor-app/frontend/components/dashboard/TripCard.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TripCard } from './TripCard'
import type { Trip } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { patch: vi.fn().mockResolvedValue({}) },
}))

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 't1', source_system: 'qanalytics', client_name: 'walmart', planning_date: '2026-07-02',
    status_reported_at: null, current_status: 'ORIGEN', tractor_plate: 'DRZT17', trailer_plate: null,
    driver_name: 'Navarro Piñango', driver_rut: null, driver_phone: null, transporter: null, transporter_tms: null,
    origin: 'CD Quilicura', cargo_type: 'FRIO', stops: [], activo: true, trabajando: false, asignado: true,
    primera_vuelta: false, estado_manual: null, observaciones: null, comentarios: null,
    fleet_link_id: null, transporter_profile_id: null, manually_edited_fields: [], edited_at: null,
    edited_by: null, updated_at: null, created_at: null,
    source_system_trip_id: '2000711', milestone_status: null, pipeline_updated_at: null,
    ...overrides,
  }
}

describe('TripCard', () => {
  it('renders the plate and driver name', () => {
    render(<TripCard trip={makeTrip()} meta={null} onSaved={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('DRZT17')).toBeInTheDocument()
    expect(screen.getByText('Navarro Piñango')).toBeInTheDocument()
  })

  it('calls onSelect when the card is clicked', () => {
    const onSelect = vi.fn()
    render(<TripCard trip={makeTrip()} meta={null} onSaved={vi.fn()} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('DRZT17'))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
  })

  it('clicking an indicator dot does not call onSelect', () => {
    const onSelect = vi.fn()
    render(<TripCard trip={makeTrip()} meta={null} onSaved={vi.fn()} onSelect={onSelect} />)
    fireEvent.click(screen.getAllByTitle('Activo')[0])
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows an OFF TIME badge when the trip has a compliance problem', () => {
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: null, departure_date: null,
      unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: 'OFF TIME', destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null,
    }]
    render(<TripCard trip={makeTrip({ stops })} meta={null} onSaved={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('OFF TIME')).toBeInTheDocument()
  })

  it('does not show an OFF TIME badge when there is no compliance problem', () => {
    render(<TripCard trip={makeTrip()} meta={null} onSaved={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.queryByText('OFF TIME')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd monitor-app/frontend && npm test -- TripCard`
Expected: FAIL — `Cannot find module './TripCard'`

- [ ] **Step 3: Implementar `TripCard.tsx`**

```tsx
// monitor-app/frontend/components/dashboard/TripCard.tsx
'use client'

import type { Trip, TripsMeta } from '@/lib/types'
import { getLatestTemp, classifyTemperature } from '@/lib/utils/temperature'
import { stopComplianceSummary } from '@/lib/utils/compliance'
import { StopProgressDots } from './StopProgressDots'
import { IndicatorDots } from './IndicatorDots'

interface Props {
  trip:     Trip
  meta?:    TripsMeta | null
  onSaved:  (t: Trip) => void
  onSelect: (t: Trip) => void
}

export function TripCard({ trip, meta, onSaved, onSelect }: Props) {
  const temp       = getLatestTemp(trip.stops ?? [])
  const tempStatus = classifyTemperature(temp, trip.cargo_type, meta?.temperature_ranges ?? [])
  const compliance = stopComplianceSummary(trip.stops ?? [])
  const plate      = trip.tractor_plate ?? trip.trailer_plate ?? null

  return (
    <div
      onClick={() => onSelect(trip)}
      className={`bg-white border rounded-lg p-2.5 mb-2 cursor-pointer hover:shadow-sm transition-shadow ${
        compliance === 'warn' ? 'border-l-[3px] border-l-red-500 border-y-border border-r-border' : 'border-border'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`font-mono text-xs font-bold ${plate ? 'text-slate-800' : 'text-gray-300 italic font-normal'}`}>
          {plate ?? 'sin patente'}
        </span>
        {temp != null && (
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${tempStatus === 'out_of_range' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
            {temp}°C
          </span>
        )}
      </div>
      <p className="text-[11px] text-gray-500 truncate mt-0.5">
        {trip.driver_name ?? <span className="italic text-gray-300">sin conductor</span>}
      </p>
      {(trip.stops?.length ?? 0) > 0 && (
        <div className="mt-1.5">
          <StopProgressDots stops={trip.stops} />
        </div>
      )}
      <div className="flex items-center justify-between mt-1.5">
        <IndicatorDots trip={trip} onSaved={onSaved} />
        {compliance === 'warn' && (
          <span className="text-[8px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">OFF TIME</span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd monitor-app/frontend && npm test -- TripCard`
Expected: `Test Files  1 passed (1)`, 5 tests passed

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/TripCard.tsx monitor-app/frontend/components/dashboard/TripCard.test.tsx
git commit -m "feat(diario): TripCard — tarjeta de viaje para el tablero

Borde rojo + badge OFF TIME cuando stopComplianceSummary detecta un
problema de cumplimiento, sin necesidad de abrir nada."
```

---

### Task 8: `TripBoard` — tablero por estado

**Files:**
- Create: `monitor-app/frontend/components/dashboard/TripBoard.tsx`
- Test: `monitor-app/frontend/components/dashboard/TripBoard.test.tsx`

**Interfaces:**
- Consumes: `TripCard` (Task 7).
- Produces: `TripBoard({ trips: Trip[], groups: {id: string, label: string, statuses: string[]}[], meta?: TripsMeta | null, onSaved: (t: Trip) => void, onSelect: (t: Trip) => void }): JSX.Element` — usado por `page.tsx` (Task 9). `groups` es el mismo `defaultGroups` que `page.tsx` ya calcula para los chips de filtro.

- [ ] **Step 1: Escribir el test**

```tsx
// monitor-app/frontend/components/dashboard/TripBoard.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TripBoard } from './TripBoard'
import type { Trip } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { patch: vi.fn().mockResolvedValue({}) },
}))

function makeTrip(id: string, currentStatus: string): Trip {
  return {
    id, source_system: 'qanalytics', client_name: 'walmart', planning_date: '2026-07-02',
    status_reported_at: null, current_status: currentStatus, tractor_plate: id.toUpperCase(), trailer_plate: null,
    driver_name: 'Conductor', driver_rut: null, driver_phone: null, transporter: null, transporter_tms: null,
    origin: null, cargo_type: null, stops: [], activo: true, trabajando: false, asignado: true,
    primera_vuelta: false, estado_manual: null, observaciones: null, comentarios: null,
    fleet_link_id: null, transporter_profile_id: null, manually_edited_fields: [], edited_at: null,
    edited_by: null, updated_at: null, created_at: null,
    source_system_trip_id: null, milestone_status: null, pipeline_updated_at: null,
  }
}

const groups = [
  { id: 'en_ruta', label: 'En Ruta', statuses: ['ORIGEN', 'RUTA'] },
  { id: 'problema', label: 'Problema', statuses: ['CANCELADO'] },
]

describe('TripBoard', () => {
  it('groups trips into the matching column by current_status', () => {
    const trips = [makeTrip('a', 'ORIGEN'), makeTrip('b', 'CANCELADO')]
    render(<TripBoard trips={trips} groups={groups} meta={null} onSaved={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('En Ruta')).toBeInTheDocument()
    expect(screen.getByText('Problema')).toBeInTheDocument()
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
  })

  it('shows an empty-state message for a column with no trips', () => {
    render(<TripBoard trips={[]} groups={groups} meta={null} onSaved={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getAllByText('Sin viajes').length).toBe(groups.length)
  })

  it('buckets trips whose status matches no group into an "Otro" column', () => {
    const trips = [makeTrip('a', 'ESTADO_DESCONOCIDO')]
    render(<TripBoard trips={trips} groups={groups} meta={null} onSaved={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('Otro')).toBeInTheDocument()
    expect(screen.getByText('A')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd monitor-app/frontend && npm test -- TripBoard`
Expected: FAIL — `Cannot find module './TripBoard'`

- [ ] **Step 3: Implementar `TripBoard.tsx`**

```tsx
// monitor-app/frontend/components/dashboard/TripBoard.tsx
'use client'

import type { Trip, TripsMeta } from '@/lib/types'
import { TripCard } from './TripCard'

interface Group {
  id:       string
  label:    string
  statuses: string[]
}

interface Props {
  trips:    Trip[]
  groups:   Group[]
  meta?:    TripsMeta | null
  onSaved:  (t: Trip) => void
  onSelect: (t: Trip) => void
}

export function TripBoard({ trips, groups, meta, onSaved, onSelect }: Props) {
  function statusOf(trip: Trip): string {
    return trip.estado_manual ?? trip.current_status ?? ''
  }

  const grouped = groups.map(g => ({
    ...g,
    trips: trips.filter(t => g.statuses.includes(statusOf(t))),
  }))
  const ungrouped = trips.filter(t => !groups.some(g => g.statuses.includes(statusOf(t))))

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {grouped.map(g => (
        <div key={g.id} className="flex-none w-[220px] bg-gray-50 rounded-xl p-2">
          <div className="flex items-center justify-between px-1 pb-2">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{g.label}</span>
            <span className="text-[10px] text-gray-400">{g.trips.length}</span>
          </div>
          {g.trips.map(trip => (
            <TripCard key={trip.id} trip={trip} meta={meta} onSaved={onSaved} onSelect={onSelect} />
          ))}
          {g.trips.length === 0 && (
            <p className="text-[10px] text-gray-300 text-center py-4">Sin viajes</p>
          )}
        </div>
      ))}
      {ungrouped.length > 0 && (
        <div className="flex-none w-[220px] bg-gray-50 rounded-xl p-2">
          <div className="flex items-center justify-between px-1 pb-2">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Otro</span>
            <span className="text-[10px] text-gray-400">{ungrouped.length}</span>
          </div>
          {ungrouped.map(trip => (
            <TripCard key={trip.id} trip={trip} meta={meta} onSaved={onSaved} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd monitor-app/frontend && npm test -- TripBoard`
Expected: `Test Files  1 passed (1)`, 3 tests passed

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/TripBoard.tsx monitor-app/frontend/components/dashboard/TripBoard.test.tsx
git commit -m "feat(diario): TripBoard — tablero de viajes agrupado por estado

Recibe los mismos 'groups' que page.tsx ya calcula para los chips de
filtro (defaultGroups) — una sola fuente de verdad para la
agrupación por estado."
```

---

### Task 9: `ViewToggle` + wiring en `page.tsx`

**Files:**
- Create: `monitor-app/frontend/components/dashboard/ViewToggle.tsx`
- Test: `monitor-app/frontend/components/dashboard/ViewToggle.test.tsx`
- Modify: `monitor-app/frontend/app/dashboard/diario/page.tsx`

**Interfaces:**
- Consumes: `TripBoard` (Task 8).
- Produces: `ViewToggle({ value: 'tabla' | 'tablero', onChange: (v) => void }): JSX.Element`.

- [ ] **Step 1: Escribir el test de `ViewToggle`**

```tsx
// monitor-app/frontend/components/dashboard/ViewToggle.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ViewToggle } from './ViewToggle'

describe('ViewToggle', () => {
  it('calls onChange with "tablero" when the tablero button is clicked', () => {
    const onChange = vi.fn()
    render(<ViewToggle value="tabla" onChange={onChange} />)
    fireEvent.click(screen.getByText('Tablero'))
    expect(onChange).toHaveBeenCalledWith('tablero')
  })

  it('calls onChange with "tabla" when the tabla button is clicked', () => {
    const onChange = vi.fn()
    render(<ViewToggle value="tablero" onChange={onChange} />)
    fireEvent.click(screen.getByText('Tabla'))
    expect(onChange).toHaveBeenCalledWith('tabla')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd monitor-app/frontend && npm test -- ViewToggle`
Expected: FAIL — `Cannot find module './ViewToggle'`

- [ ] **Step 3: Implementar `ViewToggle.tsx`**

```tsx
// monitor-app/frontend/components/dashboard/ViewToggle.tsx
'use client'

import { LayoutGrid, List } from 'lucide-react'

export type ViewMode = 'tabla' | 'tablero'

interface Props {
  value:    ViewMode
  onChange: (v: ViewMode) => void
}

export function ViewToggle({ value, onChange }: Props) {
  return (
    <div className="inline-flex border border-border rounded-lg overflow-hidden text-[11px] font-semibold">
      <button
        type="button"
        onClick={() => onChange('tablero')}
        className={`flex items-center gap-1 px-3 py-1.5 transition-colors ${value === 'tablero' ? 'bg-accent text-white' : 'text-gray-500 hover:bg-gray-50'}`}
      >
        <LayoutGrid size={12} /> Tablero
      </button>
      <button
        type="button"
        onClick={() => onChange('tabla')}
        className={`flex items-center gap-1 px-3 py-1.5 transition-colors border-l border-border ${value === 'tabla' ? 'bg-accent text-white' : 'text-gray-500 hover:bg-gray-50'}`}
      >
        <List size={12} /> Tabla
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd monitor-app/frontend && npm test -- ViewToggle`
Expected: `Test Files  1 passed (1)`, 2 tests passed

- [ ] **Step 5: Agregar imports a `page.tsx`**

Reemplazar (líneas 1-14 del archivo actual):

```tsx
'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Search, Loader2, ChevronLeft, ChevronRight, X, Plus, PenLine, Upload } from 'lucide-react'
import { tripsApi } from '@/lib/api/trips'
import { transportersApi } from '@/lib/api/transporters'
import { filterGroupsApi, type FilterGroup, type GroupColor } from '@/lib/api/filterGroups'
import { fetchTripsMeta } from '@/lib/api/tripsMeta'
import type { Trip, ComplianceAlertSummary, TripsMeta } from '@/lib/types'
import { TripTable } from '@/components/dashboard/TripTable'
import { TripSlideOver } from '@/components/dashboard/TripSlideOver'
import { GroupBuilder } from '@/components/dashboard/GroupBuilder'
import { TripCreateSlideOver } from '@/components/dashboard/TripCreateSlideOver'
import { TripBulkUpload } from '@/components/dashboard/TripBulkUpload'
```

por:

```tsx
'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Search, Loader2, ChevronLeft, ChevronRight, X, Plus, PenLine, Upload } from 'lucide-react'
import { tripsApi } from '@/lib/api/trips'
import { transportersApi } from '@/lib/api/transporters'
import { filterGroupsApi, type FilterGroup, type GroupColor } from '@/lib/api/filterGroups'
import { fetchTripsMeta } from '@/lib/api/tripsMeta'
import type { Trip, ComplianceAlertSummary, TripsMeta } from '@/lib/types'
import { TripTable } from '@/components/dashboard/TripTable'
import { TripBoard } from '@/components/dashboard/TripBoard'
import { ViewToggle, type ViewMode } from '@/components/dashboard/ViewToggle'
import { TripSlideOver } from '@/components/dashboard/TripSlideOver'
import { GroupBuilder } from '@/components/dashboard/GroupBuilder'
import { TripCreateSlideOver } from '@/components/dashboard/TripCreateSlideOver'
import { TripBulkUpload } from '@/components/dashboard/TripBulkUpload'

const VIEW_MODE_STORAGE_KEY = 'diario:vista-en-curso'
```

- [ ] **Step 6: Agregar el estado `viewMode` con persistencia en `localStorage`**

Reemplazar (línea con `const [showBulkUpload, ...]`):

```tsx
  const [showBulkUpload,      setShowBulkUpload]      = useState(false)
```

por:

```tsx
  const [showBulkUpload,      setShowBulkUpload]      = useState(false)
  const [viewMode,            setViewMode]            = useState<ViewMode>('tabla')
```

Agregar, después del `useEffect` que carga `alertSummary`/`customGroups`/`tripsMeta` (justo después de su cierre `}, [])`):

```tsx
  useEffect(() => {
    const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    if (saved === 'tabla' || saved === 'tablero') setViewMode(saved)
  }, [])

  function handleViewModeChange(v: ViewMode) {
    setViewMode(v)
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, v)
  }
```

- [ ] **Step 7: Renderizar el `ViewToggle` y el tablero condicional**

Reemplazar (la barra de acciones "Agregar viaje"):

```tsx
          {/* Barra de acciones — agregar viaje */}
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={() => setShowBulkUpload(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-accent transition-colors"
            >
              <Upload size={12} />
              Carga masiva (CSV)
            </button>
            <button
              data-tour="trip-create-btn"
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 bg-accent text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-accent/90 transition-colors"
            >
              <Plus size={13} />
              Agregar viaje
            </button>
          </div>
```

por:

```tsx
          {/* Barra de acciones — vista + agregar viaje */}
          <div className="flex items-center justify-between gap-3">
            {tab === 'en_curso' ? (
              <ViewToggle value={viewMode} onChange={handleViewModeChange} />
            ) : <div />}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowBulkUpload(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-accent transition-colors"
              >
                <Upload size={12} />
                Carga masiva (CSV)
              </button>
              <button
                data-tour="trip-create-btn"
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 bg-accent text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-accent/90 transition-colors"
              >
                <Plus size={13} />
                Agregar viaje
              </button>
            </div>
          </div>
```

Reemplazar el bloque de la tabla:

```tsx
          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-20 text-gray-400 gap-2 text-sm">
              <Loader2 size={16} className="animate-spin" /> Cargando…
            </div>
          ) : (
            <TripTable
              trips={trips}
              selectedId={selected?.id ?? null}
              onSelect={setSelected}
              onSaved={handleSaved}
              alertSummary={alertSummary}
              meta={tripsMeta}
            />
          )}
```

por:

```tsx
          {/* Table / Board */}
          {loading ? (
            <div className="flex items-center justify-center py-20 text-gray-400 gap-2 text-sm">
              <Loader2 size={16} className="animate-spin" /> Cargando…
            </div>
          ) : tab === 'en_curso' && viewMode === 'tablero' ? (
            <TripBoard
              trips={trips}
              groups={defaultGroups}
              meta={tripsMeta}
              onSaved={handleSaved}
              onSelect={setSelected}
            />
          ) : (
            <TripTable
              trips={trips}
              selectedId={selected?.id ?? null}
              onSelect={setSelected}
              onSaved={handleSaved}
              alertSummary={alertSummary}
              meta={tripsMeta}
            />
          )}
```

- [ ] **Step 8: Verificar tipos**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 9: Correr todos los tests**

Run: `cd monitor-app/frontend && npm test`
Expected: todos los test files pasan (Tasks 2, 3, 4, 5, 6, 7, 8, 9)

- [ ] **Step 10: Commit**

```bash
git add monitor-app/frontend/components/dashboard/ViewToggle.tsx monitor-app/frontend/components/dashboard/ViewToggle.test.tsx monitor-app/frontend/app/dashboard/diario/page.tsx
git commit -m "feat(diario): selector Tabla/Tablero en 'En Curso'

El operador elige cómo visualizar (preferencia persistida en
localStorage). 'Historial' queda fijo en tabla por volumen — decisión
explícita del usuario tras evaluar el trade-off de escala. Ambas
vistas comparten los mismos datos/filtros ya cargados por page.tsx y
abren el mismo TripSlideOver al seleccionar un viaje."
```

---

### Task 10: Verificación end-to-end

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Correr todo el suite de tests**

Run: `cd monitor-app/frontend && npm test`
Expected: todos los test files pasan

- [ ] **Step 2: Verificar tipos en todo el proyecto**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 3: Build de producción**

Run: `cd monitor-app/frontend && npm run build`
Expected: build exitoso, sin errores

- [ ] **Step 4: Verificar backend**

Run: `cd monitor-app/backend/api && ./venv/bin/python -m pytest tests/ -q`
Expected: `12 passed` (mismo baseline — Task 1 solo agrega columnas seleccionadas, no lógica)

- [ ] **Step 5: Smoke test manual en navegador**

1. Levantar backend (`uvicorn app.main:app --port 8001` desde `monitor-app/backend/api`) y frontend (`npm run dev`, con `FASTAPI_URL=http://localhost:8001` en `.env.local`).
2. Ir a `/dashboard/diario`, pestaña "En Curso" → debe verse el `ViewToggle` (Tabla/Tablero).
3. Click en "Tablero" → columnas por estado con tarjetas; una tarjeta con una parada `OFF TIME` debe tener borde rojo y badge "OFF TIME".
4. Click en una tarjeta → debe abrir `TripSlideOver` directo (sin paso intermedio).
5. Volver a "Tabla" → la fila debe mostrar el punto verde/rojo en la columna Destinos y el badge OFF TIME junto al Estado si corresponde. Click en la fila → mismo detalle.
6. Recargar la página → el `ViewToggle` debe recordar la última vista elegida (localStorage).
7. Click en un indicador con candado (si hay un viaje con `manually_edited_fields`) → el tooltip debe mostrar quién y cuándo lo congeló.
8. Abrir la ficha completa de un viaje → "Resumen" debe mostrar "Ingresó al sistema"; si tiene `estado_manual`, la atribución debe incluir el nombre del editor.
9. "Historial" → confirmar que NO aparece el `ViewToggle`, se mantiene fijo en tabla.

Expected: todo lo anterior funciona sin errores de consola.

- [ ] **Step 6: Actualizar `AGENTLOG.md`**

Agregar una entrada nueva documentando: qué se implementó, referencia a `specs/2026-07-02-diario-rediseno-completo-design.md` y este plan, y que reemplaza el enfoque anterior (fila expandible) tras feedback del usuario en producción.

---

## Self-Review

**Cobertura de la spec:** los 5 puntos priorizados por el usuario están cubiertos — cumplimiento por parada visible sin clics (Task 5, `StopTimeline`/`StopPills`/badges), campos congelados señalizados (Task 4), atribución de edición (Tasks 1, 6), `created_at` (Tasks 1, 6), y RLS queda explícitamente fuera (tratado aparte). La decisión de toggle Tabla/Tablero solo en "En Curso" está en Task 9. La eliminación de `TripRowExpanded` y el paso intermedio está en Task 5.

**Placeholders:** ninguno — cada step tiene código completo o comandos exactos con output esperado.

**Consistencia de tipos:** `Trip.edited_by`/`Trip.created_at` (Task 1) se usan con los mismos nombres en `IndicatorDots` (Task 4), `TripSlideOver` (Task 6), y los fixtures `makeTrip`/`baseTrip` de cada archivo de test tocado. `stopComplianceSummary` (Task 2) devuelve `'ok' | 'warn' | null` y se consume con esa misma unión en `TripTable` (Task 5), `TripCard` (Task 7) — nunca se compara contra un valor fuera de esa unión. `StopProgressDots` (Task 3) y `TripBoard`'s `Group` interface (Task 8) no se redefinen en otro lugar.

**Nota para el plan de implementación (dependencias entre tasks):** Task 5 depende de Tasks 2 (compliance) — no de 3 (StopProgressDots, que es solo para TripCard/Task 7) ni de 4 estrictamente, aunque conviene hacer 4 antes de 5 para no reabrir `IndicatorDots.test.tsx` dos veces. Tasks 7-8-9 dependen de 2, 3, 4 (ya deben estar hechas). El orden 1→2→3→4→5→6→7→8→9→10 definido arriba respeta todas las dependencias reales.
