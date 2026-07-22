# Diario Fase 2 — TripTable Read-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retirar los 3 editores inline (`ConductorCell`, `PhoneTagCell`, `PlateCell`) de la tabla desktop de `TripTable` — clic en cualquier parte de la fila abre el detalle, toda edición se concentra ahí (mismo criterio ya aplicado a Indicadores en la Ronda 23).

**Architecture:** Un único archivo grande (`TripTable.tsx`) pierde 3 componentes internos y sus usos en 3 `<td>`, reemplazados por el mismo texto plano que la lista mobile ya muestra hoy (que resultó estar sin cambios necesarios — ver Global Constraints). El prop `onSaved`, ahora sin ningún consumidor dentro del archivo, se retira de la interfaz pública y de su único call site real.

**Tech Stack:** Next.js 16 / React, Vitest + Testing Library.

## Global Constraints

- La sección "Mobile: card list" de `TripTable.tsx` (líneas 414-501 al momento de escribir este plan) **no se toca** — ya es de solo lectura hoy (no usa `ConductorCell`/`PhoneTagCell`/`PlateCell`, sin `stopPropagation` en celdas editables porque no hay ninguna). El texto del spec que sugiere simplificarla también no aplica a la realidad actual del código.
- `TripCard.tsx` (usado por `TripBoard.tsx`, vista de tablero aparte) **no se toca** — ya es de solo lectura, no usa ninguno de los 3 editores retirados.
- El enlace `tel:` del teléfono conserva su propio `stopPropagation` — es una acción legítima distinta de "editar" (llamar no debe abrir el detalle del viaje).
- `npx tsc --noEmit` y `npm test` (vitest) limpios al final de la task.
- Sin verificación en navegador (SSO real, sin credenciales de test en este entorno).

---

