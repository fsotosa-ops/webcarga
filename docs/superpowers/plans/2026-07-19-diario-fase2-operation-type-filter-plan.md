# Diario Fase 2 — Operation Type Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el filtro de región/ciudad de origen en `FilterPopover` por un filtro client-side de `operation_type` (RM/Zona Cero) — mismo dato que ya se ve como badge en cada trip, sin necesitar ningún query param nuevo en el backend.

**Architecture:** `useDiarioFilters` gana un campo multi-toggle (`fOperationType`), replicando exactamente el patrón ya usado por `fTms`. `FilterPopover` cambia una sección de su UI. `page.tsx` deja de enviar `origin_region`/`origin_city` como query params y filtra por `operation_type` client-side en el mismo `useMemo` que ya filtra por `activeSignals`, pero aplicándolo a ambos tabs (a diferencia de `activeSignals`, que solo aplica en `en_curso`).

**Tech Stack:** Next.js 16 / React, Vitest + Testing Library.

## Global Constraints

- No se toca el backend — `list_trips` sigue soportando `origin_region`/`origin_city` como query params (nadie los llama después de este plan, queda como capacidad muerta e inofensiva, mismo criterio de "no tocar lo que no hace falta" del resto de la sesión).
- `TripCreatePayload.origin_region`/`origin_city` (usado por `TripBulkUpload`/CSV) y `Trip.origin_region`/`origin_city` (el dato real, protegido por `merge_exclude_columns`) **no se tocan** — este plan es sobre el filtro de la tabla, no sobre los datos.
- `npx tsc --noEmit` y `npm test` (vitest) limpios al final de cada task.
- Sin verificación en navegador (SSO real, sin credenciales de test en este entorno).
- **Este es el Plan 7 de 7 — el último de la Fase 2.** Al cerrarlo, toda la Fase 2 (unificación crear/editar, `TripSlideOver`, Indicadores, Bitácora, `TripTable`, filtros) queda completa.

---

### Task 1: `useDiarioFilters` — `fOperationType` reemplaza `fRegion`/`fCity`

**Files:**
- Modify: `monitor-app/frontend/hooks/useDiarioFilters.ts` (reescritura completa — archivo chico, cambia en varios puntos no contiguos)
- Modify: `monitor-app/frontend/hooks/useDiarioFilters.test.ts` (reescritura completa)

**Interfaces:**
- Produces: `DiarioFilters.fOperationType: string[]` (reemplaza `fRegion`/`fCity`), acción `{ type: 'toggleOperationType'; id: string }`. Consumido por la Task 2 (`FilterPopover`, `page.tsx`).

- [ ] **Step 1: Reescribir `useDiarioFilters.test.ts` completo**

Reemplazar `monitor-app/frontend/hooks/useDiarioFilters.test.ts` completo:

