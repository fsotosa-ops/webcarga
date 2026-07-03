# Diario — Fechas por TMS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar cómo el frontend muestra las fechas de cada parada (llegada/salida, real o planificada) en una sola fórmula agnóstica de TMS, promoverla a `TripTable`/`TripCard` como señal de ETA, agregar "hace X" (tiempo desde el último reporte del TMS) a ambos, y agregar tag de TMS + `client_name` a `TripCard`.

**Architecture:** Una función pura nueva (`describeStopTiming`) en `lib/utils/temperature.ts` reemplaza la lógica por-estado que hoy tiene `StopTimeline` para el texto de fecha, y se reutiliza tal cual en `TripTable`/`TripCard`. `TripStop` gana un campo nuevo (`departure_date_prog`, salida planificada) que hoy no llega poblado desde el backend (requiere un cambio en Mage, fuera de este repo) pero deja el frontend listo para consumirlo.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind CSS, Vitest + React Testing Library.

## Global Constraints

- `describeStopTiming(stop)` es la única fuente de verdad para el texto de fecha de una parada — ni `StopTimeline` ni `TripTable` ni `TripCard` reimplementan esta lógica por su cuenta.
- Fórmula exacta: si `arrival_date` existe → `"llegó {fmtShort(arrival_date)}"`, si no y `planning_date` existe → `"llega ~{fmtShort(planning_date)}"`, si no → nada. Si `departure_date` existe → `"salió {fmtShort(departure_date)}"`, si no y `departure_date_prog` existe → `"sale ~{fmtShort(departure_date_prog)}"`, si no → nada. Ambas partes (si existen) se unen con `" · "`. Si ninguna existe, la función devuelve `null`.
- `departure_date_prog` es opcional (`string | null`) en `TripStop` — hoy siempre `null` en producción (Mage todavía no lo puebla), no debe romper nada mientras tanto.
- Ningún elemento nuevo (ETA, "hace X", tag de TMS) se muestra cuando no hay dato — nunca un "—" o espacio vacío sin sentido.
- Sin cambios de backend — `_TRIP_SELECT` en `trips.py` ya selecciona `t.stops` completo (jsonb), cualquier key nueva llega automáticamente al frontend.

---

### Task 1: `TripStop.departure_date_prog` — tipo nuevo + fixtures

**Files:**
- Modify: `monitor-app/frontend/lib/types.ts`
- Modify: `monitor-app/frontend/components/dashboard/StopProgressDots.test.tsx`
- Modify: `monitor-app/frontend/lib/utils/compliance.test.ts`
- Modify: `monitor-app/frontend/components/dashboard/TripTable.test.tsx`
- Modify: `monitor-app/frontend/components/dashboard/TripCard.test.tsx`
- Modify: `monitor-app/frontend/components/dashboard/TripSlideOver.test.tsx`

**Interfaces:**
- Produces: `TripStop.departure_date_prog: string | null` — usado por Task 2 (`describeStopTiming`).

**Contexto:** Agregar un campo nuevo a `TripStop` hace que TypeScript exija esa propiedad en cada objeto literal ya tipado como `TripStop`/`Trip['stops']` en los tests — hay que actualizar 6 archivos que construyen esos literales. `StopTimeline.test.tsx` NO está en esta lista porque se reescribe completo en la Tarea 3 (ya incluirá el campo nuevo ahí).

- [ ] **Step 1: Agregar el campo a `TripStop`**

Reemplazar (en `lib/types.ts`, la definición actual de `TripStop`):

```ts
export type TripStop = {
  stop_id:            string
  local:              string | null
  planning_date:      string | null
  arrival_date:       string | null
  departure_date:     string | null
  unload_start:       string | null
  unload_end:         string | null
  gps_arrival_date:   string | null
  gps_departure_date: string | null
  on_time_status:     'ON TIME' | 'OFF TIME' | null
  destination_city:   string | null
  destination_region: string | null
  s2s:                string | null
  temperature:        number | null
  milestone_status:   string | null  // per-stop, distinct from Trip.milestone_status (trip-level)
}
```

por:

```ts
export type TripStop = {
  stop_id:             string
  local:               string | null
  planning_date:       string | null
  arrival_date:        string | null
  departure_date:      string | null
  departure_date_prog: string | null  // salida planificada — hoy solo la puebla Wingsuite (pendiente de un cambio en Mage), null para el resto
  unload_start:        string | null
  unload_end:          string | null
  gps_arrival_date:    string | null
  gps_departure_date:  string | null
  on_time_status:      'ON TIME' | 'OFF TIME' | null
  destination_city:    string | null
  destination_region:  string | null
  s2s:                 string | null
  temperature:         number | null
  milestone_status:    string | null  // per-stop, distinct from Trip.milestone_status (trip-level)
}
```

- [ ] **Step 2: Actualizar el fixture de `StopProgressDots.test.tsx`**

Reemplazar (líneas 6-15):

```tsx
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
```

por:

```tsx
function makeStop(overrides: Partial<TripStop>): TripStop {
  return {
    stop_id: 's1', local: 'Parada Test', planning_date: null,
    arrival_date: null, departure_date: null, departure_date_prog: null,
    unload_start: null, unload_end: null,
    gps_arrival_date: null, gps_departure_date: null, on_time_status: null,
    destination_city: null, destination_region: null, s2s: null,
    temperature: null, milestone_status: null,
    ...overrides,
  }
}
```

- [ ] **Step 3: Actualizar el fixture de `lib/utils/compliance.test.ts`**

Reemplazar (líneas 5-14):

```ts
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
```

por:

```ts
function makeStop(overrides: Partial<TripStop>): TripStop {
  return {
    stop_id: 's1', local: 'Parada', planning_date: null,
    arrival_date: null, departure_date: null, departure_date_prog: null,
    unload_start: null, unload_end: null,
    gps_arrival_date: null, gps_departure_date: null, on_time_status: null,
    destination_city: null, destination_region: null, s2s: null,
    temperature: null, milestone_status: null,
    ...overrides,
  }
}
```

- [ ] **Step 4: Actualizar el literal de `TripTable.test.tsx`**

Reemplazar (líneas 50-55, dentro de "shows an OFF TIME compliance badge..."):

```tsx
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: null, departure_date: null,
      unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: 'OFF TIME', destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null,
    }]
```

por:

```tsx
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: null, departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: 'OFF TIME', destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null,
    }]
```

- [ ] **Step 5: Actualizar el literal de `TripCard.test.tsx`**

Reemplazar (líneas 51-56, dentro de "shows an OFF TIME badge..."):

```tsx
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: null, departure_date: null,
      unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: 'OFF TIME', destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null,
    }]
```

por:

```tsx
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: null, departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: 'OFF TIME', destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null,
    }]
```

- [ ] **Step 6: Actualizar los 2 literales de `TripSlideOver.test.tsx`**

Reemplazar (líneas 111-118, dentro de "promotes Ruta above Datos operativos..."):

```tsx
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: null, departure_date: null,
      unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: null, destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null,
    }]
```

por:

```tsx
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: null, departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: null, destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null,
    }]
```

Reemplazar (líneas 135-141, dentro de "shows a temperature badge in the header..."):

```tsx
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: '2026-07-02 10:00:00', departure_date: null,
      unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: null, destination_city: null, destination_region: null, s2s: null,
      temperature: 4, milestone_status: null,
    }]
```

por:

```tsx
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: '2026-07-02 10:00:00', departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: null, destination_city: null, destination_region: null, s2s: null,
      temperature: 4, milestone_status: null,
    }]
```

- [ ] **Step 7: Verificar tipos**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: sin errores (todos los literales `TripStop` ahora incluyen el campo nuevo)

- [ ] **Step 8: Correr todos los tests**

Run: `cd monitor-app/frontend && npm test`
Expected: todos los test files pasan sin cambios de comportamiento (este task solo agrega un campo, no cambia lógica)

- [ ] **Step 9: Commit**