### Task 1: `TripTable` de solo lectura — retiro de `ConductorCell`/`PhoneTagCell`/`PlateCell`

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/TripTable.tsx` (reescritura completa)
- Modify: `monitor-app/frontend/components/dashboard/TripTable.test.tsx` (reescritura completa)
- Modify: `monitor-app/frontend/app/dashboard/diario/page.tsx:553`

**Interfaces:**
- Produces: `TripTable` pierde el prop `onSaved` de su interfaz pública — `page.tsx` deja de pasarlo. `TmsChip`/`ComplianceAlertSummary`/`AlertStatus` (exports ya existentes, consumidos por `TripCard.tsx`/`page.tsx`) no cambian.

- [ ] **Step 1: Reescribir `TripTable.test.tsx` completo**

Reemplazar `monitor-app/frontend/components/dashboard/TripTable.test.tsx` completo:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TripTable } from './TripTable'
import type { Trip } from '@/lib/types'

function makeTrip(id: string, overrides: Partial<Trip> = {}): Trip {
  return {
    id, source_system: 'qanalytics', client_name: 'walmart', planning_date: '2026-07-02',
    status_reported_at: null, current_status: 'ORIGEN', tractor_plate: 'ABCD12', tractor_plate_tms: null, trailer_plate: null,
    driver_name: 'Juan Perez', driver_name_tms: null, driver_tax_id: null, driver_phone: null, carrier_name: null, carrier_name_tms: null,
    origin: 'CD Quilicura', cargo_type: 'FRIO', stops: [], is_active: true, is_working: false, is_assigned: true,
    is_first_leg: false, manual_status: null, notes: null, comments: null, unassigned_reason_id: null,
    fleet_link_id: null, carrier_id: null, driver_id: null, tractor_asset_id: null, trailer_asset_id: null, manually_edited_fields: [], edited_at: null,
    edited_by: null, updated_at: null, created_at: null,
    source_system_trip_id: '2000711', milestone_status: null, pipeline_updated_at: null,
    ...overrides,
  }
}

describe('TripTable', () => {
  it('calls onSelect directly when a row is clicked (no intermediate expand step)', () => {
    const onSelect = vi.fn()
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={onSelect} meta={null} />)
    fireEvent.click(screen.getAllByText('ABCD12')[0])
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
  })

  it('shows an OFF TIME compliance badge when a stop is off time', () => {
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: null, departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: 'OFF TIME', destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null,
    }]
    render(<TripTable trips={[makeTrip('t1', { stops })]} selectedId={null} onSelect={vi.fn()} meta={null} />)
    expect(screen.getAllByText(/OFF TIME/).length).toBeGreaterThan(0)
  })

  it('does not show a compliance badge when no stop has on_time_status data', () => {
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={vi.fn()} meta={null} />)
    expect(screen.queryByText(/OFF TIME/)).not.toBeInTheDocument()
  })

  it('shows the ETA of the active stop next to the status', () => {
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: '2026-07-02 09:00:00', arrival_date: null, departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: null, destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null,
    }]
    render(<TripTable trips={[makeTrip('t1', { stops })]} selectedId={null} onSelect={vi.fn()} meta={null} />)
    expect(screen.getAllByText(/llega ~\d{2}:\d{2}/).length).toBeGreaterThan(0)
  })

  it('shows time since the last TMS report next to the status', () => {
    const trip = makeTrip('t1', { status_reported_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() })
    render(<TripTable trips={[trip]} selectedId={null} onSelect={vi.fn()} meta={null} />)
    expect(screen.getAllByText(/hace 5 min/).length).toBeGreaterThan(0)
  })

  it('shows the RM/Zona Cero classification badge next to a stop when operation_type resolved (H2.6, catálogo de locales)', () => {
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'ALAMEDA - 72', planning_date: null, arrival_date: null, departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: null, destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null, operation_type: 'RM',
    }]
    const meta = {
      statuses: [], tms_sources: [], operational_states: [], alert_thresholds: [], csv_columns: [],
      temperature_ranges: [], unassigned_reasons: [],
      operation_types: [{ id: 'RM', label: 'RM', bg_color: '#e8eeff', text_color: '#053bfa' }],
    }
    render(<TripTable trips={[makeTrip('t1', { stops })]} selectedId={null} onSelect={vi.fn()} meta={meta} />)
    expect(screen.getAllByText('RM').length).toBeGreaterThan(0)
  })

  it('does not show a classification badge when operation_type could not be resolved', () => {
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'CD LO AGUIRRE', planning_date: null, arrival_date: null, departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: null, destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null, operation_type: null,
    }]
    render(<TripTable trips={[makeTrip('t1', { stops })]} selectedId={null} onSelect={vi.fn()} meta={null} />)
    expect(screen.queryByText('RM')).not.toBeInTheDocument()
  })
})

describe('TripTable — solo lectura (Fase 2, Plan 6)', () => {
  it('renders conductor, patente and phone as read-only text, with no editable inputs anywhere in the table', () => {
    render(<TripTable trips={[makeTrip('t1', { driver_phone: JSON.stringify(['+56911112222']) })]} selectedId={null} onSelect={vi.fn()} meta={null} />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText('+56911112222')).toBeInTheDocument()
  })

  it('clicking the conductor cell opens the detail instead of entering edit mode', () => {
    const onSelect = vi.fn()
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={onSelect} meta={null} />)
    fireEvent.click(screen.getAllByText('Juan Perez')[1])
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
    expect(screen.queryByDisplayValue('Juan Perez')).not.toBeInTheDocument()
  })

  it('clicking the patente cell opens the detail instead of entering edit mode', () => {
    const onSelect = vi.fn()
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={onSelect} meta={null} />)
    fireEvent.click(screen.getAllByText('ABCD12')[1])
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
    expect(screen.queryByPlaceholderText('XXNN00')).not.toBeInTheDocument()
  })

  it('shows both plates when tractor and trailer are set', () => {
    render(<TripTable trips={[makeTrip('t1', { tractor_plate: 'ABCD12', trailer_plate: 'RMPL01' })]} selectedId={null} onSelect={vi.fn()} meta={null} />)
    expect(screen.getAllByText('ABCD12').length).toBeGreaterThan(0)
    expect(screen.getAllByText('RMPL01').length).toBeGreaterThan(0)
  })

  it('clicking a phone number does not trigger onSelect (tel: link stays a distinct action from opening the detail)', () => {
    const onSelect = vi.fn()
    render(<TripTable trips={[makeTrip('t1', { driver_phone: JSON.stringify(['+56911112222']) })]} selectedId={null} onSelect={onSelect} meta={null} />)
    fireEvent.click(screen.getByText('+56911112222'))
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('TripTable — estado manual resuelto contra estados operacionales', () => {
  it('muestra el label del estado operacional (no el uuid) cuando hay override', () => {
    const meta = {
      statuses: [{ id: 'ORIGEN', label: 'ORIGEN', bg_color: '#fff', text_color: '#000', group: 'en_ruta' }],
      operational_states: [{ id: 'op-uuid-1', label: 'Confirmado en panne', bg_color: '#fee', text_color: '#b00', group: 'problema' }],
      tms_sources: [], alert_thresholds: [], csv_columns: [], temperature_ranges: [], unassigned_reasons: [], operation_types: [],
    }
    const trip = makeTrip('t1', { manual_status: 'op-uuid-1' })
    render(<TripTable trips={[trip]} selectedId={null} onSelect={vi.fn()} meta={meta} />)
    expect(screen.getAllByText('Confirmado en panne').length).toBeGreaterThan(0)
    expect(screen.queryByText('op-uuid-1')).not.toBeInTheDocument()
  })
})

describe('TripTable — orden tipado', () => {
  it('sorts ID Viaje numerically, not lexicographically', () => {
    const trips = [
      makeTrip('a', { source_system_trip_id: '10' }),
      makeTrip('b', { source_system_trip_id: '9' }),
    ]
    render(<TripTable trips={trips} selectedId={null} onSelect={vi.fn()} meta={null} />)
    fireEvent.click(screen.getByText('ID Viaje'))
    const ids = screen.getAllByText(/^(9|10)$/).map(el => el.textContent)
    expect(ids).toEqual(['9', '10'])
  })

  it('sorts null values last regardless of direction', () => {
    const trips = [
      makeTrip('a', { driver_name: null }),
      makeTrip('b', { driver_name: 'Ana' }),
    ]
    render(<TripTable trips={trips} selectedId={null} onSelect={vi.fn()} meta={null} />)
    fireEvent.click(screen.getByText('Conductor'))
    const rows = document.querySelectorAll('tbody tr')
    expect(rows[0].textContent).toContain('Ana')
  })
})

describe('TripTable — accesibilidad por teclado', () => {
  it('opens the detail with Enter on a focused row', () => {
    const onSelect = vi.fn()
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={onSelect} meta={null} />)
    const row = screen.getAllByText('ABCD12')[1].closest('tr')!
    expect(row).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
  })

  it('moves focus to the next/previous row with arrow keys', () => {
    render(
      <TripTable
        trips={[makeTrip('t1'), makeTrip('t2', { tractor_plate: 'WXYZ99' })]}
        selectedId={null} onSelect={vi.fn()} meta={null}
      />,
    )
    const rows = document.querySelectorAll('tbody tr')
    ;(rows[0] as HTMLElement).focus()
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[1])
    fireEvent.keyDown(rows[1], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(rows[0])
  })
})

describe('TripTable — columnas fijas (sticky)', () => {
  it('Patente queda fija a la izquierda y Estado/chevron de apertura a la derecha', () => {
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={vi.fn()} meta={null} />)
    const patenteTh = screen.getByText('Patente').closest('th')!
    const estadoTh  = screen.getByText('Estado').closest('th')!
    const chevronTh = screen.getByText('Abrir detalle').closest('th')!
    expect(patenteTh.className).toContain('sticky left-0')
    expect(estadoTh.className).toContain('sticky right-')
    expect(chevronTh.className).toContain('sticky right-0')
  })
})
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/TripTable.test.tsx`
Expected: FAIL — el componente actual todavía exige el prop `onSaved` (TypeScript) y sigue teniendo editores inline (`getByRole('textbox')` los encontraría).