```typescript
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDiarioFilters, countActiveFilters } from './useDiarioFilters'

describe('useDiarioFilters', () => {
  it('starts on en_curso with the given date and no filters', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    const [f] = result.current
    expect(f.tab).toBe('en_curso')
    expect(f.fecha).toBe('2026-07-04')
    expect(countActiveFilters(f)).toBe(0)
  })

  it('patch resets page to 1 unless page is in the patch', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    act(() => result.current[1]({ type: 'patch', patch: { page: 3 } }))
    expect(result.current[0].page).toBe(3)
    act(() => result.current[1]({ type: 'patch', patch: { q: 'ABCD' } }))
    expect(result.current[0].page).toBe(1)
    expect(result.current[0].q).toBe('ABCD')
  })

  it('toggleGroup activates and deactivates the same key', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    act(() => result.current[1]({ type: 'toggleGroup', key: 'default:en_ruta' }))
    expect(result.current[0].activeGroup).toBe('default:en_ruta')
    act(() => result.current[1]({ type: 'toggleGroup', key: 'default:en_ruta' }))
    expect(result.current[0].activeGroup).toBeNull()
  })

  it('toggleTms adds and removes sources', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    act(() => result.current[1]({ type: 'toggleTms', id: 'wingsuite' }))
    act(() => result.current[1]({ type: 'toggleTms', id: 'sodimac' }))
    expect(result.current[0].fTms).toEqual(['wingsuite', 'sodimac'])
    act(() => result.current[1]({ type: 'toggleTms', id: 'wingsuite' }))
    expect(result.current[0].fTms).toEqual(['sodimac'])
  })

  it('toggleOperationType adds and removes types', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    act(() => result.current[1]({ type: 'toggleOperationType', id: 'RM' }))
    act(() => result.current[1]({ type: 'toggleOperationType', id: 'ZONA_CERO' }))
    expect(result.current[0].fOperationType).toEqual(['RM', 'ZONA_CERO'])
    act(() => result.current[1]({ type: 'toggleOperationType', id: 'RM' }))
    expect(result.current[0].fOperationType).toEqual(['ZONA_CERO'])
  })

  it('toggleSignal adds and removes signals, any kind, same action', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    act(() => result.current[1]({ type: 'toggleSignal', id: 'off_time' }))
    act(() => result.current[1]({ type: 'toggleSignal', id: 'active' }))
    expect(result.current[0].activeSignals).toEqual(['off_time', 'active'])
    act(() => result.current[1]({ type: 'toggleSignal', id: 'off_time' }))
    expect(result.current[0].activeSignals).toEqual(['active'])
  })

  it('clear wipes filters (incluyendo activeSignals) but keeps tab and fecha', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    act(() => result.current[1]({ type: 'patch', patch: { q: 'x' } }))
    act(() => result.current[1]({ type: 'toggleSignal', id: 'active' }))
    act(() => result.current[1]({ type: 'toggleSignal', id: 'off_time' }))
    act(() => result.current[1]({ type: 'clear' }))
    const [f] = result.current
    expect(countActiveFilters(f)).toBe(0)
    expect(f.activeSignals).toEqual([])
    expect(f.fecha).toBe('2026-07-04')
    expect(f.tab).toBe('en_curso')
  })

  it('fOperationType cuenta como filtro activo y clear lo resetea', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    act(() => result.current[1]({ type: 'toggleOperationType', id: 'RM' }))
    act(() => result.current[1]({ type: 'toggleOperationType', id: 'ZONA_CERO' }))
    expect(countActiveFilters(result.current[0])).toBe(2)
    act(() => result.current[1]({ type: 'clear' }))
    expect(result.current[0].fOperationType).toEqual([])
    expect(countActiveFilters(result.current[0])).toBe(0)
  })

  it('activeSignals cuenta en activeCount, cada señal por separado', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    act(() => result.current[1]({ type: 'toggleSignal', id: 'stale' }))
    expect(countActiveFilters(result.current[0])).toBe(1)
    act(() => result.current[1]({ type: 'toggleSignal', id: 'active' }))
    expect(countActiveFilters(result.current[0])).toBe(2)
  })
})
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `cd monitor-app/frontend && npx vitest run hooks/useDiarioFilters.test.ts`
Expected: FAIL — `toggleOperationType` no existe todavía como acción, `fOperationType` no existe en el estado.

- [ ] **Step 3: Reescribir `useDiarioFilters.ts` completo**

Reemplazar `monitor-app/frontend/hooks/useDiarioFilters.ts` completo:

```typescript
'use client'

import { useReducer } from 'react'
import type { AlertSignalId } from '@/lib/utils/alertSignals'

export type Tab = 'en_curso' | 'historial'