```bash
git add monitor-app/frontend/lib/types.ts monitor-app/frontend/components/dashboard/StopProgressDots.test.tsx monitor-app/frontend/lib/utils/compliance.test.ts monitor-app/frontend/components/dashboard/TripTable.test.tsx monitor-app/frontend/components/dashboard/TripCard.test.tsx monitor-app/frontend/components/dashboard/TripSlideOver.test.tsx
git commit -m "feat(diario): TripStop gana departure_date_prog

Campo nuevo para la salida planificada de una parada — hoy siempre
null en producción (pendiente de un cambio en Mage que pueble este
dato desde stg_wingsuite_trips), pero deja el frontend listo para
consumirlo sin romper nada mientras tanto."
```

---

### Task 2: `describeStopTiming` — fórmula única de fecha por parada

**Files:**
- Modify: `monitor-app/frontend/lib/utils/temperature.ts`
- Create: `monitor-app/frontend/lib/utils/temperature.test.ts`

**Interfaces:**
- Consumes: `fmtShort` de `lib/utils/datetime.ts` (ya existe).
- Produces: `describeStopTiming(stop: TripStop): string | null` — usado por Task 3 (`StopTimeline`), Task 4 (`TripTable`), Task 5 (`TripCard`).

- [ ] **Step 1: Escribir el test (falla porque la función no existe)**

```ts
// monitor-app/frontend/lib/utils/temperature.test.ts
import { describe, it, expect } from 'vitest'
import { describeStopTiming } from './temperature'
import type { TripStop } from '@/lib/types'

function makeStop(overrides: Partial<TripStop>): TripStop {
  return {
    stop_id: 's1', local: 'Parada', planning_date: null,
    arrival_date: null, departure_date: null, departure_date_prog: null,
    unload_start: null, unload_end: null,
    gps_arrival_date: null, gps_departure_date: null, on_time_status: null,
    destination_city: null, destination_region: null, s2s: null,
    temperature: null, milestone_status: null,
    ...overrides,
  }
}

describe('describeStopTiming', () => {
  it('returns null when no timing field has data', () => {
    expect(describeStopTiming(makeStop({}))).toBeNull()
  })

  it('shows real arrival and real departure when both exist', () => {
    const stop = makeStop({ arrival_date: '2026-07-02 10:00:00', departure_date: '2026-07-02 11:00:00' })
    expect(describeStopTiming(stop)).toMatch(/^llegó \d{2}:\d{2} · salió \d{2}:\d{2}$/)
  })

  it('falls back to planned arrival (ETA) when there is no real arrival', () => {
    const stop = makeStop({ planning_date: '2026-07-02 08:00:00' })
    expect(describeStopTiming(stop)).toMatch(/^llega ~\d{2}:\d{2}$/)
  })

  it('falls back to planned departure when there is no real departure', () => {
    const stop = makeStop({ arrival_date: '2026-07-02 10:00:00', departure_date_prog: '2026-07-02 12:00:00' })
    expect(describeStopTiming(stop)).toMatch(/^llegó \d{2}:\d{2} · sale ~\d{2}:\d{2}$/)
  })

  it('prefers real departure over planned departure when both exist', () => {
    const stop = makeStop({
      arrival_date: '2026-07-02 10:00:00',
      departure_date: '2026-07-02 11:00:00',
      departure_date_prog: '2026-07-02 15:00:00',
    })
    const result = describeStopTiming(stop)
    expect(result).toMatch(/^llegó \d{2}:\d{2} · salió \d{2}:\d{2}$/)
    expect(result).not.toContain('~')
  })

  it('shows only the arrival segment when there is no departure data at all', () => {
    const stop = makeStop({ arrival_date: '2026-07-02 10:00:00' })
    expect(describeStopTiming(stop)).toMatch(/^llegó \d{2}:\d{2}$/)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd monitor-app/frontend && npm test -- temperature`
Expected: FAIL — `describeStopTiming is not a function` (o error de import)

- [ ] **Step 3: Implementar `describeStopTiming`**

Reemplazar el import del inicio de `lib/utils/temperature.ts` (línea 1):

```ts
import type { TripStop, TemperatureRangeMeta } from '@/lib/types'
```

por:

```ts
import type { TripStop, TemperatureRangeMeta } from '@/lib/types'
import { fmtShort } from './datetime'
```