- [ ] **Step 3: Reescribir `TripTable.tsx` completo**

Reemplazar `monitor-app/frontend/components/dashboard/TripTable.tsx` completo:

```tsx
'use client'

import { useState, useMemo } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import type { Trip, TripStop, TripsMeta } from '@/lib/types'
import { ComplianceBadge } from './ComplianceBadge'

// TODO(H2.6): venían de GET /transporters/compliance-alerts/summary (Checkpoint
// A-E, borrado). Sin productor hasta que se resuelva el puente del Diario con
// el modelo nuevo de Empresas — alertSummary queda siempre null/undefined
// mientras tanto (degradación limpia, no se muestran alertas de vencimiento).
export type AlertStatus = 'expired' | 'expiring_soon' | 'ok'
export type ComplianceAlertSummary = {
  driver_ruts:         Record<string, AlertStatus>
  plates:              Record<string, AlertStatus>
  total_expired:       number
  total_expiring_soon: number
}
import { getLatestTemp, classifyTemperature, getActiveStop, describeStopTiming } from '@/lib/utils/temperature'
import { stopComplianceSummary } from '@/lib/utils/compliance'
import { formatRelativeTime, normalizeUTC } from '@/lib/utils/datetime'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { OperationTypeBadge } from '@/components/ui/OperationTypeBadge'


export function TmsChip({ tms, meta }: { tms: string; meta?: TripsMeta | null }) {
  const tm = meta?.tms_sources.find(x => x.id === tms.toLowerCase())
  const label = tm?.label ?? tms.toUpperCase().slice(0, 3)
  return (
    <span
      className="text-[9px] font-bold px-1.5 py-0.5 rounded border"
      style={tm
        ? { backgroundColor: tm.bg_color, color: tm.text_color, borderColor: `${tm.bg_color}80` }
        : { backgroundColor: '#f3f4f6', color: '#6b7280', borderColor: '#e5e7eb' }}
    >
      {label}
    </span>
  )
}

function StopPills({ stops, meta }: { stops: TripStop[]; meta?: TripsMeta | null }) {
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
          <div key={stop.stop_id ?? i} className="flex items-center gap-1">
            <span
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
            <OperationTypeBadge operationType={stop.operation_type} meta={meta} />
          </div>
        )
      })}
    </div>
  )
}

// Phones stored as JSON array string in driver_phone column
function parsePhones(raw: string | null): string[] {
  if (!raw) return []
  try {
    const p = JSON.parse(raw)
    if (Array.isArray(p)) return p.filter(Boolean)
  } catch { /* plain string */ }
  return [raw]
}

type SortKey = 'planning_date' | 'tractor_plate' | 'driver_name' | 'carrier_name' | 'client_name' | 'current_status' | 'source_system_trip_id'

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey | null; sortDir: 'asc' | 'desc' }) {
  if (sortKey !== col) return <ArrowUpDown size={10} className="inline ml-0.5 text-gray-300" />
  if (sortDir === 'asc') return <ArrowUp size={10} className="inline ml-0.5 text-accent" />
  return <ArrowDown size={10} className="inline ml-0.5 text-accent" />
}

interface Props {
  trips:         Trip[]
  selectedId:    string | null
  onSelect:      (trip: Trip) => void
  alertSummary?: ComplianceAlertSummary | null
  meta?:         TripsMeta | null
  /** Viajes cuyo último reporte TMS cambió en el refetch más reciente — glow sutil */
  updatedIds?:   Set<string>
}

export function TripTable({ trips, selectedId, onSelect, alertSummary, meta, updatedIds }: Props) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  function handleSort(col: SortKey) {
    if (sortKey !== col) { setSortKey(col); setSortDir('asc') }
    else if (sortDir === 'asc') setSortDir('desc')
    else { setSortKey(null); setSortDir('asc') }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return trips
    // Orden natural: '9' < '10', fechas ISO ordenan bien, acentos ignorados. Nulls siempre al final.
    const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' })
    return [...trips].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = collator.compare(String(av), String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [trips, sortKey, sortDir])

  if (trips.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-12 text-center text-sm text-gray-400">
        Sin viajes para los filtros seleccionados
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">

      {/* ── Mobile: card list ─────────────────────────────────────── */}
      <div className="md:hidden divide-y divide-border/60">
        {trips.map(trip => {
          const isActive      = trip.id === selectedId
          const primaryPlate  = trip.tractor_plate ?? trip.trailer_plate ?? null
          const plateAlert    = alertSummary?.plates[primaryPlate ?? ''] as AlertStatus | undefined
          const driverAlert   = alertSummary?.driver_ruts[trip.driver_tax_id ?? ''] as AlertStatus | undefined
          const currentStatus = trip.manual_status ?? trip.current_status

          return (
            <div
              key={trip.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(trip)}
              onKeyDown={e => {
                if (e.key === 'Enter') onSelect(trip)
                else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  const sibling = e.key === 'ArrowDown'
                    ? e.currentTarget.nextElementSibling
                    : e.currentTarget.previousElementSibling
                  ;(sibling as HTMLElement | null)?.focus?.()
                }
              }}
              className={`px-4 py-3 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${
                updatedIds?.has(trip.id) ? 'bg-amber-50' :
                isActive ? 'bg-accent/5 border-l-2 border-l-accent' : 'hover:bg-gray-50/60'
              }`}
            >
              {/* fila 1: patente + temp + estado */}
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`font-mono text-sm font-bold shrink-0 ${primaryPlate ? 'text-slate-800' : 'text-gray-300 italic font-normal text-xs'}`}>
                    {primaryPlate ?? 'sin patente'}
                  </span>
                  <ComplianceBadge status={plateAlert ?? null} compact />
                  <TmsChip tms={trip.source_system ?? ''} meta={meta} />
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(() => {
                    const temp = getLatestTemp(trip.stops ?? [])
                    const tempStatus = classifyTemperature(temp, trip.cargo_type, meta?.temperature_ranges ?? [])
                    return temp != null
                      ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tempStatus === 'out_of_range' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>{temp}°C</span>
                      : null
                  })()}
                  <StatusBadge status={currentStatus} meta={meta} />
                  {stopComplianceSummary(trip.stops ?? []) === 'warn' && (
                    <span className="text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full whitespace-nowrap">OFF TIME</span>
                  )}
                </div>
              </div>

              {/* fila 2: conductor */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-slate-600 truncate">
                  {trip.driver_name ?? <span className="text-gray-300 italic text-[11px]">sin conductor</span>}
                </span>
                <ComplianceBadge status={driverAlert ?? null} compact />
              </div>

              {/* fila 3: EETT + origen */}
              <div className="flex items-center gap-1.5 mt-1 text-[10px] text-gray-400 min-w-0">
                {trip.carrier_id
                  ? <span className="font-medium text-slate-500 truncate max-w-[160px]">{trip.carrier_name}</span>
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

      {/* ── Desktop: table ────────────────────────────────────────── */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 1080 }}>
          <thead>
            <tr className="bg-gray-50 border-b border-border text-[10px] font-bold text-gray-400 uppercase tracking-wide">
              <th onClick={() => handleSort('tractor_plate')} className="sticky left-0 z-10 bg-inherit border-r border-border/60 px-3 py-2.5 text-left w-[110px] cursor-pointer select-none hover:bg-gray-100 transition-colors">Patente<SortIcon col="tractor_plate" sortKey={sortKey} sortDir={sortDir} /></th>
              <th onClick={() => handleSort('planning_date')} className="px-3 py-2.5 text-left w-[72px] cursor-pointer select-none hover:bg-gray-100 transition-colors">Fecha<SortIcon col="planning_date" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className="px-2 py-2.5 text-left w-[44px]">TMS</th>
              <th onClick={() => handleSort('source_system_trip_id')} className="px-3 py-2.5 text-left w-[110px] cursor-pointer select-none hover:bg-gray-100 transition-colors">ID Viaje<SortIcon col="source_system_trip_id" sortKey={sortKey} sortDir={sortDir} /></th>
              <th onClick={() => handleSort('driver_name')} className="px-3 py-2.5 text-left w-[150px] cursor-pointer select-none hover:bg-gray-100 transition-colors">Conductor<SortIcon col="driver_name" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className="px-3 py-2.5 text-left w-[110px]">Teléfono</th>
              <th onClick={() => handleSort('carrier_name')} className="px-3 py-2.5 text-left w-[130px] cursor-pointer select-none hover:bg-gray-100 transition-colors">EETT<SortIcon col="carrier_name" sortKey={sortKey} sortDir={sortDir} /></th>
              <th onClick={() => handleSort('client_name')} className="px-3 py-2.5 text-left w-[100px] cursor-pointer select-none hover:bg-gray-100 transition-colors">Cliente<SortIcon col="client_name" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className="px-3 py-2.5 text-left w-[110px]">Origen · Carga</th>
              <th className="px-3 py-2.5 text-left">Destinos</th>
              <th className="px-3 py-2.5 text-center w-[72px]">Temp</th>
              <th onClick={() => handleSort('current_status')} className="sticky right-[90px] z-10 bg-inherit border-l border-border/60 px-3 py-2.5 text-left w-[110px] cursor-pointer select-none hover:bg-gray-100 transition-colors">Estado<SortIcon col="current_status" sortKey={sortKey} sortDir={sortDir} /></th>
              {/* Indicadores se movió a tabs de filtro arriba de la tabla
                  (Fase 3, 2026-07-18) — esta columna ahora es solo el
                  chevron de apertura del detalle. */}
              <th className="sticky right-0 z-10 bg-inherit px-3 py-2.5 text-left w-[32px]">
                <span className="sr-only">Abrir detalle</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((trip, i) => {
              const isActive       = trip.id === selectedId
              const primaryPlate   = trip.tractor_plate ?? trip.trailer_plate ?? null
              const secondaryPlate = trip.tractor_plate && trip.trailer_plate ? trip.trailer_plate : null
              const plateAlert     = alertSummary?.plates[trip.tractor_plate ?? ''] as AlertStatus | undefined
              const driverAlert    = alertSummary?.driver_ruts[trip.driver_tax_id ?? ''] as AlertStatus | undefined
              const currentStatus  = trip.manual_status ?? trip.current_status
              const phones         = parsePhones(trip.driver_phone)

              return (
                <tr
                  key={trip.id}
                  tabIndex={0}
                  aria-selected={isActive}
                  onClick={() => onSelect(trip)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && e.target === e.currentTarget) onSelect(trip)
                    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault()
                      const sibling = e.key === 'ArrowDown'
                        ? e.currentTarget.nextElementSibling
                        : e.currentTarget.previousElementSibling
                      ;(sibling as HTMLElement | null)?.focus?.()
                    }
                  }}
                  className={`border-b border-border/60 last:border-0 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${
                    updatedIds?.has(trip.id)
                      ? 'bg-amber-50'
                      : isActive
                      ? 'bg-sky-50 border-l-2 border-l-accent'
                      : i % 2 === 1
                      ? 'bg-gray-50 hover:bg-gray-100'
                      : 'bg-white hover:bg-gray-50'
                  }`}
                >
                  {/* PATENTE — sticky: siempre visible al scrollear horizontal.
                      Solo lectura (Fase 2, Plan 6) — se editaba inline con
                      PlateCell, ahora el mismo texto que ya mostraba el card
                      mobile, sin click-to-edit; clic en cualquier parte de la
                      fila abre el detalle. */}
                  <td className="sticky left-0 z-10 bg-inherit border-r border-border/60 px-3 py-2.5">
                    <div className="flex items-start gap-1.5">
                      <div>
                        <span className={`font-mono text-xs font-bold ${primaryPlate ? 'text-slate-800' : 'text-gray-300 italic font-normal'}`}>
                          {primaryPlate ?? 'sin patente'}
                        </span>
                        {secondaryPlate && (
                          <span className="font-mono text-[10px] text-gray-400 mt-0.5 block">
                            {secondaryPlate}
                          </span>
                        )}
                      </div>
                      <ComplianceBadge status={plateAlert ?? null} compact
                        tooltip={plateAlert === 'expired' ? 'Vehículo vencido' : 'Vence pronto'} />
                    </div>
                  </td>

                  {/* FECHA */}
                  <td className="px-3 py-2.5">
                    <p className="text-[11px] text-gray-700 font-medium whitespace-nowrap">
                      {trip.planning_date
                        ? new Date(trip.planning_date + 'T12:00:00').toLocaleDateString('es-CL', {
                            day: '2-digit', month: '2-digit',
                          })
                        : '—'}
                    </p>
                    {trip.status_reported_at && (
                      <p className="text-[9px] text-gray-300 whitespace-nowrap mt-0.5">
                        {new Intl.DateTimeFormat('es-CL', {
                          timeZone: 'America/Santiago',
                          hour: '2-digit', minute: '2-digit', second: '2-digit',
                          hour12: false,
                        }).format(new Date(normalizeUTC(trip.status_reported_at)))}
                      </p>
                    )}
                  </td>

                  {/* TMS */}
                  <td className="px-2 py-2.5">
                    <TmsChip tms={trip.source_system ?? ''} meta={meta} />
                  </td>

                  {/* ID VIAJE */}
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-[11px] text-gray-500">
                      {trip.source_system_trip_id ?? '—'}
                    </span>
                  </td>

                  {/* CONDUCTOR — solo lectura (Fase 2, Plan 6), antes ConductorCell */}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-700 font-medium leading-tight">
                        {trip.driver_name ?? <span className="text-gray-300 italic">sin asignar</span>}
                      </span>
                      <ComplianceBadge status={driverAlert ?? null} compact />
                    </div>
                  </td>

                  {/* TELÉFONO — solo lectura (Fase 2, Plan 6), antes PhoneTagCell.
                      El enlace tel: conserva stopPropagation: llamar es una
                      acción distinta de abrir el detalle, no "editar". */}
                  <td className="px-3 py-2.5">
                    {phones.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {phones.map(p => (
                          <a
                            key={p}
                            href={`tel:${p}`}
                            onClick={e => e.stopPropagation()}
                            className="text-[10px] font-mono text-accent hover:underline block"
                          >
                            {p}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[10px] text-gray-300">—</span>
                    )}
                  </td>

                  {/* EETT */}
                  <td className="px-3 py-2.5">
                    {trip.carrier_id ? (
                      <span className="text-xs font-medium text-slate-700 leading-tight block truncate max-w-[120px]">
                        {trip.carrier_name}
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-300 italic">sin vincular</span>
                    )}
                  </td>

                  {/* CLIENTE */}
                  <td className="px-3 py-2.5">
                    <span className="text-[11px] text-gray-500 truncate block max-w-[100px]">
                      {trip.client_name ?? '—'}
                    </span>
                  </td>

                  {/* ORIGEN · CARGA */}
                  <td className="px-3 py-2.5">
                    <p className="text-[11px] text-gray-600 truncate max-w-[110px]">
                      {trip.origin ?? '—'}
                    </p>
                    {trip.cargo_type && (
                      <span className="text-[9px] text-gray-400 bg-gray-50 border border-gray-100 px-1 py-0.5 rounded mt-0.5 inline-block truncate max-w-[110px]">
                        {trip.cargo_type}
                      </span>
                    )}
                  </td>

                  {/* DESTINOS */}
                  <td className="px-3 py-2.5 max-w-[200px]">
                    <StopPills stops={trip.stops} meta={meta} />
                  </td>

                  {/* TEMP */}
                  <td className="px-3 py-2.5 text-center">
                    {(() => {
                      const temp = getLatestTemp(trip.stops ?? [])
                      const tempStatus = classifyTemperature(temp, trip.cargo_type, meta?.temperature_ranges ?? [])
                      return temp != null
                        ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tempStatus === 'out_of_range' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>{temp}°C</span>
                        : <span className="text-gray-300 text-xs">—</span>
                    })()}
                  </td>

                  {/* ESTADO — sticky derecha */}
                  <td className="sticky right-[90px] z-10 bg-inherit border-l border-border/60 px-3 py-2.5">
                    <StatusBadge status={currentStatus} meta={meta} />
                    {trip.manual_status && (
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

                  {/* Chevron de apertura — sticky derecha. Los indicadores
                      (Activo/Trabajando/Asignado) se ven y filtran arriba de
                      la tabla, se editan en el detalle (Fase 3 del hardening
                      del Diario, 2026-07-18). */}
                  <td className="sticky right-0 z-10 bg-inherit px-3 py-2.5 text-center">
                    <span className={`text-xs shrink-0 ${isActive ? 'text-accent' : 'text-gray-200'}`}>›</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Actualizar el único call site real en `page.tsx`**

En `monitor-app/frontend/app/dashboard/diario/page.tsx`, el bloque de `<TripTable>` (línea ~549) pasa de:

```tsx
                <TripTable
                  trips={visibleTrips}
                  selectedId={selected?.id ?? null}
                  onSelect={setSelected}
                  onSaved={handleSaved}
                  alertSummary={alertSummary}
                  meta={tripsMeta}
                  updatedIds={updatedIds}
                />