export interface DiarioFilters {
  tab:            Tab
  fecha:          string
  q:              string
  fechaDesde:     string
  fechaHasta:     string
  /** 'default:id' o 'custom:id' */
  activeGroup:    string | null
  /** Unifica las 6 alertas KPI (OR entre sí) + los 4 flags operativos (AND
   *  entre sí) en un solo array — un único mecanismo de toggle sin importar
   *  el tipo de señal (Ronda 26, escalabilidad de filtros). */
  activeSignals:  AlertSignalId[]
  fTms:           string[]
  /** Clasificación RM/Zona Cero del origen (public.locations.operation_type)
   *  — reemplaza el filtro de región/ciudad de origen (Fase 2, Plan 7).
   *  Client-side: origin_operation_type ya viene resuelto en cada Trip de
   *  GET /trips, no hace falta ningún query param nuevo. */
  fOperationType: string[]
  page:           number
}

export type DiarioFiltersAction =
  /** Cualquier cambio de filtro resetea page a 1, salvo que el patch traiga page explícito */
  | { type: 'patch'; patch: Partial<DiarioFilters> }
  | { type: 'toggleGroup'; key: string }
  | { type: 'toggleSignal'; id: AlertSignalId }
  | { type: 'toggleTms'; id: string }
  | { type: 'toggleOperationType'; id: string }
  | { type: 'clear' }

function reducer(state: DiarioFilters, action: DiarioFiltersAction): DiarioFilters {
  switch (action.type) {
    case 'patch':
      return { ...state, page: 1, ...action.patch }
    case 'toggleGroup':
      return { ...state, page: 1, activeGroup: state.activeGroup === action.key ? null : action.key }
    case 'toggleSignal':
      return {
        ...state,
        page: 1,
        activeSignals: state.activeSignals.includes(action.id)
          ? state.activeSignals.filter(s => s !== action.id)
          : [...state.activeSignals, action.id],
      }
    case 'toggleTms':
      return {
        ...state,
        page: 1,
        fTms: state.fTms.includes(action.id)
          ? state.fTms.filter(t => t !== action.id)
          : [...state.fTms, action.id],
      }
    case 'toggleOperationType':
      return {
        ...state,
        page: 1,
        fOperationType: state.fOperationType.includes(action.id)
          ? state.fOperationType.filter(t => t !== action.id)
          : [...state.fOperationType, action.id],
      }
    case 'clear':
      return {
        ...state,
        q: '', fechaDesde: '', fechaHasta: '', activeGroup: null,
        activeSignals: [], fTms: [], fOperationType: [], page: 1,
      }
  }
}

export function countActiveFilters(f: DiarioFilters): number {
  return [
    f.q, f.fechaDesde, f.fechaHasta, f.activeGroup,
  ].filter(v => v !== '' && v !== null).length + f.fTms.length + f.activeSignals.length + f.fOperationType.length
}

/** Filtros que viven dentro del popover "Filtros" (para su badge contador) */
export function countPopoverFilters(f: DiarioFilters): number {
  return [
    f.fechaDesde, f.fechaHasta,
  ].filter(v => v !== '' && v !== null).length + f.fTms.length + f.fOperationType.length
}