Agregar al final del archivo:

```ts

// Describe la llegada/salida de una parada con una sola fórmula, agnóstica
// de TMS y de estado (done/active/pending): prefiere el dato real, cae a lo
// planificado cuando no hay real todavía, y no muestra nada si ninguno existe.
export function describeStopTiming(stop: TripStop): string | null {
  const arrival = stop.arrival_date
    ? `llegó ${fmtShort(stop.arrival_date)}`
    : stop.planning_date
    ? `llega ~${fmtShort(stop.planning_date)}`
    : null

  const departure = stop.departure_date
    ? `salió ${fmtShort(stop.departure_date)}`
    : stop.departure_date_prog
    ? `sale ~${fmtShort(stop.departure_date_prog)}`
    : null

  const parts = [arrival, departure].filter((p): p is string => p != null)
  return parts.length > 0 ? parts.join(' · ') : null
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd monitor-app/frontend && npm test -- temperature`
Expected: `Test Files  1 passed (1)`, 6 tests passed

- [ ] **Step 5: Correr todos los tests y verificar tipos**

Run: `cd monitor-app/frontend && npm test && npx tsc --noEmit`
Expected: todos los tests pasan, sin errores de tipo

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/lib/utils/temperature.ts monitor-app/frontend/lib/utils/temperature.test.ts
git commit -m "feat(diario): describeStopTiming — fórmula única de fecha por parada

Reemplaza la necesidad de ramas por estado (done/active/pending) para
mostrar fechas: prefiere el dato real, cae a lo planificado cuando no
hay real todavía. Reutilizable por StopTimeline, TripTable y TripCard
sin duplicar lógica."
```

---

### Task 3: `StopTimeline` usa `describeStopTiming`

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/StopTimeline.tsx`
- Modify: `monitor-app/frontend/components/dashboard/StopTimeline.test.tsx`

**Interfaces:**
- Consumes: `describeStopTiming` (Task 2).
- Sin cambio de firma pública del componente (`{ stops: TripStop[] }`).

**Contexto:** Hoy el texto de fecha de cada parada depende de su estado (done/active/pending) — solo las paradas "done" muestran algo (`✓ llegó X · salió Y`), las demás muestran solo "en camino"/"pendiente" sin ninguna fecha, aunque Wingsuite/Sodimac sí tengan una `planning_date` (ETA) disponible para esas paradas. Este task usa `describeStopTiming` para todas las paradas, con el mismo texto "en camino"/"pendiente" como fallback solo cuando no hay ningún dato de fecha.

- [ ] **Step 1: Reemplazar el archivo completo `StopTimeline.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StopTimeline } from './StopTimeline'
import type { TripStop } from '@/lib/types'

function makeStop(overrides: Partial<TripStop>): TripStop {
  return {
    stop_id: 's1', local: 'Parada Test', planning_date: null,
    arrival_date: null, departure_date: null, departure_date_prog: null,
    unload_start: null, unload_end: null,
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

  it('shows the planned arrival (ETA) for a pending stop when planning_date is present', () => {
    const stops = [
      makeStop({ stop_id: 'a', local: 'Hecha', arrival_date: '2026-07-02 10:00:00' }),
      makeStop({ stop_id: 'b', local: 'Con ETA', planning_date: '2026-07-02 14:00:00' }),
    ]
    render(<StopTimeline stops={stops} />)
    expect(screen.getByText(/llega ~\d{2}:\d{2}/)).toBeInTheDocument()
  })

  it('shows the planned arrival (ETA) for the active stop when planning_date is present', () => {
    const stops = [makeStop({ stop_id: 'a', local: 'Activa', planning_date: '2026-07-02 09:00:00' })]
    render(<StopTimeline stops={stops} />)
    expect(screen.getByText(/llega ~\d{2}:\d{2}/)).toBeInTheDocument()
    expect(screen.queryByText('en camino')).not.toBeInTheDocument()
  })

  it('shows the planned departure for a completed stop when there is no real departure yet', () => {
    const stops = [makeStop({ stop_id: 'a', local: 'Parada', arrival_date: '2026-07-02 10:00:00', departure_date_prog: '2026-07-02 12:00:00' })]
    render(<StopTimeline stops={stops} />)
    expect(screen.getByText(/sale ~\d{2}:\d{2}/)).toBeInTheDocument()
  })

  it('still falls back to "pendiente" when a pending stop has no timing data at all', () => {
    const stops = [
      makeStop({ stop_id: 'a', local: 'Hecha', arrival_date: '2026-07-02 10:00:00' }),
      makeStop({ stop_id: 'b', local: 'Activa' }),
      makeStop({ stop_id: 'c', local: 'Sin datos' }),
    ]
    render(<StopTimeline stops={stops} />)
    expect(screen.getByText('pendiente')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd monitor-app/frontend && npm test -- StopTimeline`