```

A:

```tsx
                <TripTable
                  trips={visibleTrips}
                  selectedId={selected?.id ?? null}
                  onSelect={setSelected}
                  alertSummary={alertSummary}
                  meta={tripsMeta}
                  updatedIds={updatedIds}
                />
```

(El `<TripBoard onSaved={handleSaved} .../>` de la línea anterior **no se toca** — es un componente distinto que sigue necesitando ese prop.)

- [ ] **Step 5: Correr los tests y confirmar que pasan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/TripTable.test.tsx`
Expected: todos pasan.

- [ ] **Step 6: `tsc` limpio y suite completa**

Run: `cd monitor-app/frontend && npx tsc --noEmit && npm test`
Expected: sin errores de tipos (confirma que `page.tsx` ya no pasa `onSaved` a `TripTable` y que no queda ninguna referencia a los 3 editores retirados); toda la suite de vitest pasa sin regresiones.

- [ ] **Step 7: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/frontend/components/dashboard/TripTable.tsx monitor-app/frontend/components/dashboard/TripTable.test.tsx monitor-app/frontend/app/dashboard/diario/page.tsx
git commit -m "feat(diario): TripTable de solo lectura — retiro de ConductorCell/PhoneTagCell/PlateCell"
```

---

## Self-Review

**1. Cobertura del spec**: cubre "TripTable — solo lectura" completo — los 3 editores retirados, clic en cualquier parte de la fila abre el detalle (comportamiento que ya existía y se preserva). La afirmación del spec sobre simplificar el mobile card list se verificó contra el código real y no aplicaba (ya estaba simplificado) — documentado en Global Constraints en vez de ignorado silenciosamente.
**2. Placeholders**: ninguno — Task 1 reescribe ambos archivos completos y da el diff puntual exacto de `page.tsx`.
**3. Consistencia de tipos**: `Props` de `TripTable` (sin `onSaved`) se usa igual en el componente y en todos los tests reescritos; `page.tsx` deja de pasar ese prop, coherente con la nueva interfaz.
**4. Alcance**: no toca `TripCard.tsx`/`TripBoard.tsx` (confirmado ya de solo lectura, con su propio `onSaved` real para otra funcionalidad) ni la sección mobile de `TripTable.tsx` (confirmado ya de solo lectura).
**5. Riesgo real evitado**: si se hubiera quitado `onSaved` de `TripTable` sin actualizar `page.tsx` en el mismo paso, `tsc` habría fallado inmediatamente (prop desconocido en JSX) — el Step 4 lo hace en el mismo commit que el Step 3, nunca queda el árbol roto entre pasos.