export function useDiarioFilters(initialFecha: string) {
  return useReducer(reducer, {
    tab: 'en_curso', fecha: initialFecha, q: '', fechaDesde: '', fechaHasta: '',
    activeGroup: null, activeSignals: [], fTms: [], fOperationType: [], page: 1,
  } satisfies DiarioFilters)
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `cd monitor-app/frontend && npx vitest run hooks/useDiarioFilters.test.ts`
Expected: 9 passed.

- [ ] **Step 5: `tsc` limpio**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: **falla** — `FilterPopover.tsx`/`page.tsx` todavía referencian `f.fRegion`/`f.fCity`, que ya no existen en el tipo. Esto es esperado (la Task 2 los corrige) — no correr `npm test` completo todavía, solo confirmar que los tests de este archivo pasan (Step 4) antes de seguir a la Task 2.

- [ ] **Step 6: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/frontend/hooks/useDiarioFilters.ts monitor-app/frontend/hooks/useDiarioFilters.test.ts
git commit -m "feat(diario): useDiarioFilters — fOperationType reemplaza fRegion/fCity"
```

---

### Task 2: `FilterPopover` + `page.tsx` + limpieza de `lib/api/trips.ts`

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/FilterPopover.tsx` (reescritura completa)
- Create: `monitor-app/frontend/components/dashboard/FilterPopover.test.tsx`
- Modify: `monitor-app/frontend/app/dashboard/diario/page.tsx`
- Modify: `monitor-app/frontend/lib/api/trips.ts`

**Interfaces:**
- Consumes: `DiarioFilters.fOperationType`, acción `toggleOperationType` (Task 1).
- Produces: `FilterPopover` sigue exponiendo la misma interfaz pública (`filters`/`dispatch`/`meta`).

- [ ] **Step 1: Escribir `FilterPopover.test.tsx` (nuevo — no existía)**

Crear `monitor-app/frontend/components/dashboard/FilterPopover.test.tsx`:

```tsx
import { useReducer } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FilterPopover } from './FilterPopover'
import { useDiarioFilters } from '@/hooks/useDiarioFilters'
import type { TripsMeta } from '@/lib/types'

const meta: TripsMeta = {
  statuses: [], tms_sources: [], operational_states: [], alert_thresholds: [], csv_columns: [],
  temperature_ranges: [], unassigned_reasons: [],
  operation_types: [
    { id: 'RM', label: 'RM', bg_color: '#e8eeff', text_color: '#053bfa' },
    { id: 'ZONA_CERO', label: 'Zona Cero', bg_color: '#fef3e8', text_color: '#a35b00' },
  ],
}

function Harness({ onDispatch }: { onDispatch?: ReturnType<typeof useDiarioFilters>[1] }) {
  const [filters, dispatch] = useDiarioFilters('2026-07-04')
  return (
    <FilterPopover
      filters={filters}
      dispatch={onDispatch ?? dispatch}
      meta={meta}
    />
  )
}

describe('FilterPopover', () => {
  it('opens the panel and shows a "Tipo de operación" toggle for each catalog entry', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Filtros'))
    expect(screen.getByText('Tipo de operación')).toBeInTheDocument()
    expect(screen.getByText('RM')).toBeInTheDocument()
    expect(screen.getByText('Zona Cero')).toBeInTheDocument()
  })

  it('clicking a operation_type button dispatches toggleOperationType', () => {
    const dispatch = vi.fn()
    render(<Harness onDispatch={dispatch} />)
    fireEvent.click(screen.getByText('Filtros'))
    fireEvent.click(screen.getByText('RM'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'toggleOperationType', id: 'RM' })
  })

  it('no longer shows a región/ciudad de origen picker', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Filtros'))
    expect(screen.queryByText('Ubicación de origen')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Región (filtro)')).not.toBeInTheDocument()
  })

  it('shows the filter count badge including active operation_type selections', () => {
    function CountHarness() {
      const [filters, dispatch] = useDiarioFilters('2026-07-04')
      return <FilterPopover filters={{ ...filters, fOperationType: ['RM'] }} dispatch={dispatch} meta={meta} />
    }
    render(<CountHarness />)
    expect(screen.getByText('1')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/FilterPopover.test.tsx`
Expected: FAIL — `FilterPopover.tsx` todavía muestra "Ubicación de origen"/`RegionCityPicker`, no tiene ninguna sección "Tipo de operación".

- [ ] **Step 3: Reescribir `FilterPopover.tsx` completo**

Reemplazar `monitor-app/frontend/components/dashboard/FilterPopover.tsx` completo:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import type { TripsMeta } from '@/lib/types'
import type { DiarioFilters, DiarioFiltersAction } from '@/hooks/useDiarioFilters'
import { countPopoverFilters } from '@/hooks/useDiarioFilters'

interface Props {
  filters:  DiarioFilters
  dispatch: React.Dispatch<DiarioFiltersAction>
  meta?:    TripsMeta | null
}

/**
 * Filtros de uso ocasional (Fuente TMS, Tipo de operación, rango de fechas)
 * fuera de la barra principal — reduce la carga visual del monitor de ~25 a
 * ~10 controles.
 */
export function FilterPopover({ filters: f, dispatch, meta }: Props) {
  const [open, setOpen] = useState(false)
  const panelRef  = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const count = countPopoverFilters(f)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus() } }
    const onClick = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${
          count > 0
            ? 'text-accent border-accent/40 bg-accent/5'
            : 'text-gray-500 border-border bg-white hover:border-gray-300'
        }`}
      >
        <SlidersHorizontal size={13} />
        Filtros
        {count > 0 && (
          <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 text-[10px] font-bold bg-accent text-white rounded-full">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Filtros adicionales"
          className="absolute right-0 top-full mt-1.5 z-30 w-72 bg-white border border-border rounded-xl shadow-xl p-4 space-y-4 animate-modal-in"
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Filtros</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar filtros"
              className="text-gray-300 hover:text-gray-500">
              <X size={14} />
            </button>
          </div>

          {/* Fuente TMS */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Fuente</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {(meta?.tms_sources ?? []).map(src => {
                const active = f.fTms.includes(src.id)
                return (
                  <button
                    key={src.id}
                    type="button"
                    onClick={() => dispatch({ type: 'toggleTms', id: src.id })}
                    aria-pressed={active}
                    style={active ? { backgroundColor: src.bg_color, color: src.text_color, borderColor: src.bg_color } : undefined}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
                      active ? '' : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    {src.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Indicadores (Activo/Trabajando/Asignado) se movieron a tiles
              visibles arriba de la tabla, junto a las KPI cards — Fase 3
              del hardening del Diario, 2026-07-18. Ya no viven acá. */}

          {/* Tipo de operación (RM/Zona Cero) — reemplaza el filtro de
              región/ciudad de origen (Fase 2, Plan 7). origin_operation_type
              es la clasificación real/automática, ya viene resuelta en cada
              trip de GET /trips — el filtro es 100% client-side, mismo
              mecanismo que las alertas KPI de la Ronda 26. */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Tipo de operación</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {(meta?.operation_types ?? []).map(ot => {
                const active = f.fOperationType.includes(ot.id)
                return (
                  <button
                    key={ot.id}
                    type="button"
                    onClick={() => dispatch({ type: 'toggleOperationType', id: ot.id })}
                    aria-pressed={active}
                    style={active ? { backgroundColor: ot.bg_color, color: ot.text_color, borderColor: ot.bg_color } : undefined}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
                      active ? '' : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    {ot.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Rango de fechas — solo historial */}
          {f.tab === 'historial' && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Rango de fechas</p>
              <div className="flex items-center gap-1.5">
                <input type="date" value={f.fechaDesde} aria-label="Desde"
                  onChange={e => dispatch({ type: 'patch', patch: { fechaDesde: e.target.value } })}
                  className="flex-1 px-2 py-1.5 text-xs border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/20" />
                <span className="text-gray-300 text-xs shrink-0">a</span>
                <input type="date" value={f.fechaHasta} aria-label="Hasta"
                  onChange={e => dispatch({ type: 'patch', patch: { fechaHasta: e.target.value } })}
                  className="flex-1 px-2 py-1.5 text-xs border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/20" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Correr los tests de `FilterPopover` y confirmar que pasan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/FilterPopover.test.tsx`