Expected: FAIL — los 3 tests nuevos (ETA en pending/active, salida planificada) fallan porque el componente todavía no usa `describeStopTiming`

- [ ] **Step 3: Reemplazar el archivo completo `StopTimeline.tsx`**

```tsx
'use client'

import type { TripStop } from '@/lib/types'
import { stopWasVisited, describeStopTiming } from '@/lib/utils/temperature'

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
        const timing = describeStopTiming(stop)
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
                {state === 'done' && '✓ '}
                {timing ?? (state === 'active' ? 'en camino' : 'pendiente')}
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

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd monitor-app/frontend && npm test -- StopTimeline`
Expected: `Test Files  1 passed (1)`, 10 tests passed

- [ ] **Step 5: Correr todos los tests y verificar tipos**

Run: `cd monitor-app/frontend && npm test && npx tsc --noEmit`
Expected: todos los tests pasan, sin errores de tipo

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/components/dashboard/StopTimeline.tsx monitor-app/frontend/components/dashboard/StopTimeline.test.tsx
git commit -m "feat(diario): StopTimeline muestra la fecha planificada de cada parada

Antes solo las paradas completadas mostraban alguna fecha ('en
camino'/'pendiente' para el resto, sin ETA aunque el TMS la reportara).
Usa describeStopTiming para todas las paradas — resuelve que Wingsuite
no mostraba su hora planificada en la vista principal."
```

---

### Task 4: `TripTable` — ETA + tiempo desde el último reporte

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/TripTable.tsx`
- Modify: `monitor-app/frontend/components/dashboard/TripTable.test.tsx`

**Interfaces:**
- Consumes: `describeStopTiming`, `getActiveStop` (ya existe en `temperature.ts`) (Task 2), `formatRelativeTime` (ya existe, de la spec del modal).
- Sin cambio de firma pública del componente.

- [ ] **Step 1: Agregar los tests**

Agregar al `describe('TripTable', ...)` existente (junto a los ya presentes, sin borrar ninguno):

```tsx
  it('shows the ETA of the active stop next to the status', () => {
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: '2026-07-02 09:00:00', arrival_date: null, departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: null, destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null,
    }]
    render(<TripTable trips={[makeTrip('t1', { stops })]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getAllByText(/llega ~\d{2}:\d{2}/).length).toBeGreaterThan(0)
  })

  it('shows time since the last TMS report next to the status', () => {
    const trip = makeTrip('t1', { status_reported_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() })
    render(<TripTable trips={[trip]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getAllByText(/hace 5 min/).length).toBeGreaterThan(0)
  })
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd monitor-app/frontend && npm test -- TripTable`
Expected: FAIL — los 2 tests nuevos fallan (el componente todavía no muestra ETA ni tiempo relativo)

- [ ] **Step 3: Agregar los imports**

Reemplazar (líneas 8-9):

```tsx
import { getLatestTemp, classifyTemperature } from '@/lib/utils/temperature'
import { stopComplianceSummary } from '@/lib/utils/compliance'
```

por:

```tsx
import { getLatestTemp, classifyTemperature, getActiveStop, describeStopTiming } from '@/lib/utils/temperature'
import { stopComplianceSummary } from '@/lib/utils/compliance'
import { formatRelativeTime } from '@/lib/utils/datetime'
```

- [ ] **Step 4: Agregar ETA + "hace X" en la vista mobile**

Reemplazar (fila 3, "EETT + origen", el último bloque dentro de la card mobile antes del cierre):

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

por:

```tsx
              {/* fila 3: EETT + origen */}
              <div className="flex items-center gap-1.5 mt-1 text-[10px] text-gray-400 min-w-0">
                {trip.transporter_profile_id
                  ? <span className="font-medium text-slate-500 truncate max-w-[160px]">{trip.transporter}</span>
                  : <span className="italic">sin EETT</span>}
                {trip.origin && <><span>·</span><span className="truncate max-w-[100px]">{trip.origin}</span></>}
              </div>

              {/* fila 4: ETA de la parada activa + tiempo desde el último reporte TMS */}
              {(() => {
                const activeStop = getActiveStop(trip.stops ?? [])
                const eta = activeStop ? describeStopTiming(activeStop) : null
                const since = formatRelativeTime(trip.status_reported_at)
                if (!eta && since === '—') return null
                return (
                  <div className="flex items-center gap-1.5 mt-1 text-[10px] text-gray-400 min-w-0">
                    {eta && <span className="truncate">{eta}</span>}
                    {eta && since !== '—' && <span>·</span>}
                    {since !== '—' && <span className="whitespace-nowrap">{since}</span>}
                  </div>
                )
              })()}
            </div>
          )
        })}
      </div>
```

- [ ] **Step 5: Agregar ETA + "hace X" en la columna ESTADO de la vista desktop**

Reemplazar (la celda ESTADO):

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
                    {(() => {
                      const activeStop = getActiveStop(trip.stops ?? [])
                      const eta = activeStop ? describeStopTiming(activeStop) : null
                      return eta ? <span className="text-[9px] text-gray-400 block mt-0.5 truncate max-w-[100px]">{eta}</span> : null
                    })()}
                    {(() => {
                      const since = formatRelativeTime(trip.status_reported_at)
                      return since !== '—' ? <span className="text-[9px] text-gray-300 block mt-0.5 whitespace-nowrap">{since}</span> : null
                    })()}
                  </td>
```

- [ ] **Step 6: Correr los tests y verificar que pasan**

Run: `cd monitor-app/frontend && npm test -- TripTable`
Expected: `Test Files  1 passed (1)`, 8 tests passed

- [ ] **Step 7: Correr todos los tests y verificar tipos**

Run: `cd monitor-app/frontend && npm test && npx tsc --noEmit`
Expected: todos los tests pasan, sin errores de tipo

- [ ] **Step 8: Commit**

```bash
git add monitor-app/frontend/components/dashboard/TripTable.tsx monitor-app/frontend/components/dashboard/TripTable.test.tsx
git commit -m "feat(diario): TripTable muestra ETA y tiempo sin actualizar

Reutiliza describeStopTiming (parada activa) y formatRelativeTime
(status_reported_at) — ambas señales ya monitoreables sin abrir el
detalle, junto al badge de estado, en mobile y desktop."
```

---

### Task 5: `TripCard` — tag de TMS, cliente, ETA + tiempo desde el último reporte

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/TripTable.tsx` (exportar `TmsChip`)
- Modify: `monitor-app/frontend/components/dashboard/TripCard.tsx`
- Modify: `monitor-app/frontend/components/dashboard/TripCard.test.tsx`

**Interfaces:**
- Consumes: `TmsChip` (exportado de `TripTable.tsx`), `describeStopTiming`/`getActiveStop` (Task 2), `formatRelativeTime` (ya existe).
- Sin cambio de firma pública de `TripCard`.

- [ ] **Step 1: Agregar los tests**

Agregar al `describe('TripCard', ...)` existente:

```tsx
  it('shows a TMS chip and the client name', () => {
    render(<TripCard trip={makeTrip()} meta={null} onSaved={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('QAN')).toBeInTheDocument()
    expect(screen.getByText(/walmart/)).toBeInTheDocument()
  })

  it('shows the ETA of the active stop', () => {
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: '2026-07-02 09:00:00', arrival_date: null, departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: null, destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null,
    }]
    render(<TripCard trip={makeTrip({ stops })} meta={null} onSaved={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText(/llega ~\d{2}:\d{2}/)).toBeInTheDocument()
  })

  it('shows time since the last TMS report', () => {
    const trip = makeTrip({ status_reported_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() })
    render(<TripCard trip={trip} meta={null} onSaved={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText(/hace 5 min/)).toBeInTheDocument()
  })
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd monitor-app/frontend && npm test -- TripCard`
Expected: FAIL — los 3 tests nuevos fallan (`TripCard` todavía no muestra TMS, cliente, ETA ni tiempo relativo)

- [ ] **Step 3: Exportar `TmsChip` desde `TripTable.tsx`**

Reemplazar (línea 13):

```tsx
function TmsChip({ tms, meta }: { tms: string; meta?: TripsMeta | null }) {
```

por:

```tsx
export function TmsChip({ tms, meta }: { tms: string; meta?: TripsMeta | null }) {
```

- [ ] **Step 4: Reemplazar el archivo completo `TripCard.tsx`**

```tsx
'use client'

import type { Trip, TripsMeta } from '@/lib/types'
import { getLatestTemp, classifyTemperature, getActiveStop, describeStopTiming } from '@/lib/utils/temperature'
import { stopComplianceSummary } from '@/lib/utils/compliance'
import { formatRelativeTime } from '@/lib/utils/datetime'
import { StopProgressDots } from './StopProgressDots'
import { IndicatorDots } from './IndicatorDots'
import { TmsChip } from './TripTable'

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
  const activeStop = getActiveStop(trip.stops ?? [])
  const eta        = activeStop ? describeStopTiming(activeStop) : null
  const since      = formatRelativeTime(trip.status_reported_at)

  return (
    <div
      onClick={() => onSelect(trip)}
      className={`bg-white border rounded-lg p-2.5 mb-2 cursor-pointer hover:shadow-sm transition-shadow ${
        compliance === 'warn' ? 'border-l-[3px] border-l-red-500 border-y-border border-r-border' : 'border-border'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`font-mono text-xs font-bold shrink-0 ${plate ? 'text-slate-800' : 'text-gray-300 italic font-normal'}`}>
            {plate ?? 'sin patente'}
          </span>
          {trip.source_system && <TmsChip tms={trip.source_system} meta={meta} />}
        </div>
        {temp != null && (
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${tempStatus === 'out_of_range' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
            {temp}°C
          </span>
        )}
      </div>
      <p className="text-[11px] text-gray-500 truncate mt-0.5">
        {trip.driver_name ?? <span className="italic text-gray-300">sin conductor</span>}
        {trip.client_name && <span className="text-gray-300"> · {trip.client_name}</span>}
      </p>
      {(trip.stops?.length ?? 0) > 0 && (
        <div className="mt-1.5">
          <StopProgressDots stops={trip.stops} />
        </div>
      )}
      {(eta || since !== '—') && (
        <p className="text-[9px] text-gray-400 truncate mt-1">
          {eta}
          {eta && since !== '—' && ' · '}
          {since !== '—' && since}
        </p>
      )}
      <div className="flex items-center justify-between mt-1.5">
        {trip.source_system === 'manual' && <IndicatorDots trip={trip} onSaved={onSaved} />}
        {compliance === 'warn' && (
          <span className="text-[8px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">OFF TIME</span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `cd monitor-app/frontend && npm test -- TripCard`
Expected: `Test Files  1 passed (1)`, 8 tests passed

- [ ] **Step 6: Correr todos los tests y verificar tipos**

Run: `cd monitor-app/frontend && npm test && npx tsc --noEmit`
Expected: todos los tests pasan (incluyendo `TripTable.test.tsx`, afectado por el export nuevo), sin errores de tipo

- [ ] **Step 7: Commit**

```bash
git add monitor-app/frontend/components/dashboard/TripTable.tsx monitor-app/frontend/components/dashboard/TripCard.tsx monitor-app/frontend/components/dashboard/TripCard.test.tsx
git commit -m "feat(diario): TripCard muestra TMS, cliente, ETA y tiempo sin actualizar

Reutiliza TmsChip (exportado de TripTable) en vez de duplicarlo.
Mismas 2 señales que TripTable (ETA de la parada activa, tiempo desde
el último reporte TMS) — consistencia entre tabla y tablero."
```

---

### Task 6: Verificación end-to-end

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

- [ ] **Step 4: Verificar backend (sin cambios esperados)**

Run: `cd monitor-app/backend/api && ./venv/bin/python -m pytest tests/ -q`
Expected: `12 passed` — este plan es 100% frontend.

- [ ] **Step 5: Smoke test manual en navegador**

1. Levantar backend y frontend (`.env.local` apuntando al backend local).
2. Ir a `/dashboard/diario`, pestaña "En Curso", vista Tabla.
3. Confirmar que la fila de un viaje muestra, junto al badge de Estado, un texto chico de ETA (ej. "llega ~14:30" o "llegó 10:00 · sale ~12:00") cuando el viaje tiene datos de parada, y "hace X" cuando tiene `status_reported_at`.
4. Cambiar a vista Tablero — confirmar que las tarjetas muestran: chip de TMS (junto a la patente), nombre de cliente (junto al conductor), y las mismas señales de ETA/tiempo que la tabla.
5. Abrir el detalle de un viaje Wingsuite real — confirmar en la sección "Ruta" que las paradas pendientes/activas ahora muestran su hora planificada (ETA) en vez de solo "en camino"/"pendiente".
6. Confirmar que un viaje Sodimac (que solo tiene `planning_date`, sin `arrival_date`/`departure_date`) muestra correctamente "llega ~HH:MM" en su única parada, sin errores ni "—" vacíos.

Expected: todo lo anterior funciona sin errores de consola.

- [ ] **Step 6: Actualizar `AGENTLOG.md`**

Agregar una entrada nueva documentando: qué se implementó, referencia a `specs/2026-07-03-diario-fechas-por-tms-design.md` y este plan, y la limitación conocida (`departure_date_prog` pendiente de un cambio en Mage).

---

## Self-Review

**Cobertura de la spec:** las 5 decisiones de diseño están cubiertas — `TripStop.departure_date_prog` (Task 1), `describeStopTiming` con la fórmula exacta de la spec (Task 2), `StopTimeline` usándola para todas las paradas (Task 3), ETA + "hace X" en `TripTable` (Task 4), tag de TMS + cliente + ETA + "hace X" en `TripCard` (Task 5). La limitación de Mage/`int_tms_trips_conformed` queda documentada como fuera de alcance, sin ninguna tarea que intente resolverla desde este repo.

**Placeholders:** ninguno — cada step tiene código completo o comandos exactos con output esperado.

**Consistencia de tipos:** `describeStopTiming(stop: TripStop): string | null` (Task 2) se usa con esa misma firma en `StopTimeline.tsx` (Task 3), `TripTable.tsx` y `TripCard.tsx` (Tasks 4-5) — siempre pasándole el resultado de `getActiveStop(trip.stops ?? [])` o un `TripStop` completo, nunca un objeto parcial. `formatRelativeTime` se usa con la misma firma (`string | null | undefined → string`) ya establecida en la spec del modal, sin variantes. El campo `departure_date_prog` aparece con el mismo nombre y tipo (`string | null`) en `lib/types.ts` (Task 1) y en cada fixture actualizado.

**Nota de dependencias entre tasks:** Task 2 depende de Task 1 (el tipo `TripStop` debe tener `departure_date_prog` antes de que `describeStopTiming` lo referencie). Tasks 3, 4 y 5 dependen de Task 2. Task 5 además depende de que Task 4 haya exportado `TmsChip` desde `TripTable.tsx` (Task 5, Step 3, modifica `TripTable.tsx` directamente para esto — no requiere que Task 4 lo haga, ambos cambios en `TripTable.tsx` son independientes entre sí y pueden aplicarse en cualquier orden relativo, pero Task 5 debe ejecutarse después de Task 4 para evitar conflictos de edición sobre el mismo archivo). El orden 1→2→3→4→5→6 definido arriba respeta todas las dependencias reales.
