# Diario: Fila y Detalle de Viaje — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el modal full-screen con 3 tabs del Diario por tres niveles progresivos de interacción — indicadores clickeables en la fila, fila expandible in-place con timeline de paradas, y una ficha completa sin tabs para el caso raro — reduciendo los clics necesarios para las tareas más frecuentes.

**Architecture:** Extensión de componentes existentes en `monitor-app/frontend`, sin cambios de backend/schema (todos los campos usados ya existen en `Trip`). Se extraen 3 componentes nuevos y reutilizables (`IndicatorDots`, `StopTimeline`, `TripRowExpanded`) que se usan tanto en la tabla como en la ficha completa, evitando duplicar la lógica de indicadores/paradas que hoy vive triplicada.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind CSS. Testing nuevo: Vitest + React Testing Library (no existía ningún framework de test unitario en este frontend).

## Global Constraints

- Ningún cambio de schema/backend — todos los campos (`activo`, `trabajando`, `asignado`, `primera_vuelta`, `estado_manual`, `edited_at`, `manually_edited_fields`) ya existen en `Trip` (`monitor-app/frontend/lib/types.ts`).
- Todo error de `PATCH`/`DELETE` disparado por las nuevas interacciones debe mostrarse visible al usuario — nunca `catch { /* ignore */ }`.
- Mantener el patrón `e.stopPropagation()` ya usado en `ConductorCell`/`PhoneTagCell`/`PlateCell` para que los controles dentro de una fila no disparen el click de la fila misma.
- No tocar el módulo Empresas ni Configuración (fuera de alcance de esta spec).
- No agregar dependencias más allá de las estrictamente necesarias para testing (`vitest`, `@vitest/coverage-v8` opcional, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`).

---

### Task 1: Testing infra — Vitest + React Testing Library

**Files:**
- Create: `monitor-app/frontend/vitest.config.ts`
- Create: `monitor-app/frontend/vitest.setup.ts`
- Modify: `monitor-app/frontend/package.json`
- Test: `monitor-app/frontend/lib/utils/__smoke__.test.ts` (borrado al final del task, solo para verificar el runner)

**Interfaces:**
- Produces: comando `npm test` (via `vitest run`) que las tareas siguientes usan para correr sus tests.

- [ ] **Step 1: Instalar dependencias de testing**

```bash
cd monitor-app/frontend
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @vitejs/plugin-react
```

- [ ] **Step 2: Crear `vitest.config.ts`**

```ts
// monitor-app/frontend/vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
```

- [ ] **Step 3: Crear `vitest.setup.ts`**

```ts
// monitor-app/frontend/vitest.setup.ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 4: Agregar script `test` a `package.json`**

En `monitor-app/frontend/package.json`, dentro de `"scripts"`, agregar:

```json
"test": "vitest run"
```

(queda como: `"dev": "next dev", "build": "next build", "start": "next start", "test": "vitest run"`)

- [ ] **Step 5: Test de humo para verificar que el runner funciona**

```ts
// monitor-app/frontend/lib/utils/__smoke__.test.ts
import { describe, it, expect } from 'vitest'

describe('vitest smoke test', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `cd monitor-app/frontend && npm test`
Expected: `Test Files  1 passed (1)` incluyendo `lib/utils/__smoke__.test.ts`

- [ ] **Step 7: Borrar el test de humo (ya cumplió su propósito)**

```bash
rm monitor-app/frontend/lib/utils/__smoke__.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add monitor-app/frontend/vitest.config.ts monitor-app/frontend/vitest.setup.ts monitor-app/frontend/package.json monitor-app/frontend/package-lock.json
git commit -m "test(frontend): agregar Vitest + React Testing Library

No existía framework de test unitario en el frontend. Necesario para
cubrir el rediseño de fila/detalle del Diario (spec 2026-07-02)."
```

---

### Task 2: `lib/utils/datetime.ts` — extraer formateo de fechas duplicado

**Files:**
- Create: `monitor-app/frontend/lib/utils/datetime.ts`
- Test: `monitor-app/frontend/lib/utils/datetime.test.ts`

**Interfaces:**
- Produces: `fmtDT(iso: string | null | undefined): string`, `fmtShort(iso: string | null | undefined): string`, `fmtDate(iso: string | null | undefined): string` — usadas por `StopTimeline` (Task 3) y por `TripSlideOver` (Task 6, reemplazando sus copias locales).

**Contexto:** `TripSlideOver.tsx` (líneas 17-38) tiene `fmtDT`/`fmtDate` con una normalización manual de timestamps UTC sin timezone. `StopTimeline` (Task 3) necesita la misma lógica — en vez de triplicarla, se extrae una sola vez.

- [ ] **Step 1: Escribir el test (falla porque el archivo no existe)**

```ts
// monitor-app/frontend/lib/utils/datetime.test.ts
import { describe, it, expect } from 'vitest'
import { fmtDT, fmtShort, fmtDate } from './datetime'

describe('fmtDT', () => {
  it('returns em dash for null/undefined/empty', () => {
    expect(fmtDT(null)).toBe('—')
    expect(fmtDT(undefined)).toBe('—')
    expect(fmtDT('')).toBe('—')
  })

  it('normalizes a naive UTC timestamp (no offset) into DD/MM HH:MM:SS format', () => {
    expect(fmtDT('2026-07-02 12:45:28')).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('accepts a timestamp with an explicit Z offset', () => {
    expect(fmtDT('2026-07-02T12:45:28Z')).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('returns em dash for an invalid date string', () => {
    expect(fmtDT('not-a-date')).toBe('—')
  })
})

describe('fmtShort', () => {
  it('returns em dash for null', () => {
    expect(fmtShort(null)).toBe('—')
  })

  it('formats as HH:MM', () => {
    expect(fmtShort('2026-07-02 12:45:28')).toMatch(/^\d{2}:\d{2}$/)
  })
})

describe('fmtDate', () => {
  it('formats an ISO date as DD-MM-YYYY', () => {
    expect(fmtDate('2026-07-02')).toBe('02-07-2026')
  })

  it('returns em dash for null', () => {
    expect(fmtDate(null)).toBe('—')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd monitor-app/frontend && npm test -- datetime`
Expected: FAIL — `Cannot find module './datetime'`

- [ ] **Step 3: Implementar `lib/utils/datetime.ts`**

```ts
// monitor-app/frontend/lib/utils/datetime.ts

// Timestamps sin offset (ej. "2026-05-28 20:07:03") vienen del pipeline como UTC — agregar Z.
function normalizeUTC(iso: string): string {
  return /[Z+\-]\d{2}:?\d{2}$/.test(iso) || iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z'
}

export function fmtDT(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(normalizeUTC(iso))
  if (isNaN(d.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const p = Object.fromEntries(parts.filter(x => x.type !== 'literal').map(x => [x.type, x.value]))
  return `${p.day}/${p.month} ${p.hour}:${p.minute}:${p.second}`
}

export function fmtShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(normalizeUTC(iso))
  if (isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-CL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd monitor-app/frontend && npm test -- datetime`
Expected: `Test Files  1 passed (1)`, 8 tests passed

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/lib/utils/datetime.ts monitor-app/frontend/lib/utils/datetime.test.ts
git commit -m "refactor(frontend): extraer fmtDT/fmtShort/fmtDate a lib/utils/datetime.ts

Evita triplicar la normalización de timestamps UTC-sin-offset entre
TripSlideOver y el StopTimeline nuevo."
```

---

### Task 3: `StopTimeline` — timeline vertical de paradas (reemplaza la tabla de 12 columnas)

**Files:**
- Create: `monitor-app/frontend/components/dashboard/StopTimeline.tsx`
- Test: `monitor-app/frontend/components/dashboard/StopTimeline.test.tsx`

**Interfaces:**
- Consumes: `fmtShort`, `fmtDT` de `lib/utils/datetime.ts` (Task 2); `stopWasVisited` de `lib/utils/temperature.ts` (ya existe); tipo `TripStop` de `lib/types.ts`.
- Produces: `StopTimeline({ stops: TripStop[], compact?: boolean }): JSX.Element | null` — usado por `TripRowExpanded` (Task 4, `compact=true`) y por `TripSlideOver` (Task 6, `compact=false`).

- [ ] **Step 1: Escribir el test**

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

  it('in compact mode, only shows "en camino" for the active stop and no extra detail for the rest', () => {
    const stops = [
      makeStop({ stop_id: 'a', local: 'Hecha', arrival_date: '2026-07-02 10:00:00' }),
      makeStop({ stop_id: 'b', local: 'Activa' }),
    ]
    render(<StopTimeline stops={stops} compact />)
    expect(screen.getByText('en camino')).toBeInTheDocument()
    expect(screen.queryByText(/✓ llegó/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd monitor-app/frontend && npm test -- StopTimeline`
Expected: FAIL — `Cannot find module './StopTimeline'`

- [ ] **Step 3: Implementar `StopTimeline.tsx`**

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
  stops:    TripStop[]
  compact?: boolean
}

export function StopTimeline({ stops, compact = false }: Props) {
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
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-700 truncate">{name}</p>
              {!compact && (
                <p className="text-[10px] text-gray-400">
                  {state === 'done' && `✓ llegó ${fmtShort(stop.arrival_date)} · salió ${fmtShort(stop.departure_date)}`}
                  {state === 'active' && 'en camino'}
                  {state === 'pending' && 'pendiente'}
                  {stopWasVisited(stop) && stop.temperature != null && ` · ${stop.temperature}°C`}
                </p>
              )}
              {compact && state === 'active' && <p className="text-[10px] text-gray-400">en camino</p>}
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
Expected: `Test Files  1 passed (1)`, 4 tests passed

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/StopTimeline.tsx monitor-app/frontend/components/dashboard/StopTimeline.test.tsx
git commit -m "feat(diario): StopTimeline — timeline vertical de paradas

Reemplaza la tabla de 12 columnas como forma primaria de mostrar
avance del viaje (spec 2026-07-02-diario-fila-detalle-design.md)."
```

---

### Task 4: `IndicatorDots` — indicadores clickeables con optimistic update + rollback visible

**Files:**
- Create: `monitor-app/frontend/components/dashboard/IndicatorDots.tsx`
- Test: `monitor-app/frontend/components/dashboard/IndicatorDots.test.tsx`

**Interfaces:**
- Consumes: `tripsApi.patch(id: string, body: TripPatch): Promise<Trip>` de `lib/api/trips.ts` (ya existe); tipo `Trip` de `lib/types.ts`.
- Produces: `IndicatorDots({ trip: Trip, onSaved: (t: Trip) => void, size?: 'sm' | 'md' }): JSX.Element` — usado por `TripTable` (Task 5), `TripRowExpanded` (este mismo task lo consume después), y `TripSlideOver` (Task 6).

**Contexto:** Reemplaza el `FlagDots` de solo-lectura que hoy vive en `TripTable.tsx` (líneas 26-52). A diferencia de `ConductorCell`/`PhoneTagCell` (que silencian el error con `catch { /* ignore */ }`), este componente **debe** mostrar el error — es el hallazgo de mayor riesgo de la auditoría previa y la spec lo exige explícitamente.

- [ ] **Step 1: Escribir el test**

```tsx
// monitor-app/frontend/components/dashboard/IndicatorDots.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IndicatorDots } from './IndicatorDots'
import { tripsApi } from '@/lib/api/trips'
import type { Trip } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { patch: vi.fn() },
}))

const baseTrip: Trip = {
  id: 't1', source_system: 'qanalytics', client_name: null, planning_date: null,
  status_reported_at: null, current_status: null, tractor_plate: null, trailer_plate: null,
  driver_name: null, driver_rut: null, driver_phone: null, transporter: null, transporter_tms: null,
  origin: null, cargo_type: null, stops: [], activo: false, trabajando: false, asignado: false,
  primera_vuelta: false, estado_manual: null, observaciones: null, comentarios: null,
  fleet_link_id: null, transporter_profile_id: null, manually_edited_fields: [], edited_at: null,
  updated_at: null, source_system_trip_id: null, milestone_status: null, pipeline_updated_at: null,
}

describe('IndicatorDots', () => {
  beforeEach(() => { vi.mocked(tripsApi.patch).mockReset() })

  it('calls tripsApi.patch with the toggled value immediately on click', () => {
    vi.mocked(tripsApi.patch).mockResolvedValue({ ...baseTrip, activo: true })
    render(<IndicatorDots trip={baseTrip} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByTitle('Activo'))

    expect(tripsApi.patch).toHaveBeenCalledWith('t1', { activo: true })
  })

  it('calls onSaved with the server response on success', async () => {
    const updated = { ...baseTrip, activo: true }
    vi.mocked(tripsApi.patch).mockResolvedValue(updated)
    const onSaved = vi.fn()
    render(<IndicatorDots trip={baseTrip} onSaved={onSaved} />)

    fireEvent.click(screen.getByTitle('Activo'))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated))
  })

  it('shows a visible error message and does not call onSaved when the PATCH fails', async () => {
    vi.mocked(tripsApi.patch).mockRejectedValue(new Error('network down'))
    const onSaved = vi.fn()
    render(<IndicatorDots trip={baseTrip} onSaved={onSaved} />)

    fireEvent.click(screen.getByTitle('Activo'))

    await waitFor(() => expect(screen.getByText('network down')).toBeInTheDocument())
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('toggles off a currently-active indicator', () => {
    vi.mocked(tripsApi.patch).mockResolvedValue({ ...baseTrip, trabajando: false })
    render(<IndicatorDots trip={{ ...baseTrip, trabajando: true }} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByTitle('Trabajando'))

    expect(tripsApi.patch).toHaveBeenCalledWith('t1', { trabajando: false })
  })

  it('clicking a dot does not bubble up to a parent onClick', () => {
    vi.mocked(tripsApi.patch).mockResolvedValue(baseTrip)
    const parentClick = vi.fn()
    render(
      <div onClick={parentClick}>
        <IndicatorDots trip={baseTrip} onSaved={vi.fn()} />
      </div>
    )

    fireEvent.click(screen.getByTitle('Activo'))

    expect(parentClick).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd monitor-app/frontend && npm test -- IndicatorDots`
Expected: FAIL — `Cannot find module './IndicatorDots'`

- [ ] **Step 3: Implementar `IndicatorDots.tsx`**

```tsx
// monitor-app/frontend/components/dashboard/IndicatorDots.tsx
'use client'

import { useState } from 'react'
import type { Trip } from '@/lib/types'
import { tripsApi, type TripPatch } from '@/lib/api/trips'

type IndicatorField = 'activo' | 'trabajando' | 'asignado' | 'primera_vuelta'

const INDICATORS: { field: IndicatorField; label: string; title: string; color: string }[] = [
  { field: 'activo',         label: 'A',  title: 'Activo',     color: 'bg-blue-500'   },
  { field: 'trabajando',     label: 'T',  title: 'Trabajando', color: 'bg-green-500'  },
  { field: 'asignado',       label: 'As', title: 'Asignado',   color: 'bg-violet-500' },
  { field: 'primera_vuelta', label: '1V', title: '1ra Vuelta', color: 'bg-amber-500'  },
]

interface Props {
  trip:    Trip
  onSaved: (updated: Trip) => void
  size?:   'sm' | 'md'
}

export function IndicatorDots({ trip, onSaved, size = 'sm' }: Props) {
  const [pending, setPending]       = useState<Partial<Record<IndicatorField, boolean>>>({})
  const [optimistic, setOptimistic] = useState<Partial<Record<IndicatorField, boolean>>>({})
  const [error, setError]           = useState<string | null>(null)

  async function toggle(field: IndicatorField, e: React.MouseEvent) {
    e.stopPropagation()
    const next = !(optimistic[field] ?? trip[field])
    setOptimistic(o => ({ ...o, [field]: next }))
    setPending(p => ({ ...p, [field]: true }))
    setError(null)
    try {
      const updated = await tripsApi.patch(trip.id, { [field]: next } as TripPatch)
      onSaved(updated)
      setOptimistic(o => { const n = { ...o }; delete n[field]; return n })
    } catch (err) {
      setOptimistic(o => { const n = { ...o }; delete n[field]; return n })
      setError(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setPending(p => { const n = { ...p }; delete n[field]; return n })
    }
  }

  const dotSize = size === 'md' ? 'w-3 h-3' : 'w-2.5 h-2.5'

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

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd monitor-app/frontend && npm test -- IndicatorDots`
Expected: `Test Files  1 passed (1)`, 5 tests passed

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/IndicatorDots.tsx monitor-app/frontend/components/dashboard/IndicatorDots.test.tsx
git commit -m "feat(diario): IndicatorDots — indicadores clickeables inline

Optimistic update + rollback y error visible (nunca catch silencioso),
cierra el hallazgo de mayor riesgo de la auditoría 2026-07-02."
```

---

### Task 5: `TripRowExpanded` — contenido de la fila expandida

**Files:**
- Create: `monitor-app/frontend/components/dashboard/TripRowExpanded.tsx`
- Test: `monitor-app/frontend/components/dashboard/TripRowExpanded.test.tsx`

**Interfaces:**
- Consumes: `StopTimeline` (Task 3), `IndicatorDots` (Task 4), `getLatestTemp`/`classifyTemperature` de `lib/utils/temperature.ts` (ya existen).
- Produces: `TripRowExpanded({ trip: Trip, meta?: TripsMeta | null, onSaved: (t: Trip) => void, onOpenFull: () => void }): JSX.Element` — usado por `TripTable` (Task 6) tanto en la fila desktop expandida como en la card mobile expandida.

- [ ] **Step 1: Escribir el test**

```tsx
// monitor-app/frontend/components/dashboard/TripRowExpanded.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TripRowExpanded } from './TripRowExpanded'
import type { Trip } from '@/lib/types'

const baseTrip: Trip = {
  id: 't1', source_system: 'qanalytics', client_name: null, planning_date: null,
  status_reported_at: null, current_status: null, tractor_plate: null, trailer_plate: null,
  driver_name: null, driver_rut: null, driver_phone: null, transporter: null, transporter_tms: null,
  origin: null, cargo_type: 'FRIO',
  stops: [{
    stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: null, departure_date: null,
    unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
    on_time_status: null, destination_city: null, destination_region: null, s2s: null,
    temperature: 11, milestone_status: null,
  }],
  activo: true, trabajando: false, asignado: true, primera_vuelta: false,
  estado_manual: null, observaciones: null, comentarios: null,
  fleet_link_id: null, transporter_profile_id: null, manually_edited_fields: [], edited_at: null,
  updated_at: null, source_system_trip_id: null, milestone_status: null, pipeline_updated_at: null,
}

describe('TripRowExpanded', () => {
  it('shows the latest temperature reading', () => {
    render(<TripRowExpanded trip={baseTrip} meta={null} onSaved={vi.fn()} onOpenFull={vi.fn()} />)
    expect(screen.getByText('11°C')).toBeInTheDocument()
  })

  it('renders the stop timeline', () => {
    render(<TripRowExpanded trip={baseTrip} meta={null} onSaved={vi.fn()} onOpenFull={vi.fn()} />)
    expect(screen.getByText('Parada 1')).toBeInTheDocument()
  })

  it('renders the indicator dots', () => {
    render(<TripRowExpanded trip={baseTrip} meta={null} onSaved={vi.fn()} onOpenFull={vi.fn()} />)
    expect(screen.getByTitle('Activo')).toBeInTheDocument()
    expect(screen.getByTitle('Asignado')).toBeInTheDocument()
  })

  it('calls onOpenFull when "Ver ficha completa" is clicked, without bubbling to a parent onClick', () => {
    const onOpenFull = vi.fn()
    const parentClick = vi.fn()
    render(
      <div onClick={parentClick}>
        <TripRowExpanded trip={baseTrip} meta={null} onSaved={vi.fn()} onOpenFull={onOpenFull} />
      </div>
    )
    fireEvent.click(screen.getByText(/Ver ficha completa/))
    expect(onOpenFull).toHaveBeenCalledTimes(1)
    expect(parentClick).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd monitor-app/frontend && npm test -- TripRowExpanded`
Expected: FAIL — `Cannot find module './TripRowExpanded'`

- [ ] **Step 3: Implementar `TripRowExpanded.tsx`**

```tsx
// monitor-app/frontend/components/dashboard/TripRowExpanded.tsx
'use client'

import type { Trip, TripsMeta } from '@/lib/types'
import { getLatestTemp, classifyTemperature } from '@/lib/utils/temperature'
import { StopTimeline } from './StopTimeline'
import { IndicatorDots } from './IndicatorDots'

interface Props {
  trip:       Trip
  meta?:      TripsMeta | null
  onSaved:    (t: Trip) => void
  onOpenFull: () => void
}

export function TripRowExpanded({ trip, meta, onSaved, onOpenFull }: Props) {
  const temp       = getLatestTemp(trip.stops ?? [])
  const tempStatus = classifyTemperature(temp, trip.cargo_type, meta?.temperature_ranges ?? [])

  return (
    <div
      className="px-4 py-3 flex flex-col md:flex-row gap-4 md:items-start bg-blue-50/30"
      onClick={e => e.stopPropagation()}
    >
      <div className="shrink-0">
        <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Temp</p>
        {temp != null
          ? <p className={`text-lg font-black ${tempStatus === 'out_of_range' ? 'text-red-600' : 'text-blue-600'}`}>{temp}°C</p>
          : <p className="text-sm text-gray-300">—</p>}
      </div>

      <div className="flex-1 min-w-0">
        <StopTimeline stops={trip.stops ?? []} compact />
      </div>

      <div className="shrink-0 space-y-1.5">
        <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Indicadores</p>
        <IndicatorDots trip={trip} onSaved={onSaved} size="md" />
        <button
          type="button"
          onClick={onOpenFull}
          className="text-[11px] font-semibold text-accent hover:text-accent/80 transition-colors block"
        >
          Ver ficha completa →
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd monitor-app/frontend && npm test -- TripRowExpanded`
Expected: `Test Files  1 passed (1)`, 4 tests passed

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/TripRowExpanded.tsx monitor-app/frontend/components/dashboard/TripRowExpanded.test.tsx
git commit -m "feat(diario): TripRowExpanded — contenido de la fila expandida

Compone StopTimeline + IndicatorDots + link a ficha completa (nivel 2
del diseño aprobado en specs/2026-07-02-diario-fila-detalle-design.md)."
```

---

### Task 6: Wire — expandir fila en `TripTable.tsx` (desktop + mobile)

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/TripTable.tsx`
- Test: `monitor-app/frontend/components/dashboard/TripTable.test.tsx`

**Interfaces:**
- Consumes: `IndicatorDots` (Task 4), `TripRowExpanded` (Task 5).
- Produces: sin cambios de la interfaz pública `Props` de `TripTable` (sigue recibiendo `onSelect` — ahora se invoca solo desde "Ver ficha completa", no desde el click en la fila).

**Contexto — cambios exactos sobre el archivo actual (637 líneas):**

1. Eliminar la función `FlagDots` (líneas 26-52) — queda reemplazada por `IndicatorDots`.
2. Eliminar el uso de `FlagDots` dentro de `ConductorCell` (líneas 154-160) — los indicadores ya no son parte de la celda de conductor, tienen su propia columna.
3. Agregar estado local `expandedId` y un handler `toggleExpand`.
4. Cambiar el `onClick` de la fila/card de `onSelect(trip)` a `toggleExpand(trip.id)`.
5. Agregar una columna nueva "Indicadores" en el `<thead>` y su `<td>` correspondiente (desktop), y reemplazar el uso inline de `FlagDots` en la card mobile (línea ~452) por `IndicatorDots`.
6. Agregar la fila/bloque expandido (`TripRowExpanded`) condicionalmente, en ambas vistas.

- [ ] **Step 1: Escribir el test de comportamiento (expand/collapse + no doble-toggle en los indicadores)**

```tsx
// monitor-app/frontend/components/dashboard/TripTable.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TripTable } from './TripTable'
import type { Trip } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { patch: vi.fn().mockResolvedValue({}) },
}))

function makeTrip(id: string): Trip {
  return {
    id, source_system: 'qanalytics', client_name: 'walmart', planning_date: '2026-07-02',
    status_reported_at: null, current_status: 'ORIGEN', tractor_plate: 'ABCD12', trailer_plate: null,
    driver_name: 'Juan Perez', driver_rut: null, driver_phone: null, transporter: null, transporter_tms: null,
    origin: 'CD Quilicura', cargo_type: 'FRIO', stops: [], activo: true, trabajando: false, asignado: true,
    primera_vuelta: false, estado_manual: null, observaciones: null, comentarios: null,
    fleet_link_id: null, transporter_profile_id: null, manually_edited_fields: [], edited_at: null,
    updated_at: null, source_system_trip_id: '2000711', milestone_status: null, pipeline_updated_at: null,
  }
}

describe('TripTable — expand/collapse', () => {
  it('renders no expanded content by default', () => {
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.queryByText(/Ver ficha completa/)).not.toBeInTheDocument()
  })

  it('clicking a row expands it, showing the indicators and the "ver ficha completa" link', () => {
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    fireEvent.click(screen.getAllByText('ABCD12')[0])
    expect(screen.getAllByText(/Ver ficha completa/).length).toBeGreaterThan(0)
  })

  it('clicking the same row again collapses it', () => {
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    const plate = screen.getAllByText('ABCD12')[0]
    fireEvent.click(plate)
    expect(screen.getAllByText(/Ver ficha completa/).length).toBeGreaterThan(0)
    fireEvent.click(plate)
    expect(screen.queryByText(/Ver ficha completa/)).not.toBeInTheDocument()
  })

  it('calls onSelect only when "Ver ficha completa" is clicked, not when the row is clicked', () => {
    const onSelect = vi.fn()
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={onSelect} onSaved={vi.fn()} meta={null} />)
    fireEvent.click(screen.getAllByText('ABCD12')[0])
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByText(/Ver ficha completa/)[0])
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
  })

  it('renders an "Indicadores" column with clickable dots for each trip row', () => {
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getAllByTitle('Activo').length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd monitor-app/frontend && npm test -- TripTable`
Expected: FAIL — no hay `expandedId`, no existe columna "Indicadores", "Ver ficha completa" no aparece nunca.

- [ ] **Step 3: Eliminar `FlagDots` (líneas 26-52 del archivo actual)**

Borrar por completo la función:

```tsx
function FlagDots({ activo, trabajando, asignado, primera_vuelta }: {
  activo: boolean; trabajando: boolean; asignado: boolean; primera_vuelta: boolean
}) {
  const flags = [
    { label: 'A',  title: 'Activo',      active: activo,        color: 'bg-blue-400' },
    { label: 'T',  title: 'Trabajando',  active: trabajando,    color: 'bg-green-400' },
    { label: 'As', title: 'Asignado',    active: asignado,      color: 'bg-violet-400' },
    { label: '1V', title: '1ra Vuelta',  active: primera_vuelta, color: 'bg-amber-400' },
  ]
  return (
    <div className="flex gap-0.5 items-center">
      {flags.map(f => (
        <span
          key={f.label}
          title={f.title}
          className={`text-[8px] font-bold px-1 py-0.5 rounded ${
            f.active
              ? `${f.color} text-white`
              : 'bg-gray-100 text-gray-300'
          }`}
        >
          {f.label}
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Quitar el uso de `FlagDots` dentro de `ConductorCell`**

En la función `ConductorCell` (que ahora queda sin la función `FlagDots` disponible), eliminar este bloque (en el archivo original eran las líneas 154-160):

```tsx
      <div className="mt-1">
        <FlagDots
          activo={trip.activo}
          trabajando={trip.trabajando}
          asignado={trip.asignado}
          primera_vuelta={trip.primera_vuelta}
        />
      </div>
```

`ConductorCell` queda mostrando solo el nombre + `ComplianceBadge` + ícono de lápiz, sin la fila de flags debajo.

- [ ] **Step 5: Agregar imports**

Al inicio del archivo, junto al resto de imports:

```tsx
import { IndicatorDots } from './IndicatorDots'
import { TripRowExpanded } from './TripRowExpanded'
```

- [ ] **Step 6: Agregar estado de expansión en el componente `TripTable`**

Reemplazar la firma actual:

```tsx
export function TripTable({ trips, selectedId, onSelect, onSaved, alertSummary, meta }: Props) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
```

por:

```tsx
export function TripTable({ trips, selectedId, onSelect, onSaved, alertSummary, meta }: Props) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  function toggleExpand(id: string) {
    setExpandedId(prev => (prev === id ? null : id))
  }
```

- [ ] **Step 7: Mobile — cambiar el click de la card y agregar el bloque expandido**

Reemplazar el `onClick` de la card mobile (actual línea 413):

```tsx
              onClick={() => onSelect(trip)}
```

por:

```tsx
              onClick={() => toggleExpand(trip.id)}
```

Reemplazar el bloque de flags mobile (actual líneas 452-457):

```tsx
                <FlagDots
                  activo={trip.activo}
                  trabajando={trip.trabajando}
                  asignado={trip.asignado}
                  primera_vuelta={trip.primera_vuelta}
                />
```

por:

```tsx
                <IndicatorDots trip={trip} onSaved={onSaved} />
```

Justo después del cierre del bloque "fila 3: EETT + origen" (después de la `</div>` que cierra esa fila, antes de la `</div>` que cierra la card completa), agregar:

```tsx
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
```

- [ ] **Step 8: Desktop — agregar columna "Indicadores" al header**

Reemplazar (actual líneas 488-489):

```tsx
              <th className="px-3 py-2.5 text-center w-[72px]">Temp</th>
              <th className="px-2 py-2.5 w-6"></th>
```

por:

```tsx
              <th className="px-3 py-2.5 text-center w-[72px]">Temp</th>
              <th className="px-3 py-2.5 text-left w-[90px]">Indicadores</th>
              <th className="px-2 py-2.5 w-6"></th>
```

- [ ] **Step 9: Desktop — cambiar el click de la fila, agregar `<td>` de indicadores y la fila expandida**

Reemplazar el `onClick` de la fila (actual línea 503):

```tsx
                  onClick={() => onSelect(trip)}
```

por:

```tsx
                  onClick={() => toggleExpand(trip.id)}
```

Insertar un nuevo `<td>` entre el `<td>` de TEMP (actual líneas 613-622) y el `<td>` del Chevron (actual líneas 624-627):

```tsx
                  {/* INDICADORES */}
                  <td className="px-3 py-2.5">
                    <IndicatorDots trip={trip} onSaved={onSaved} />
                  </td>

```

Después del cierre de la fila `</tr>` (actual línea 628), agregar la fila expandida condicional:

```tsx
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
```

(Nota: el `<tr>` original y este nuevo `<tr>` condicional quedan ambos dentro del `.map` que itera `sorted`, envueltos con un [fragmento `<>...</>`](https://react.dev/reference/react/Fragment) ya que un `.map` debe devolver un único nodo por iteración — cambiar el `return (` de la fila por `return (\n  <>\n    <tr>...</tr>\n    {expandedId === trip.id && (...)}\n  </>\n)`.)

- [ ] **Step 10: Correr el test y verificar que pasa**

Run: `cd monitor-app/frontend && npm test -- TripTable`
Expected: `Test Files  1 passed (1)`, 5 tests passed

- [ ] **Step 11: Correr todos los tests del frontend para verificar que nada se rompió**

Run: `cd monitor-app/frontend && npm test`
Expected: todos los test files pasan (Task 2, 3, 4, 5, 6)

- [ ] **Step 12: Verificar tipos**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 13: Commit**

```bash
git add monitor-app/frontend/components/dashboard/TripTable.tsx monitor-app/frontend/components/dashboard/TripTable.test.tsx
git commit -m "feat(diario): fila expandible in-place en TripTable

Click en la fila expande (nivel 2 del diseño), en vez de abrir directo
la ficha completa. Indicadores pasan a columna propia y clickeable
(IndicatorDots), reemplazando el FlagDots de solo lectura."
```

---

### Task 7: `TripSlideOver` — ficha completa sin tabs

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/TripSlideOver.tsx`
- Test: `monitor-app/frontend/components/dashboard/TripSlideOver.test.tsx`

**Interfaces:**
- Consumes: `StopTimeline` (Task 3, `compact=false`), `IndicatorDots` (Task 4), `fmtDT`/`fmtDate` de `lib/utils/datetime.ts` (Task 2, reemplazando las copias locales).
- Produces: sin cambios en la interfaz pública `Props` (`trip`, `onClose`, `onSaved`, `meta`).

**Contexto — decisiones de esta tarea (de las preguntas abiertas de la spec):**
- La tabla técnica de 12 columnas (GPS, SAP, S2S) **no se elimina** — queda como acordeón colapsado "Ver detalle técnico (GPS, SAP)" dentro de la sección Paradas, para el caso en que alguien necesite ese detalle para una disputa con el TMS. Por defecto colapsada.
- El override manual (`estado_manual`) se muestra junto al badge de Estado en el header, no en una sección aparte — con la copia "confirmado manualmente el {fecha}" (sin nombre de usuario: `app.trips` no tiene columna de quién editó, agregarla queda fuera de esta spec).
- `handleSave`/`form` se reduce a solo `observaciones`/`comentarios` — los flags y `estado_manual` ya no pasan por el botón "Guardar", tienen su propia acción inmediata (vía `IndicatorDots` y el control inline del override).
- El botón "Desvincular" empresa (hoy sin manejo de error) pasa a mostrar el error si falla — se toca ese código de todas formas en esta tarea.

- [ ] **Step 1: Escribir el test**

```tsx
// monitor-app/frontend/components/dashboard/TripSlideOver.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TripSlideOver } from './TripSlideOver'
import { tripsApi } from '@/lib/api/trips'
import type { Trip } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: {
    patch: vi.fn(),
    resetField: vi.fn(),
    removeFleetLink: vi.fn(),
  },
}))
vi.mock('@/lib/api/transporters', () => ({
  transportersApi: { list: vi.fn().mockResolvedValue({ data: [] }) },
}))

const baseTrip: Trip = {
  id: 't1', source_system: 'qanalytics', client_name: 'walmart', planning_date: '2026-07-02',
  status_reported_at: null, current_status: 'ORIGEN', tractor_plate: 'ABCD12', trailer_plate: null,
  driver_name: 'Juan Perez', driver_rut: null, driver_phone: null, transporter: null, transporter_tms: null,
  origin: 'CD Quilicura', cargo_type: 'FRIO', stops: [], activo: true, trabajando: false, asignado: true,
  primera_vuelta: false, estado_manual: null, observaciones: null, comentarios: null,
  fleet_link_id: null, transporter_profile_id: null, manually_edited_fields: [], edited_at: null,
  updated_at: null, source_system_trip_id: '2000711', milestone_status: null, pipeline_updated_at: null,
}

describe('TripSlideOver — sin tabs', () => {
  beforeEach(() => {
    vi.mocked(tripsApi.patch).mockReset()
    vi.mocked(tripsApi.resetField).mockReset()
  })

  it('does not render a tab bar', () => {
    render(<TripSlideOver trip={baseTrip} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.queryByText('Empresa')).not.toBeInTheDocument() // no tab button, solo el acordeón (título distinto abajo)
  })

  it('shows Empresa and Bitácora as collapsed accordions that expand on click', () => {
    render(<TripSlideOver trip={baseTrip} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    const empresaHeader = screen.getByText('Empresa transportista')
    expect(screen.queryByText('sin vincular', { exact: false })).not.toBeInTheDocument()
    fireEvent.click(empresaHeader)
    expect(screen.getByPlaceholderText(/Buscar empresa/)).toBeInTheDocument()
  })

  it('shows an inline "set manual override" affordance next to the status, not inside a hidden tab', () => {
    render(<TripSlideOver trip={baseTrip} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getByText(/Establecer estado operativo/)).toBeInTheDocument()
  })

  it('shows attribution and a revert control when estado_manual is set', () => {
    const tripWithOverride = { ...baseTrip, estado_manual: 'en_seguimiento', edited_at: '2026-07-02 10:15:00' }
    render(<TripSlideOver trip={tripWithOverride} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getByText(/confirmado manualmente/)).toBeInTheDocument()
  })

  it('reverting the override calls tripsApi.resetField with estado_manual', async () => {
    vi.mocked(tripsApi.resetField).mockResolvedValue({ ok: true, field: 'estado_manual' })
    const tripWithOverride = { ...baseTrip, estado_manual: 'en_seguimiento' }
    render(<TripSlideOver trip={tripWithOverride} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    fireEvent.click(screen.getByTitle('Revertir a valor del TMS'))
    await waitFor(() => expect(tripsApi.resetField).toHaveBeenCalledWith('t1', 'estado_manual'))
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd monitor-app/frontend && npm test -- TripSlideOver`
Expected: FAIL (el componente actual sigue teniendo tabs y no tiene los textos nuevos)

- [ ] **Step 3: Reemplazar los imports del archivo**

Reemplazar (actuales líneas 1-12):

```tsx
'use client'

import { useState, useEffect } from 'react'
import {
  X, Loader2, Building2, Copy, Check,
  Truck, User, Phone, Hash, RefreshCw,
  Thermometer, MapPin,
} from 'lucide-react'
import type { Trip, TransporterListItem, TripsMeta } from '@/lib/types'
import { tripsApi, type TripPatch, type FleetLinkPayload } from '@/lib/api/trips'
import { transportersApi } from '@/lib/api/transporters'
import { getLatestTemp, getActiveStop, stopWasVisited, classifyTemperature } from '@/lib/utils/temperature'
```

por:

```tsx
'use client'

import { useState, useEffect } from 'react'
import {
  X, Loader2, Building2, Copy, Check,
  Truck, User, Phone, Hash, RefreshCw,
  MapPin, ChevronDown, RotateCcw,
} from 'lucide-react'
import type { Trip, TransporterListItem, TripsMeta } from '@/lib/types'
import { tripsApi, type TripPatch, type FleetLinkPayload } from '@/lib/api/trips'
import { transportersApi } from '@/lib/api/transporters'
import { getLatestTemp, getActiveStop, stopWasVisited, classifyTemperature } from '@/lib/utils/temperature'
import { fmtDT, fmtDate } from '@/lib/utils/datetime'
import { StopTimeline } from './StopTimeline'
import { IndicatorDots } from './IndicatorDots'
```

(`Thermometer` ya no se usa — el acordeón "detalle técnico" del Step 7 usa el texto `°C` en vez del ícono. `stopWasVisited` se sigue necesitando para la celda de temperatura de esa misma tabla técnica.)

- [ ] **Step 4: Eliminar los formatters locales `fmtDT`/`fmtDate`**

Eliminar por completo (actuales líneas 15-38):

```tsx
// ── Date formatters ───────────────────────────────────────────────────────────

function fmtDT(iso: string | null | undefined): string {
  ...
}

function fmtDate(iso: string | null | undefined): string {
  ...
}
```

Ya se importan desde `lib/utils/datetime.ts` (Step 3).

- [ ] **Step 5: Quitar el tipo/estado de tabs y agregar estado de acordeones + revert de override**

Reemplazar (actuales líneas 163-179):

```tsx
type ActiveTab = 'viaje' | 'empresa' | 'bitacora'

interface Props {
  trip:    Trip | null
  onClose: () => void
  onSaved: (updated: Trip) => void
  meta?:   TripsMeta | null
}

export function TripSlideOver({ trip, onClose, onSaved, meta }: Props) {
  const [activeTab, setActiveTab]           = useState<ActiveTab>('viaje')
  const [form, setForm]                     = useState<TripPatch>({})
  const [saving, setSaving]                 = useState(false)
  const [err, setErr]                       = useState<string | null>(null)
  const [copied, setCopied]                 = useState(false)
  const [showEstadoSelect, setShowEstadoSelect] = useState(false)
  const [clearingOverride, setClearingOverride] = useState(false)
```

por:

```tsx
interface Props {
  trip:    Trip | null
  onClose: () => void
  onSaved: (updated: Trip) => void
  meta?:   TripsMeta | null
}

export function TripSlideOver({ trip, onClose, onSaved, meta }: Props) {
  const [form, setForm]                         = useState<TripPatch>({})
  const [saving, setSaving]                     = useState(false)
  const [err, setErr]                           = useState<string | null>(null)
  const [copied, setCopied]                     = useState(false)
  const [showEstadoSelect, setShowEstadoSelect] = useState(false)
  const [clearingOverride, setClearingOverride] = useState(false)
  const [empresaOpen, setEmpresaOpen]           = useState(false)
  const [bitacoraOpen, setBitacoraOpen]         = useState(false)
  const [techDetailOpen, setTechDetailOpen]     = useState(false)
  const [unlinkErr, setUnlinkErr]               = useState<string | null>(null)
  const [unlinking, setUnlinking]               = useState(false)
```

- [ ] **Step 6: Simplificar el `useEffect` de reseteo y `handleSave`**

Reemplazar (actuales líneas 181-222):

```tsx
  useEffect(() => {
    if (!trip) return
    setActiveTab('viaje')
    setForm({
      estado_manual:  trip.estado_manual  ?? '',
      observaciones:  trip.observaciones  ?? '',
      comentarios:    trip.comentarios    ?? '',
      activo:         trip.activo,
      trabajando:     trip.trabajando,
      asignado:       trip.asignado,
      primera_vuelta: trip.primera_vuelta,
    })
    setErr(null)
    setCopied(false)
    setShowEstadoSelect(false)
  }, [trip?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (!trip) return
    setSaving(true)
    setErr(null)
    try {
      const payload: TripPatch = {
        // Only send estado_manual when a new override was actively selected
        ...(showEstadoSelect && form.estado_manual
          ? { estado_manual: form.estado_manual }
          : {}),
        observaciones:  form.observaciones  || undefined,
        comentarios:    form.comentarios    || undefined,
        activo:         form.activo,
        trabajando:     form.trabajando,
        asignado:       form.asignado,
        primera_vuelta: form.primera_vuelta,
      }
      const updated = await tripsApi.patch(trip.id, payload)
      onSaved(updated)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }
```

por:

```tsx
  useEffect(() => {
    if (!trip) return
    setForm({
      observaciones: trip.observaciones ?? '',
      comentarios:   trip.comentarios   ?? '',
    })
    setErr(null)
    setCopied(false)
    setShowEstadoSelect(false)
    setEmpresaOpen(false)
    setBitacoraOpen(false)
    setTechDetailOpen(false)
    setUnlinkErr(null)
  }, [trip?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (!trip) return
    setSaving(true)
    setErr(null)
    try {
      const payload: TripPatch = {
        observaciones: form.observaciones || undefined,
        comentarios:   form.comentarios   || undefined,
      }
      const updated = await tripsApi.patch(trip.id, payload)
      onSaved(updated)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleSetOverride() {
    if (!trip || !form.estado_manual) return
    setSaving(true)
    setErr(null)
    try {
      const updated = await tripsApi.patch(trip.id, { estado_manual: form.estado_manual })
      onSaved(updated)
      setShowEstadoSelect(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }
```

- [ ] **Step 7: Quitar la tab bar y reescribir el cuerpo (sección Viaje + acordeones)**

Reemplazar todo el bloque desde `{/* ── Tab bar ───...` hasta el cierre de `{/* ── TAB: BITÁCORA ...` (actuales líneas 419-794, todo el contenido entre el KPI strip y el `</div>` final del panel) por:

```tsx
        {/* ── Body — una sola vista, sin tabs ──────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4 md:p-6 space-y-6">

          {/* Resumen */}
          <section>
            <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
              Resumen
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
              <MetaField label="Fecha planificación" value={fmtDate(trip.planning_date)} />
              <MetaField label="Origen" value={trip.origin ?? '—'} />
              <MetaField label="Tipo carga" value={trip.cargo_type ?? '—'} />
              <MetaField label="EETT TMS" value={trip.transporter_tms ?? '—'} />
              <MetaField
                label="Último reporte TMS"
                value={fmtDT(trip.status_reported_at)}
                icon={<RefreshCw size={9} className="text-gray-400 shrink-0" />}
              />
              {trip.milestone_status && (
                <MetaField label="Estado cumplimiento" value={trip.milestone_status} highlight />
              )}
              {trip.pipeline_updated_at && (
                <MetaField
                  label="Sincronización pipeline"
                  value={fmtDT(trip.pipeline_updated_at)}
                  icon={<RefreshCw size={9} className="text-gray-400 shrink-0" />}
                />
              )}
            </div>
          </section>

          {/* Estado operativo — estado TMS readonly + override manual inline */}
          <section>
            <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
              Estado operativo
            </h4>
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="text-[9px] text-gray-400">TMS reporta:</span>
              {(() => {
                const sm = trip.current_status ? meta?.statuses.find(s => s.id === trip.current_status) : null
                return (
                  <span
                    className="inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold"
                    style={sm
                      ? { backgroundColor: sm.bg_color, color: sm.text_color }
                      : { backgroundColor: '#f3f4f6', color: '#6b7280' }}
                  >
                    {trip.current_status ?? '—'}
                  </span>
                )
              })()}
            </div>

            {trip.estado_manual ? (
              <div className="flex items-center gap-2 flex-wrap">
                {(() => {
                  const opState = meta?.operational_states.find(s => s.id === trip.estado_manual)
                  const label = opState?.label ?? trip.estado_manual
                  return (
                    <span
                      className="inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold"
                      style={opState
                        ? { backgroundColor: opState.bg_color, color: opState.text_color }
                        : { backgroundColor: '#f3f4f6', color: '#6b7280' }}
                    >
                      {label}
                    </span>
                  )
                })()}
                <span className="text-[10px] text-gray-400">
                  confirmado manualmente el {fmtDT(trip.edited_at)}
                </span>
                <button
                  type="button"
                  title="Revertir a valor del TMS"
                  onClick={handleClearOverride}
                  disabled={clearingOverride}
                  className="text-gray-400 hover:text-accent transition-colors disabled:opacity-50"
                >
                  {clearingOverride ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                </button>
              </div>
            ) : showEstadoSelect ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                <select
                  autoFocus
                  value={form.estado_manual ?? ''}
                  onChange={e => setForm(f => ({ ...f, estado_manual: e.target.value }))}
                  className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
                >
                  <option value="">— Seleccionar estado…</option>
                  {(meta?.operational_states ?? []).map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
                <button type="button" onClick={handleSetOverride} disabled={saving || !form.estado_manual}
                  className="p-1.5 text-accent disabled:opacity-40">
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                </button>
                <button type="button" onClick={() => { setShowEstadoSelect(false); setForm(f => ({ ...f, estado_manual: '' })) }}
                  className="text-[10px] text-gray-400 hover:text-gray-600">
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowEstadoSelect(true)}
                className="text-xs text-accent hover:text-accent/80 transition-colors"
              >
                + Establecer estado operativo manual
              </button>
            )}
          </section>

          {/* Indicadores */}
          <section>
            <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
              Indicadores
            </h4>
            <IndicatorDots trip={trip} onSaved={onSaved} size="md" />
          </section>

          {/* Paradas */}
          {(trip.stops?.length ?? 0) > 0 && (
            <section>
              <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <MapPin size={11} /> Paradas ({trip.stops.length})
              </h4>
              <StopTimeline stops={trip.stops} />

              <button
                type="button"
                onClick={() => setTechDetailOpen(v => !v)}
                className="mt-3 flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
              >
                <ChevronDown size={11} className={`transition-transform ${techDetailOpen ? 'rotate-180' : ''}`} />
                Ver detalle técnico (GPS, SAP)
              </button>

              {techDetailOpen && (
                <div className="overflow-x-auto mt-2 -mx-4 md:-mx-6">
                  <div className="min-w-[860px] px-4 md:px-6">
                    <table className="w-full text-xs border border-border/80 rounded-lg overflow-hidden">
                      <thead>
                        <tr className="bg-slate-800 text-[9px] font-bold text-slate-300 uppercase tracking-wide">
                          <th className="px-3 py-2 text-left sticky left-0 bg-slate-800 z-10 min-w-[120px]">Local</th>
                          <th className="px-3 py-2 text-left min-w-[82px]">Plan.</th>
                          <th className="px-3 py-2 text-left min-w-[82px]">Llegada</th>
                          <th className="px-3 py-2 text-left min-w-[82px]">Salida</th>
                          <th className="px-3 py-2 text-left min-w-[82px]">GPS Arr.</th>
                          <th className="px-3 py-2 text-left min-w-[82px]">GPS Sal.</th>
                          <th className="px-3 py-2 text-left min-w-[82px]">Desc. inicio</th>
                          <th className="px-3 py-2 text-left min-w-[82px]">Desc. fin</th>
                          <th className="px-3 py-2 text-center min-w-[52px]">S2S</th>
                          <th className="px-3 py-2 text-center min-w-[52px]">°C</th>
                          <th className="px-3 py-2 text-center min-w-[68px]">On Time</th>
                          <th className="px-3 py-2 text-left min-w-[100px]">Estado SAP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {trip.stops.map((stop, i) => {
                          const rowBg =
                            stop.on_time_status === 'ON TIME'  ? 'bg-green-50/40' :
                            stop.on_time_status === 'OFF TIME' ? 'bg-amber-50/40' :
                            i % 2 === 1 ? 'bg-gray-50/40' : 'bg-white'
                          return (
                            <tr key={stop.stop_id ?? i} className={rowBg}>
                              <td className={`px-3 py-2 sticky left-0 z-10 ${rowBg}`}>
                                <p className="font-medium text-slate-700 leading-snug">{stop.local ?? '—'}</p>
                                {stop.destination_city && (
                                  <p className="text-[9px] text-gray-400 mt-0.5">
                                    {stop.destination_city}{stop.destination_region ? `, ${stop.destination_region}` : ''}
                                  </p>
                                )}
                              </td>
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.planning_date)}</td>
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.arrival_date)}</td>
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.departure_date)}</td>
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.gps_arrival_date)}</td>
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.gps_departure_date)}</td>
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.unload_start)}</td>
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.unload_end)}</td>
                              <td className="px-3 py-2 text-center">
                                {stop.s2s ? <span className="text-[9px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{stop.s2s}</span> : <span className="text-gray-200">—</span>}
                              </td>
                              <td className="px-3 py-2 text-center">
                                {stopWasVisited(stop) && stop.temperature != null ? <span className="text-sm font-mono text-blue-600 font-semibold">{stop.temperature}°C</span> : <span className="text-gray-200">—</span>}
                              </td>
                              <td className="px-3 py-2 text-center">
                                {stop.on_time_status === 'ON TIME' ? (
                                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-green-50 text-green-600 border border-green-100">ON TIME</span>
                                ) : stop.on_time_status === 'OFF TIME' ? (
                                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-100">OFF TIME</span>
                                ) : (
                                  <span className="text-gray-200">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {stop.milestone_status ? <span className="text-[9px] text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded leading-snug block">{stop.milestone_status}</span> : <span className="text-gray-200">—</span>}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Acordeón: Empresa */}
          <section className="border border-border rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setEmpresaOpen(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50/60 transition-colors"
            >
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Building2 size={12} /> Empresa transportista
              </span>
              <ChevronDown size={13} className={`text-gray-400 transition-transform ${empresaOpen ? 'rotate-180' : ''}`} />
            </button>
            {empresaOpen && (
              <div className="px-4 pb-4 space-y-4 border-t border-border/60 pt-3">
                {trip.transporter_profile_id ? (
                  <div className="flex items-center justify-between bg-accent/5 rounded-xl px-4 py-3 border border-accent/15">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{trip.transporter ?? '—'}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5 font-mono">{trip.tractor_plate ?? ''}</p>
                    </div>
                    <button
                      type="button"
                      disabled={unlinking}
                      onClick={async () => {
                        setUnlinking(true); setUnlinkErr(null)
                        try {
                          await tripsApi.removeFleetLink(trip.id)
                          onSaved({ ...trip, transporter_profile_id: null, fleet_link_id: null })
                        } catch (e) {
                          setUnlinkErr(e instanceof Error ? e.message : 'Error al desvincular')
                        } finally {
                          setUnlinking(false)
                        }
                      }}
                      className="text-xs text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50"
                    >
                      {unlinking ? <Loader2 size={12} className="animate-spin" /> : 'Desvincular'}
                    </button>
                  </div>
                ) : (
                  <TransporterAssignSection
                    tripId={trip.id}
                    currentTransporter={trip.transporter}
                    onAssigned={onSaved}
                  />
                )}
                {unlinkErr && <p className="text-xs text-red-500">{unlinkErr}</p>}
                {trip.transporter_tms && (
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Empresa reportada por TMS</p>
                    <p className="text-sm text-slate-600">{trip.transporter_tms}</p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Acordeón: Bitácora (solo notas — indicadores y estado ya se editan arriba) */}
          <section className="border border-border rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setBitacoraOpen(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50/60 transition-colors"
            >
              <span className="text-xs font-semibold text-slate-700">Bitácora — Observaciones y comentarios</span>
              <ChevronDown size={13} className={`text-gray-400 transition-transform ${bitacoraOpen ? 'rotate-180' : ''}`} />
            </button>
            {bitacoraOpen && (
              <div className="px-4 pb-4 space-y-4 border-t border-border/60 pt-3">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1.5">Observaciones</label>
                  <textarea
                    rows={3}
                    value={form.observaciones ?? ''}
                    onChange={e => setForm(f => ({ ...f, observaciones: e.target.value }))}
                    placeholder="Novedad operativa…"
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1.5">Comentarios</label>
                  <textarea
                    rows={3}
                    value={form.comentarios ?? ''}
                    onChange={e => setForm(f => ({ ...f, comentarios: e.target.value }))}
                    placeholder="Comentario adicional…"
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none"
                  />
                </div>
                {err && (
                  <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 bg-accent text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-60 transition-colors"
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  Guardar notas
                </button>
              </div>
            )}
          </section>
        </div>
```

- [ ] **Step 8: Correr el test y verificar que pasa**

Run: `cd monitor-app/frontend && npm test -- TripSlideOver`
Expected: `Test Files  1 passed (1)`, 5 tests passed

- [ ] **Step 9: Correr todos los tests y verificar tipos**

Run: `cd monitor-app/frontend && npm test && npx tsc --noEmit`
Expected: todos los tests pasan, sin errores de tipo

- [ ] **Step 10: Commit**

```bash
git add monitor-app/frontend/components/dashboard/TripSlideOver.tsx monitor-app/frontend/components/dashboard/TripSlideOver.test.tsx
git commit -m "feat(diario): TripSlideOver sin tabs — una sola vista scrolleable

Nivel 3 del diseño aprobado: Paradas+Indicadores siempre visibles,
Empresa/Bitácora como acordeones. El override manual se muestra junto
al estado (con fecha y botón de revertir) en vez de un concepto
separado en una tab escondida. Guardar queda acotado a
observaciones/comentarios; indicadores y estado se editan al toque.
Fix: 'Desvincular' empresa ahora muestra el error si falla, en vez de
lanzar sin capturar."
```

---

### Task 8: `GroupBuilder` — prefill desde el filtro activo

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/GroupBuilder.tsx`
- Test: `monitor-app/frontend/components/dashboard/GroupBuilder.test.tsx`

**Interfaces:**
- Produces: `GroupBuilder` gana un prop opcional `initialStatuses?: string[]`, usado por `page.tsx` (Task 9) para el flujo "Guardar como grupo".

- [ ] **Step 1: Escribir el test**

```tsx
// monitor-app/frontend/components/dashboard/GroupBuilder.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GroupBuilder } from './GroupBuilder'

vi.mock('@/lib/api/filterGroups', () => ({
  filterGroupsApi: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
}))

describe('GroupBuilder — prefill', () => {
  it('preselects the statuses passed via initialStatuses when creating a new group', () => {
    render(
      <GroupBuilder
        onSaved={vi.fn()}
        onClose={vi.fn()}
        initialStatuses={['ASIGNADO', 'RUTA']}
        statuses={[
          { id: 'ASIGNADO', label: 'Asignado', bg_color: '#fff', text_color: '#000', group: 'en_ruta' },
          { id: 'RUTA',     label: 'Ruta',     bg_color: '#fff', text_color: '#000', group: 'en_ruta' },
        ]}
      />
    )
    expect(screen.getByText('(2 seleccionados)')).toBeInTheDocument()
  })

  it('editing an existing group still takes priority over initialStatuses', () => {
    render(
      <GroupBuilder
        onSaved={vi.fn()}
        onClose={vi.fn()}
        initialStatuses={['ASIGNADO']}
        editing={{ id: 'g1', name: 'Mi grupo', statuses: ['RUTA', 'ORIGEN'], color: 'blue', created_at: '', updated_at: '' }}
        statuses={[
          { id: 'ASIGNADO', label: 'Asignado', bg_color: '#fff', text_color: '#000', group: 'en_ruta' },
          { id: 'RUTA',     label: 'Ruta',     bg_color: '#fff', text_color: '#000', group: 'en_ruta' },
          { id: 'ORIGEN',   label: 'Origen',   bg_color: '#fff', text_color: '#000', group: 'en_ruta' },
        ]}
      />
    )
    expect(screen.getByText('(2 seleccionados)')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Mi grupo')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd monitor-app/frontend && npm test -- GroupBuilder`
Expected: FAIL — `initialStatuses` no existe en `Props`, se ignora.

- [ ] **Step 3: Agregar el prop `initialStatuses`**

Reemplazar (actuales líneas 47-58):

```tsx
interface Props {
  editing?:   FilterGroup
  onSaved:    (group: FilterGroup) => void
  onDeleted?: (id: string) => void
  onClose:    () => void
  statuses?:  StatusMeta[]   // from meta — replaces hardcoded STATUS_SECTIONS
}

export function GroupBuilder({ editing, onSaved, onDeleted, onClose, statuses }: Props) {
  const STATUS_SECTIONS = buildSections(statuses)
  const [name,      setName]      = useState(editing?.name ?? '')
  const [selected,  setSelected]  = useState<Set<string>>(new Set(editing?.statuses ?? []))
  const [color,     setColor]     = useState<GroupColor>(editing?.color ?? 'blue')
```

por:

```tsx
interface Props {
  editing?:          FilterGroup
  onSaved:           (group: FilterGroup) => void
  onDeleted?:        (id: string) => void
  onClose:           () => void
  statuses?:         StatusMeta[]   // from meta — replaces hardcoded STATUS_SECTIONS
  initialStatuses?:  string[]       // prefill al crear desde el filtro activo (page.tsx "Guardar como grupo")
}

export function GroupBuilder({ editing, onSaved, onDeleted, onClose, statuses, initialStatuses }: Props) {
  const STATUS_SECTIONS = buildSections(statuses)
  const [name,      setName]      = useState(editing?.name ?? '')
  const [selected,  setSelected]  = useState<Set<string>>(new Set(editing?.statuses ?? initialStatuses ?? []))
  const [color,     setColor]     = useState<GroupColor>(editing?.color ?? 'blue')
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd monitor-app/frontend && npm test -- GroupBuilder`
Expected: `Test Files  1 passed (1)`, 2 tests passed

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/GroupBuilder.tsx monitor-app/frontend/components/dashboard/GroupBuilder.test.tsx
git commit -m "feat(diario): GroupBuilder acepta initialStatuses para prefill

Permite crear un grupo a partir del filtro de estado ya activo, en vez
de reconstruir la selección desde cero (spec 2026-07-02)."
```

---

### Task 9: `page.tsx` — "Guardar como grupo" desde el filtro activo

**Files:**
- Modify: `monitor-app/frontend/app/dashboard/diario/page.tsx`

**Interfaces:**
- Consumes: `GroupBuilder` con `initialStatuses` (Task 8).

**Contexto:** `statusParam` (línea 124-133 del archivo actual) ya resuelve la lista de estados del filtro activo (sea grupo default o custom) a un string `"A,B,C"`. Se reutiliza para prefillar.

- [ ] **Step 1: Agregar el botón "Guardar como grupo" junto al chip "Grupo" en la barra de filtros**

Reemplazar (actual línea 415-423):

```tsx
              {/* Create group button */}
              <button
                onClick={() => { setEditingGroup(undefined); setShowBuilder(true) }}
                className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border border-dashed border-gray-300 text-gray-400 hover:border-accent hover:text-accent transition-all"
                title="Crear grupo personalizado"
              >
                <Plus size={11} />
                Grupo
              </button>
            </div>
```

por:

```tsx
              {/* Create group button */}
              <button
                onClick={() => { setEditingGroup(undefined); setShowBuilder(true) }}
                className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border border-dashed border-gray-300 text-gray-400 hover:border-accent hover:text-accent transition-all"
                title="Crear grupo personalizado"
              >
                <Plus size={11} />
                Grupo
              </button>

              {/* Save current filter as a group — prefills GroupBuilder with the active statuses */}
              {statusParam && (
                <button
                  onClick={() => { setEditingGroup(undefined); setShowBuilder(true) }}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border border-dashed border-accent/40 text-accent hover:border-accent hover:bg-accent/5 transition-all"
                  title="Guardar el filtro de estado actual como grupo"
                >
                  <Plus size={11} />
                  Guardar como grupo
                </button>
              )}
            </div>
```

- [ ] **Step 2: Pasar `initialStatuses` al `GroupBuilder` montado**

Reemplazar (actual líneas 225-233):

```tsx
      {showBuilder && (
        <GroupBuilder
          editing={editingGroup}
          onSaved={handleGroupSaved}
          onDeleted={handleGroupDeleted}
          onClose={() => { setShowBuilder(false); setEditingGroup(undefined) }}
          statuses={tripsMeta?.statuses}
        />
      )}
```

por:

```tsx
      {showBuilder && (
        <GroupBuilder
          editing={editingGroup}
          onSaved={handleGroupSaved}
          onDeleted={handleGroupDeleted}
          onClose={() => { setShowBuilder(false); setEditingGroup(undefined) }}
          statuses={tripsMeta?.statuses}
          initialStatuses={statusParam ? statusParam.split(',') : undefined}
        />
      )}
```

(Nota: como el botón "Guardar como grupo" solo aparece cuando `statusParam` no está vacío, y `editingGroup` se limpia con `setEditingGroup(undefined)` al abrirlo, este flujo entra siempre por la rama `initialStatuses` de `GroupBuilder` — nunca choca con `editing`.)

- [ ] **Step 3: Verificar tipos y correr el build**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 4: Commit**

```bash
git add monitor-app/frontend/app/dashboard/diario/page.tsx
git commit -m "feat(diario): botón 'Guardar como grupo' desde el filtro activo

Evita reconstruir la selección de estados en GroupBuilder cuando ya
están tildados como filtro — un clic menos (spec 2026-07-02)."
```

---

### Task 10: `page.tsx` — simplificar "Agregar viaje"

**Files:**
- Modify: `monitor-app/frontend/app/dashboard/diario/page.tsx`

**Contexto:** El botón "Agregar viaje" hoy abre un menú con 2 opciones (`showAddMenu`, actuales líneas 291-322). Pasa a abrir directo `TripCreateSlideOver` (el caso más frecuente); "Carga masiva" queda como link secundario al lado.

- [ ] **Step 1: Reemplazar la barra de acciones**

Reemplazar (actuales líneas 290-322):

```tsx
          {/* Barra de acciones — agregar viaje */}
          <div className="flex items-center justify-end">
            <div className="relative">
              <button
                data-tour="trip-create-btn"
                onClick={() => setShowAddMenu(v => !v)}
                onBlur={() => setTimeout(() => setShowAddMenu(false), 150)}
                className="flex items-center gap-2 bg-accent text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-accent/90 transition-colors"
              >
                <Plus size={13} />
                Agregar viaje
                <ChevronDown size={11} className={`transition-transform ${showAddMenu ? 'rotate-180' : ''}`} />
              </button>
              {showAddMenu && (
                <div className="absolute right-0 top-full mt-1.5 bg-white border border-border rounded-xl shadow-lg z-20 w-46 overflow-hidden">
                  <button
                    onClick={() => { setShowCreate(true); setShowAddMenu(false) }}
                    className="w-full flex items-center gap-2.5 px-4 py-3 text-xs font-medium text-slate-700 hover:bg-gray-50 transition-colors"
                  >
                    <Plus size={13} className="text-accent shrink-0" />
                    Agregar uno
                  </button>
                  <button
                    onClick={() => { setShowBulkUpload(true); setShowAddMenu(false) }}
                    className="w-full flex items-center gap-2.5 px-4 py-3 text-xs font-medium text-slate-700 hover:bg-gray-50 transition-colors border-t border-border/50"
                  >
                    <Upload size={13} className="text-accent shrink-0" />
                    Carga masiva (CSV)
                  </button>
                </div>
              )}
            </div>
          </div>
```

por:

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

- [ ] **Step 2: Quitar el estado `showAddMenu`, ya sin uso**

Reemplazar (actual línea 95):

```tsx
  const [showAddMenu,         setShowAddMenu]         = useState(false)
```

Eliminar esa línea por completo.

- [ ] **Step 3: Quitar el import de `ChevronDown` si queda sin uso**

Revisar el import de `lucide-react` (actual línea 4): `ChevronDown` se sigue usando en el chevron de paginación/fecha (`shiftDay`/día siguiente no lo usa, pero conviene grepear antes de tocar el import).

Run: `grep -n "ChevronDown" monitor-app/frontend/app/dashboard/diario/page.tsx`

Si no aparece ninguna otra referencia fuera de la ya eliminada, quitar `ChevronDown` del import de la línea 4. Si aparece en otro lado (ej. paginación de historial usa `ChevronLeft`/`ChevronRight`, no `ChevronDown` — probablemente sí queda sin uso), eliminarlo del import.

- [ ] **Step 4: Verificar tipos**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: sin errores (ni imports no usados, si el proyecto tuviera `noUnusedLocals` activo — verificar `tsconfig.json` si tira error por esto)

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/app/dashboard/diario/page.tsx
git commit -m "feat(diario): 'Agregar viaje' va directo al formulario manual

Antes abría un menú con 2 opciones antes de llegar al form. Carga
masiva queda como link secundario, no como paso intermedio obligatorio
para el caso común (spec 2026-07-02)."
```

---

### Task 11: Verificación end-to-end

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Correr todo el suite de tests**

Run: `cd monitor-app/frontend && npm test`
Expected: todos los test files (Task 2, 3, 4, 5, 6, 7, 8) pasan

- [ ] **Step 2: Verificar tipos en todo el proyecto**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 3: Build de producción**

Run: `cd monitor-app/frontend && npm run build`
Expected: build exitoso, sin errores

- [ ] **Step 4: Verificar backend sin afectar (no hubo cambios de schema/API)**

Run: `cd monitor-app/backend/api && ./venv/bin/python -m pytest tests/ -q`
Expected: `12 passed` (mismo resultado que antes de este plan — confirma que no se rompió nada del lado backend)

- [ ] **Step 5: Smoke test manual en navegador**

1. Levantar backend (`uvicorn app.main:app --port 8001` desde `monitor-app/backend/api`) y frontend (`npm run dev` desde `monitor-app/frontend`, con `FASTAPI_URL=http://localhost:8001` en `.env.local`).
2. Ir a `/dashboard/diario`, click en una fila → debe expandirse in-place mostrando timeline + indicadores, sin abrir modal.
3. Click en un punto de indicador dentro de la fila expandida → debe togglear al instante sin cerrar la expansión ni abrir nada más.
4. Click en "Ver ficha completa" → debe abrir `TripSlideOver` sin tabs, con Paradas/Indicadores arriba y Empresa/Bitácora colapsados.
5. Si el viaje tiene `estado_manual`, verificar que aparece "confirmado manualmente el {fecha}" junto al badge de estado, con botón de revertir.
6. En la barra de filtros, tildar un estado y click en "Guardar como grupo" → el modal debe abrir con esos estados ya preseleccionados.
7. Click en "Agregar viaje" → debe abrir el formulario directo, sin menú intermedio.

Expected: todo lo anterior funciona sin errores de consola.

- [ ] **Step 6: Actualizar `AGENTLOG.md`**

Agregar una entrada nueva documentando: qué se implementó, referencia a `specs/2026-07-02-diario-fila-detalle-design.md` y este plan, decisiones tomadas durante la implementación (si difirieron del plan en algo), y estado de los tests.

---

## Self-Review

**Cobertura de la spec:** los 6 puntos del "Contexto y problema" de la spec están cubiertos — detalle sin tabs (Task 7), indicadores editables desde la fila (Task 4-6), paradas como timeline en vez de tabla de 12 columnas (Task 3, con la tabla técnica preservada como acordeón opcional en Task 7), override manual relocalizado con lenguaje claro (Task 7), "Guardar como grupo" (Task 8-9), y "Agregar viaje" simplificado (Task 10).

**Placeholders:** ninguno — cada step tiene código completo o comandos exactos con output esperado.

**Consistencia de tipos:** `IndicatorField` se define una sola vez en `IndicatorDots.tsx` y no se re-exporta ni se redefine en otro archivo. `TripRowExpanded` y `TripSlideOver` consumen `StopTimeline`/`IndicatorDots` con las mismas firmas definidas en Task 3/4. `GroupBuilder`'s `initialStatuses` no colisiona con `editing` (la lógica de precedencia se prueba explícitamente en Task 8).

**Preguntas abiertas de la spec, resueltas en este plan:**
1. `edited_by` (usuario) — no se agrega, la copia usa solo timestamp (documentado en Task 7).
2. Un solo viaje expandido a la vez — así quedó implementado (`expandedId: string | null`, Task 6).
3. Tabla técnica de 12 columnas — se mantiene, como acordeón colapsado dentro de "Paradas" en la ficha completa (Task 7), no se muestra en el nivel 2 (fila expandida).