Expected: 4 passed.

- [ ] **Step 5: Quitar `locParams` y reestructurar `visibleTrips` en `page.tsx`**

En `monitor-app/frontend/app/dashboard/diario/page.tsx`, el bloque de construcción de `params` pasa de:

```tsx
  const boolParams = {
    ...(f.activeSignals.includes('active')          ? { is_active:        true } : {}),
    ...(f.activeSignals.includes('working')         ? { is_working:       true } : {}),
    ...(f.activeSignals.includes('assigned')        ? { is_assigned:      true } : {}),
    ...(f.activeSignals.includes('second_leg_plus') ? { second_leg_plus:  true } : {}),
  }
  const locParams = {
    ...(f.fRegion ? { origin_region: f.fRegion } : {}),
    ...(f.fCity   ? { origin_city:   f.fCity }   : {}),
  }
  const params: TripListParams =
    f.tab === 'en_curso'
      ? { fecha: f.fecha, view: 'en_curso', q: qDebounced, status: statusParam, tms: f.fTms.join(','), limit: 200, ...boolParams, ...locParams }
      : { view: 'historial', q: qDebounced, fecha_desde: f.fechaDesde, fecha_hasta: f.fechaHasta,
          status: statusParam, tms: f.fTms.join(','), limit: HISTORIAL_LIMIT, page: f.page, ...boolParams, ...locParams }
```

A:

```tsx
  const boolParams = {
    ...(f.activeSignals.includes('active')          ? { is_active:        true } : {}),
    ...(f.activeSignals.includes('working')         ? { is_working:       true } : {}),
    ...(f.activeSignals.includes('assigned')        ? { is_assigned:      true } : {}),
    ...(f.activeSignals.includes('second_leg_plus') ? { second_leg_plus:  true } : {}),
  }
  const params: TripListParams =
    f.tab === 'en_curso'
      ? { fecha: f.fecha, view: 'en_curso', q: qDebounced, status: statusParam, tms: f.fTms.join(','), limit: 200, ...boolParams }
      : { view: 'historial', q: qDebounced, fecha_desde: f.fechaDesde, fecha_hasta: f.fechaHasta,
          status: statusParam, tms: f.fTms.join(','), limit: HISTORIAL_LIMIT, page: f.page, ...boolParams }
```

Y el `useMemo` de `visibleTrips` pasa de:

```tsx
  const visibleTrips = useMemo(() => {
    if (f.tab !== 'en_curso' || f.activeSignals.length === 0) return trips
    return trips.filter(t => matchesActiveSignals(t, f.activeSignals, tripsMeta?.temperature_ranges ?? [], alertRules))
  }, [trips, f.tab, f.activeSignals, tripsMeta?.temperature_ranges, alertRules])
```

A:

```tsx
  const visibleTrips = useMemo(() => {
    let result = trips
    if (f.tab === 'en_curso' && f.activeSignals.length > 0) {
      result = result.filter(t => matchesActiveSignals(t, f.activeSignals, tripsMeta?.temperature_ranges ?? [], alertRules))
    }
    // Tipo de operación (Fase 2, Plan 7) — a diferencia de activeSignals,
    // aplica en ambos tabs (en_curso e historial): no es una alerta de
    // operación en vivo, es una clasificación permanente del origen.
    if (f.fOperationType.length > 0) {
      result = result.filter(t => f.fOperationType.includes(t.origin_operation_type ?? ''))
    }
    return result
  }, [trips, f.tab, f.activeSignals, f.fOperationType, tripsMeta?.temperature_ranges, alertRules])
```

- [ ] **Step 6: Limpiar `origin_region`/`origin_city` en `lib/api/trips.ts`**

En `monitor-app/frontend/lib/api/trips.ts`, `TripPatch` (línea 11) pasa de:

```typescript
export type TripPatch = {
  is_active?:      boolean
  is_working?:     boolean
  is_assigned?:    boolean
  is_first_leg?:   boolean
  manual_status?:  string
  notes?:          string
  comments?:       string
  origin_region?:  string
  origin_city?:    string
  driver_name?:    string
  driver_phone?:   string
  tractor_plate?:  string
  trailer_plate?:  string
  // cag_inicio_at/cag_fin_at removidos (Fase 1, 2026-07-18) — Carga
  // Inicio/Fin se edita vía TripStopPatch sobre la parada ORIGIN, mismo
  // mecanismo que Desc. Inicio/Fin de cualquier destino.
  unassigned_reason_id?: string
}
```

A (sin `origin_region`/`origin_city` — sin ningún consumidor real desde que el Plan 4 retiró el picker de región/ciudad del detalle del viaje):

```typescript
export type TripPatch = {
  is_active?:      boolean
  is_working?:     boolean
  is_assigned?:    boolean
  is_first_leg?:   boolean
  manual_status?:  string
  notes?:          string
  comments?:       string
  driver_name?:    string
  driver_phone?:   string
  tractor_plate?:  string
  trailer_plate?:  string
  // cag_inicio_at/cag_fin_at removidos (Fase 1, 2026-07-18) — Carga
  // Inicio/Fin se edita vía TripStopPatch sobre la parada ORIGIN, mismo
  // mecanismo que Desc. Inicio/Fin de cualquier destino.
  unassigned_reason_id?: string
}
```

Y `tripsApi.list` (línea 47) pasa de:

```typescript
  list: (params?: {
    fecha?:          string
    view?:           'en_curso' | 'historial'
    q?:              string
    fecha_desde?:    string
    fecha_hasta?:    string
    status?:         string
    is_active?:      boolean
    is_working?:     boolean
    is_assigned?:    boolean
    second_leg_plus?: boolean
    tms?:            string
    client?:         string
    origin_region?:  string
    origin_city?:    string
    sort?:           'default' | 'status_reported_at_asc' | 'status_reported_at_desc'
    page?:           number
    limit?:          number
  }) => {
    const qs = new URLSearchParams()
    if (params?.fecha)           qs.set('fecha',           params.fecha)
    if (params?.view)            qs.set('view',            params.view)
    if (params?.q)               qs.set('q',               params.q)
    if (params?.fecha_desde)     qs.set('fecha_desde',     params.fecha_desde)
    if (params?.fecha_hasta)     qs.set('fecha_hasta',     params.fecha_hasta)
    if (params?.status)          qs.set('status',          params.status)
    if (params?.tms)             qs.set('tms',             params.tms)
    if (params?.client)          qs.set('client',          params.client)
    if (params?.origin_region)   qs.set('origin_region',   params.origin_region)
    if (params?.origin_city)     qs.set('origin_city',     params.origin_city)
    if (params?.sort)            qs.set('sort',            params.sort)
    if (params?.is_active       != null) qs.set('is_active',       String(params.is_active))
    if (params?.is_working      != null) qs.set('is_working',      String(params.is_working))
    if (params?.is_assigned     != null) qs.set('is_assigned',     String(params.is_assigned))
    if (params?.second_leg_plus != null) qs.set('second_leg_plus', String(params.second_leg_plus))
    if (params?.page)            qs.set('page',            String(params.page))
    if (params?.limit)           qs.set('limit',           String(params.limit))
    const suffix = qs.toString() ? `?${qs}` : ''
    return apiFetch<TripListResponse>(`/api/v1/trips/${suffix}`)
  },
```

A (sin `origin_region`/`origin_city` — el backend `list_trips` sigue soportando esos query params, pero ya nadie del frontend los llama; se deja de exponerlos acá, no se toca el backend):

```typescript
  list: (params?: {
    fecha?:          string
    view?:           'en_curso' | 'historial'
    q?:              string
    fecha_desde?:    string
    fecha_hasta?:    string
    status?:         string
    is_active?:      boolean
    is_working?:     boolean
    is_assigned?:    boolean
    second_leg_plus?: boolean
    tms?:            string
    client?:         string
    sort?:           'default' | 'status_reported_at_asc' | 'status_reported_at_desc'
    page?:           number
    limit?:          number
  }) => {
    const qs = new URLSearchParams()
    if (params?.fecha)           qs.set('fecha',           params.fecha)
    if (params?.view)            qs.set('view',            params.view)
    if (params?.q)               qs.set('q',               params.q)
    if (params?.fecha_desde)     qs.set('fecha_desde',     params.fecha_desde)
    if (params?.fecha_hasta)     qs.set('fecha_hasta',     params.fecha_hasta)
    if (params?.status)          qs.set('status',          params.status)
    if (params?.tms)             qs.set('tms',             params.tms)
    if (params?.client)          qs.set('client',          params.client)
    if (params?.sort)            qs.set('sort',            params.sort)
    if (params?.is_active       != null) qs.set('is_active',       String(params.is_active))
    if (params?.is_working      != null) qs.set('is_working',      String(params.is_working))
    if (params?.is_assigned     != null) qs.set('is_assigned',     String(params.is_assigned))
    if (params?.second_leg_plus != null) qs.set('second_leg_plus', String(params.second_leg_plus))
    if (params?.page)            qs.set('page',            String(params.page))
    if (params?.limit)           qs.set('limit',           String(params.limit))
    const suffix = qs.toString() ? `?${qs}` : ''
    return apiFetch<TripListResponse>(`/api/v1/trips/${suffix}`)
  },
```

- [ ] **Step 7: `tsc` limpio y suite completa**

Run: `cd monitor-app/frontend && npx tsc --noEmit && npm test`
Expected: sin errores de tipos (confirma que ya no queda ninguna referencia a `fRegion`/`fCity`/`origin_region`/`origin_city` en `page.tsx`/`FilterPopover.tsx`/`TripPatch`); toda la suite de vitest pasa sin regresiones.

- [ ] **Step 8: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/frontend/components/dashboard/FilterPopover.tsx monitor-app/frontend/components/dashboard/FilterPopover.test.tsx monitor-app/frontend/app/dashboard/diario/page.tsx monitor-app/frontend/lib/api/trips.ts
git commit -m "feat(diario): filtro por operation_type en FilterPopover, baja del filtro región/ciudad — cierra la Fase 2"
```

---

## Self-Review

**1. Cobertura del spec**: cubre la decisión de diseño #9 completa — filtro de región/ciudad retirado de `FilterPopover`, filtro por `operation_type` agregado en su lugar, client-side, sin query param nuevo en el backend. Con esto, los 7 planes de la Fase 2 quedan completos.
**2. Placeholders**: ninguno — cada paso tiene código completo (archivos enteros donde el archivo es chico, diffs exactos con contexto real donde es grande).
**3. Consistencia de tipos**: `fOperationType`/`toggleOperationType` (Task 1) se usan con el mismo nombre y forma en `FilterPopover.tsx`/`page.tsx` (Task 2); `origin_operation_type` es el mismo campo ya existente en `Trip` (Plan 4 ya lo usaba para el badge de "Ubicación de origen" del detalle).
**4. Alcance**: no toca el backend (`list_trips` sigue aceptando `origin_region`/`origin_city`, simplemente sin consumidor), no toca `TripCreatePayload.origin_region`/`origin_city` (CSV, fuera de alcance), no toca `Trip.origin_region`/`origin_city` (el dato real).
**5. Gap real encontrado y cerrado**: `TripPatch.origin_region`/`origin_city` quedó huérfano desde el Plan 4 (que borró el único código que los usaba) — la Task 2 lo limpia como parte natural de este plan, en vez de dejarlo como deuda silenciosa.
**6. Orden entre tasks**: Task 1 (`useDiarioFilters`) es prerrequisito real de Task 2 (`FilterPopover`/`page.tsx` usan `fOperationType`/`toggleOperationType` desde el primer render) — deben ejecutarse en ese orden. La Task 1 deja `tsc` en rojo a propósito (Step 5 lo advierte explícitamente) hasta que la Task 2 corrija los consumidores — riesgo documentado, no un error de plan.
