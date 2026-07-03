# Diario — Rediseño del modal de detalle de viaje (TripSlideOver) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reordenar el modal de detalle de viaje (`TripSlideOver.tsx`) según el Enfoque A aprobado — sincronización consolidada con tiempo relativo, ruta promovida, separación visual lectura/edición — y condicionar `IndicatorDots` a `source_system === 'manual'` en los 3 lugares donde se usa (`TripSlideOver`, `TripTable`, `TripCard`).

**Architecture:** 100% frontend, reorganización de datos ya expuestos por la API — sin cambios de backend ni de tipos. Una función pura nueva (`formatRelativeTime`) más una reescritura completa del `return` de `TripSlideOver.tsx` (misma lógica de estado/handlers, JSX reordenado), más un guard condicional de una línea en `TripTable.tsx` y `TripCard.tsx`.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind CSS, Vitest + React Testing Library.

## Global Constraints

- Ningún error de `PATCH`/`DELETE` se silencia — el manejo de errores existente en `handleSave`/`handleSetOverride`/`handleClearOverride`/`removeFleetLink` NO se toca, solo se reubica su renderizado dentro del nuevo layout.
- `IndicatorDots` se renderiza (visible + editable) únicamente cuando `trip.source_system === 'manual'` — aplicado de forma idéntica en `TripSlideOver.tsx`, `TripTable.tsx` (mobile y desktop) y `TripCard.tsx`. Cuando la condición es falsa, el bloque no se renderiza en absoluto (no deshabilitado, no oculto con CSS — ausente del DOM).
- Cero campos repetidos: cada dato de `app.trips` vive en un solo lugar del modal.
- Temperatura: badge junto al Estado en el header, siempre visible cuando `getLatestTemp(trip.stops) != null` (no solo cuando está fuera de rango), coloreado rojo si `classifyTemperature(...) === 'out_of_range'`, azul/neutro en caso contrario — mismo patrón visual ya usado en `TripCard.tsx`.
- Sin cambios de backend, sin cambios de `lib/types.ts` — `source_system` ya existe y ya está tipado en `Trip`.
- Adjuntos en Bitácora quedan fuera de alcance (spec aparte) — Bitácora se reubica tal cual (mismos 2 textareas, mismo botón, misma lógica de guardado), solo deja de ser un acordeón colapsable independiente.

---

### Task 1: `formatRelativeTime` — tiempo relativo para la línea de Sincronización

**Files:**
- Modify: `monitor-app/frontend/lib/utils/datetime.ts`
- Modify: `monitor-app/frontend/lib/utils/datetime.test.ts`

**Interfaces:**
- Produces: `formatRelativeTime(iso: string | null | undefined): string` — usado por Task 2 (`TripSlideOver.tsx`).

**Contexto:** El archivo ya tiene una función privada `normalizeUTC(iso: string): string` (línea 2, no exportada) que agrega `Z` a timestamps del pipeline sin offset explícito — `formatRelativeTime` la reutiliza igual que `fmtDT`/`fmtShort` ya hacen, sin exportarla (misma función, mismo archivo).

- [ ] **Step 1: Escribir los tests (fallan porque la función no existe)**

Agregar al final de `datetime.test.ts` (después del `describe('fmtDate', ...)` existente, sin tocar nada de lo ya presente):

```ts
describe('formatRelativeTime', () => {
  it('returns em dash for null/undefined', () => {
    expect(formatRelativeTime(null)).toBe('—')
    expect(formatRelativeTime(undefined)).toBe('—')
  })

  it('returns em dash for an invalid date string', () => {
    expect(formatRelativeTime('not-a-date')).toBe('—')
  })

  it('returns "hace unos segundos" for timestamps under a minute old', () => {
    const iso = new Date(Date.now() - 30 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('hace unos segundos')
  })

  it('formats minutes for timestamps under an hour old', () => {
    const iso = new Date(Date.now() - 12 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('hace 12 min')
  })

  it('formats hours for timestamps under a day old', () => {
    const iso = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('hace 3 h')
  })

  it('formats days for timestamps a day or more old', () => {
    const iso = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('hace 2 d')
  })
})
```

Y actualizar el import del inicio del archivo (línea 2):

```ts
import { fmtDT, fmtShort, fmtDate } from './datetime'
```

por:

```ts
import { fmtDT, fmtShort, fmtDate, formatRelativeTime } from './datetime'
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd monitor-app/frontend && npm test -- datetime`
Expected: FAIL — `formatRelativeTime is not a function` (o error de import)

- [ ] **Step 3: Implementar `formatRelativeTime`**

Agregar al final de `monitor-app/frontend/lib/utils/datetime.ts`:

```ts

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(normalizeUTC(iso))
  if (isNaN(d.getTime())) return '—'
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diffSec < 60) return 'hace unos segundos'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `hace ${diffMin} min`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `hace ${diffHour} h`
  const diffDay = Math.floor(diffHour / 24)
  return `hace ${diffDay} d`
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd monitor-app/frontend && npm test -- datetime`
Expected: `Test Files  1 passed (1)`, todos los tests (los ya existentes de `fmtDT`/`fmtShort`/`fmtDate` + los 6 nuevos de `formatRelativeTime`) en verde.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/lib/utils/datetime.ts monitor-app/frontend/lib/utils/datetime.test.ts
git commit -m "feat(diario): formatRelativeTime — tiempo relativo en español

Building block para la línea de Sincronización del modal de detalle
('hace 12 min' en vez de fechas absolutas sueltas)."
```

---

### Task 2: `TripSlideOver.tsx` — reestructuración completa del modal

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/TripSlideOver.tsx`
- Modify: `monitor-app/frontend/components/dashboard/TripSlideOver.test.tsx`

**Interfaces:**
- Consumes: `formatRelativeTime` (Task 1).
- Produces: sin cambio de firma pública (`{ trip, onClose, onSaved, meta }`) — solo cambia el layout interno.

**Contexto:** Este es el task más grande del plan — reescribe el `return` completo del componente. El estado, los handlers (`handleSave`, `handleSetOverride`, `handleClearOverride`, `handleCopyId`) y los sub-componentes internos (`TransporterAssignSection`, `MetaField`) NO cambian de lógica, solo el `bitacoraOpen` state se elimina (Bitácora deja de ser colapsable). El archivo completo actual tiene 726 líneas — se reemplaza entero para evitar una secuencia larga y frágil de diffs parciales sobre una reestructuración que reordena secciones enteras.

- [ ] **Step 1: Escribir/actualizar los tests primero**

Reemplazar el archivo completo `TripSlideOver.test.tsx`:

```tsx
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
  edited_by: null, created_at: null,
  updated_at: null, source_system_trip_id: '2000711', milestone_status: null, pipeline_updated_at: null,
}

describe('TripSlideOver — reordenado (Enfoque A)', () => {
  beforeEach(() => {
    vi.mocked(tripsApi.patch).mockReset()
    vi.mocked(tripsApi.resetField).mockReset()
  })

  it('does not render a tab bar', () => {
    render(<TripSlideOver trip={baseTrip} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.queryByText('Empresa')).not.toBeInTheDocument() // no tab button, solo el acordeón (título distinto abajo)
  })

  it('shows Empresa as a collapsed accordion that expands on click', () => {
    render(<TripSlideOver trip={baseTrip} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    const empresaHeader = screen.getByText('Empresa transportista')
    expect(screen.queryByText('sin vincular', { exact: false })).not.toBeInTheDocument()
    fireEvent.click(empresaHeader)
    expect(screen.getByPlaceholderText(/Buscar empresa/)).toBeInTheDocument()
  })

  it('shows Bitácora always expanded, not behind an accordion toggle', () => {
    render(<TripSlideOver trip={baseTrip} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getByPlaceholderText('Novedad operativa…')).toBeInTheDocument()
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

  it('shows a visible error when reverting the override fails', async () => {
    vi.mocked(tripsApi.resetField).mockRejectedValue(new Error('network down'))
    const tripWithOverride = { ...baseTrip, estado_manual: 'en_seguimiento' }
    render(<TripSlideOver trip={tripWithOverride} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    fireEvent.click(screen.getByTitle('Revertir a valor del TMS'))
    expect(await screen.findByText('network down')).toBeInTheDocument()
  })

  it('shows created_at in the footer', () => {
    const tripWithCreated = { ...baseTrip, created_at: '2026-06-30 08:00:00' }
    render(<TripSlideOver trip={tripWithCreated} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getByText('Ingresó al sistema')).toBeInTheDocument()
  })

  it('shows the internal trip id in the footer', () => {
    render(<TripSlideOver trip={baseTrip} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getByText('t1')).toBeInTheDocument()
  })

  it('shows the editor name in the override attribution when estado_manual is set', () => {
    const tripWithOverride = { ...baseTrip, estado_manual: 'en_seguimiento', edited_at: '2026-07-02 10:15:00', edited_by: 'Felipe Sumadots' }
    render(<TripSlideOver trip={tripWithOverride} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getByText(/Felipe Sumadots/)).toBeInTheDocument()
  })

  it('shows a consolidated sync line with relative times for TMS report and pipeline sync', () => {
    const tripSynced = { ...baseTrip, status_reported_at: new Date(Date.now() - 12 * 60 * 1000).toISOString(), pipeline_updated_at: new Date(Date.now() - 8 * 60 * 1000).toISOString() }
    render(<TripSlideOver trip={tripSynced} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getByText(/TMS reportó hace 12 min/)).toBeInTheDocument()
    expect(screen.getByText(/Pipeline sincronizó hace 8 min/)).toBeInTheDocument()
  })

  it('promotes Ruta above Datos operativos in the DOM order', () => {
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: null, departure_date: null,
      unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: null, destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null,
    }]
    render(<TripSlideOver trip={{ ...baseTrip, stops }} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    const rutaHeading = screen.getByText(/Ruta \(1 parada/)
    const datosHeading = screen.getByText('Datos operativos')
    expect(rutaHeading.compareDocumentPosition(datosHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('does not render Indicadores for a TMS-sourced trip', () => {
    render(<TripSlideOver trip={baseTrip} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.queryByTitle('Activo')).not.toBeInTheDocument()
  })

  it('renders editable Indicadores for a manual trip', () => {
    const manualTrip = { ...baseTrip, source_system: 'manual' }
    render(<TripSlideOver trip={manualTrip} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getByTitle('Activo')).toBeInTheDocument()
  })

  it('shows a temperature badge in the header when a reading exists', () => {
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: '2026-07-02 10:00:00', departure_date: null,
      unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: null, destination_city: null, destination_region: null, s2s: null,
      temperature: 4, milestone_status: null,
    }]
    render(<TripSlideOver trip={{ ...baseTrip, stops }} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getByText('4°C')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd monitor-app/frontend && npm test -- TripSlideOver`
Expected: FAIL — varios tests nuevos fallan (sync line, orden Ruta/Datos operativos, Indicadores condicional, temp badge, Bitácora siempre expandida) porque el componente todavía no implementa la nueva estructura.

- [ ] **Step 3: Reemplazar el archivo completo `TripSlideOver.tsx`**

```tsx
'use client'

import { useState, useEffect } from 'react'
import {
  X, Loader2, Building2, Copy, Check,
  Truck, User, Phone, Hash,
  MapPin, ChevronDown, RotateCcw,
} from 'lucide-react'
import type { Trip, TransporterListItem, TripsMeta } from '@/lib/types'
import { tripsApi, type TripPatch, type FleetLinkPayload } from '@/lib/api/trips'
import { transportersApi } from '@/lib/api/transporters'
import { getLatestTemp, stopWasVisited, classifyTemperature } from '@/lib/utils/temperature'
import { fmtDT, fmtDate, formatRelativeTime } from '@/lib/utils/datetime'
import { StopTimeline } from './StopTimeline'
import { IndicatorDots } from './IndicatorDots'

// ── TransporterAssignSection ──────────────────────────────────────────────────

function TransporterAssignSection({
  tripId,
  currentTransporter,
  onAssigned,
}: {
  tripId: string
  currentTransporter: string | null
  onAssigned: (t: Trip) => void
}) {
  const [query, setQuery]         = useState('')
  const [results, setResults]     = useState<TransporterListItem[]>([])
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)

  useEffect(() => {
    if (query.length < 2) { setResults([]); setSearchErr(null); setSearching(false); return }
    setSearching(true)
    setSearchErr(null)
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await transportersApi.list({ q: query, page: 1, limit: 12 })
        if (!ctrl.signal.aborted) setResults(res.data)
      } catch (e) {
        if (!ctrl.signal.aborted) {
          setSearchErr(e instanceof Error ? e.message : 'Error al buscar')
          setResults([])
        }
      } finally {
        if (!ctrl.signal.aborted) setSearching(false)
      }
    }, 300)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [query])

  const assign = async (profileId: string) => {
    setSaving(true)
    try {
      const payload: FleetLinkPayload = { transporter_id: profileId }
      const updated = await tripsApi.assignFleetLink(tripId, payload)
      onAssigned(updated)
      setResults([])
      setQuery('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      {currentTransporter && (
        <p className="text-[10px] text-gray-400 bg-gray-50 px-2 py-1 rounded border border-border/60">
          TMS reporta: <span className="font-medium text-gray-600">{currentTransporter}</span>
        </p>
      )}
      <div className="relative">
        <input
          type="text"
          placeholder="Buscar empresa por nombre o RUT…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full text-xs border border-border rounded-lg px-3 py-2 pr-7 focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        {searching && (
          <Loader2 size={12} className="animate-spin text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
        )}
      </div>
      {searchErr && <p className="text-[10px] text-red-500 px-1">{searchErr}</p>}
      {results.length > 0 && (
        <ul className="border border-border rounded-lg divide-y divide-border overflow-y-auto max-h-52 bg-white shadow-md">
          {results.map(tp => (
            <li key={tp.id}>
              <button
                type="button"
                onClick={() => assign(tp.id)}
                disabled={saving}
                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center justify-between"
              >
                <div>
                  <p className="font-medium text-slate-700">{tp.business_name ?? '—'}</p>
                  <p className="text-gray-400 font-mono text-[10px]">{tp.rut ?? ''}</p>
                </div>
                {saving && <Loader2 size={12} className="animate-spin text-accent" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.length >= 2 && !searching && results.length === 0 && !searchErr && (
        <p className="text-[10px] text-gray-400 px-1">Sin resultados para "{query}"</p>
      )}
    </div>
  )
}

// ── MetaField helper ──────────────────────────────────────────────────────────

function MetaField({
  label, value, icon, highlight = false,
}: {
  label: string
  value: string
  icon?: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div>
      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      <div className="flex items-center gap-1">
        {icon}
        <p className={`text-xs leading-snug ${highlight ? 'font-semibold text-accent' : 'text-slate-700'}`}>
          {value}
        </p>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

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
  const [techDetailOpen, setTechDetailOpen]     = useState(false)
  const [unlinkErr, setUnlinkErr]               = useState<string | null>(null)
  const [unlinking, setUnlinking]               = useState(false)

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

  async function handleClearOverride() {
    if (!trip) return
    setClearingOverride(true)
    try {
      await tripsApi.resetField(trip.id, 'estado_manual')
      onSaved({ ...trip, estado_manual: null })
      setForm(f => ({ ...f, estado_manual: '' }))
      setShowEstadoSelect(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al revertir')
    } finally {
      setClearingOverride(false)
    }
  }

  function handleCopyId() {
    if (!trip?.source_system_trip_id) return
    navigator.clipboard.writeText(trip.source_system_trip_id).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (!trip) return null

  const currentStatus = trip.estado_manual ?? trip.current_status
  const statusMeta    = currentStatus ? meta?.statuses.find(s => s.id === currentStatus) : null
  const tmsMeta       = trip.source_system ? meta?.tms_sources.find(t => t.id === trip.source_system.toLowerCase()) : null
  const tmsLabel      = tmsMeta?.label ?? trip.source_system?.toUpperCase().slice(0, 3) ?? '?'
  const temp          = getLatestTemp(trip.stops ?? [])
  const tempStatus    = classifyTemperature(temp, trip.cargo_type, meta?.temperature_ranges ?? [])
  const isManualTrip  = trip.source_system === 'manual'

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-0 z-50 flex flex-col bg-white
                      md:inset-4
                      md:rounded-2xl md:shadow-2xl overflow-hidden">

        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="bg-slate-900 px-4 py-3 md:px-6 md:py-4 shrink-0 space-y-2.5">

          {/* Row 1: TMS + ID + cerrar */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              {tmsMeta || trip.source_system ? (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                  style={tmsMeta
                    ? { backgroundColor: tmsMeta.bg_color, color: tmsMeta.text_color }
                    : { backgroundColor: '#334155', color: '#94a3b8' }}
                >
                  {tmsLabel}
                </span>
              ) : null}
              {trip.source_system_trip_id && (
                <div className="flex items-center gap-1.5 min-w-0">
                  <Hash size={11} className="text-white/40 shrink-0" />
                  <span className="font-mono text-xs text-white/60 truncate">
                    {trip.source_system_trip_id}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyId}
                    title="Copiar ID de viaje"
                    className="text-white/40 hover:text-white/80 transition-colors shrink-0"
                  >
                    {copied
                      ? <Check size={12} className="text-green-400" />
                      : <Copy size={12} />}
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-white/50 hover:text-white transition-colors shrink-0 p-1 rounded-lg hover:bg-white/10"
            >
              <X size={20} />
            </button>
          </div>

          {/* Row 2: Patente + Estado + Temp */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Truck size={14} className="text-white/40 shrink-0" />
              <span className="font-mono text-base font-bold text-white">
                {trip.tractor_plate ?? trip.trailer_plate ?? 'Sin patente'}
              </span>
              {trip.tractor_plate && trip.trailer_plate && (
                <span className="font-mono text-xs text-white/40">/ {trip.trailer_plate}</span>
              )}
            </div>
            <span
              className="text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0"
              style={statusMeta
                ? { backgroundColor: statusMeta.bg_color, color: statusMeta.text_color }
                : { backgroundColor: '#334155', color: '#94a3b8' }}
            >
              {currentStatus ?? 'Sin estado'}
            </span>
            {temp != null && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${tempStatus === 'out_of_range' ? 'bg-red-500/20 text-red-300' : 'bg-blue-500/20 text-blue-300'}`}>
                {temp}°C
              </span>
            )}
          </div>

          {/* Row 3: Conductor + Cliente */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 min-w-0">
              <User size={11} className="text-white/40 shrink-0" />
              <span className="text-xs text-white/80 truncate">{trip.driver_name ?? '—'}</span>
              {trip.driver_rut && (
                <span className="font-mono text-[11px] text-white/40 shrink-0">{trip.driver_rut}</span>
              )}
            </div>
            {trip.driver_phone && (
              <a
                href={`tel:${trip.driver_phone}`}
                className="flex items-center gap-1 text-[11px] font-mono text-accent/80 hover:text-accent shrink-0"
                onClick={e => e.stopPropagation()}
              >
                <Phone size={10} />
                {trip.driver_phone}
              </a>
            )}
            {trip.client_name && (
              <span className="text-[11px] text-white/35 hidden md:inline truncate">
                · {trip.client_name}
              </span>
            )}
          </div>
        </div>

        {/* ── Sincronización ────────────────────────────────────────── */}
        <div className="px-4 py-2 md:px-6 border-b border-border/80 bg-gray-50/60 shrink-0 flex items-center gap-1.5 text-[10.5px] text-gray-500">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
          <span>TMS reportó {formatRelativeTime(trip.status_reported_at)}</span>
          <span className="text-gray-300">·</span>
          <span>Pipeline sincronizó {formatRelativeTime(trip.pipeline_updated_at)}</span>
        </div>

        {/* ── Body — una sola vista, sin tabs ──────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4 md:p-6 space-y-6">

          {/* Ruta — promovida, primer bloque del cuerpo */}
          {(trip.stops?.length ?? 0) > 0 && (
            <section>
              <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <MapPin size={11} /> Ruta ({trip.stops.length} parada{trip.stops.length === 1 ? '' : 's'})
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

          {/* Datos operativos — solo lectura */}
          <section className="bg-gray-50/60 rounded-xl p-4 md:p-5">
            <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
              Datos operativos
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
              <MetaField label="Fecha planificación" value={fmtDate(trip.planning_date)} />
              <MetaField label="Origen" value={trip.origin ?? '—'} />
              <MetaField label="Tipo carga" value={trip.cargo_type ?? '—'} />
              <MetaField label="EETT TMS" value={trip.transporter_tms ?? '—'} />
              {trip.milestone_status && (
                <MetaField label="Estado cumplimiento" value={trip.milestone_status} highlight />
              )}
            </div>
          </section>

          {/* Gestión — editable */}
          <section className="bg-accent/5 border-l-[3px] border-l-accent rounded-xl p-4 md:p-5 space-y-5">
            <h4 className="text-[10px] font-bold text-accent uppercase tracking-widest">
              Gestión
            </h4>

            {/* Estado operativo */}
            <div>
              <h5 className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-2">Estado operativo</h5>
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
                    confirmado manualmente {trip.edited_by ? `por ${trip.edited_by} ` : ''}el {fmtDT(trip.edited_at)}
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

              {err && (
                <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-2">{err}</p>
              )}
            </div>

            {/* Indicadores — solo para viajes manuales */}
            {isManualTrip && (
              <div>
                <h5 className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-2">Indicadores</h5>
                <IndicatorDots trip={trip} onSaved={onSaved} size="md" />
              </div>
            )}

            {/* Empresa transportista — acordeón */}
            <div className="border border-border/60 rounded-lg overflow-hidden bg-white">
              <button
                type="button"
                onClick={() => setEmpresaOpen(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50/60 transition-colors"
              >
                <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Building2 size={12} /> Empresa transportista
                </span>
                <ChevronDown size={13} className={`text-gray-400 transition-transform ${empresaOpen ? 'rotate-180' : ''}`} />
              </button>
              {empresaOpen && (
                <div className="px-3 pb-3 space-y-4 border-t border-border/60 pt-3">
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
            </div>

            {/* Bitácora — siempre visible, ya no es un acordeón independiente */}
            <div>
              <h5 className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-2">Bitácora — Observaciones y comentarios</h5>
              <div className="space-y-4">
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
            </div>
          </section>

          {/* Footer secundario — auditoría, no compite por atención */}
          {(trip.created_at || trip.id) && (
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
              {trip.created_at && <MetaField label="Ingresó al sistema" value={fmtDT(trip.created_at)} />}
              <p className="font-mono text-[9px] text-gray-300 shrink-0">{trip.id}</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd monitor-app/frontend && npm test -- TripSlideOver`
Expected: `Test Files  1 passed (1)`, 16 tests passed

- [ ] **Step 5: Correr todos los tests y verificar tipos**

Run: `cd monitor-app/frontend && npm test && npx tsc --noEmit`
Expected: todos los tests pasan, sin errores de tipo

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/components/dashboard/TripSlideOver.tsx monitor-app/frontend/components/dashboard/TripSlideOver.test.tsx
git commit -m "feat(diario): reordena el modal de detalle (Enfoque A)

Sincronización consolidada en una línea con tiempo relativo (antes 4
timestamps sueltos duplicados entre KPIs y Resumen), Ruta promovida al
primer bloque del cuerpo, separación visual clara entre Datos
operativos (solo lectura) y Gestión (editable). Indicadores solo se
muestran para viajes manuales (source_system === 'manual') — en TMS
vienen poblados por el pipeline, nunca se han editado a mano en
producción, y 'asignado' es casi constante (99.9% en qanalytics),
poco informativo. Bitácora deja de ser un acordeón independiente.
Temperatura pasa a un badge en el header, siempre visible."
```

---

### Task 3: `TripTable.tsx` — Indicadores condicionales por fuente

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/TripTable.tsx`
- Modify: `monitor-app/frontend/components/dashboard/TripTable.test.tsx`

**Interfaces:**
- Consumes: `Trip.source_system` (ya existe, ya tipado).
- Sin cambio de firma pública del componente.

- [ ] **Step 1: Actualizar los tests**

Reemplazar (líneas 24-28, la primera prueba que usa `getAllByTitle('Activo')` contra el fixture por defecto):

```tsx
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
```

por:

```tsx
describe('TripTable', () => {
  it('renders an "Indicadores" column with clickable dots for a manual trip', () => {
    render(<TripTable trips={[makeTrip('t1', { source_system: 'manual' })]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getAllByTitle('Activo').length).toBeGreaterThan(0)
  })

  it('does not render Indicadores for a TMS-sourced trip', () => {
    render(<TripTable trips={[makeTrip('t1', { source_system: 'qanalytics' })]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.queryByTitle('Activo')).not.toBeInTheDocument()
  })

  it('calls onSelect directly when a row is clicked (no intermediate expand step)', () => {
    const onSelect = vi.fn()
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={onSelect} onSaved={vi.fn()} meta={null} />)
    fireEvent.click(screen.getAllByText('ABCD12')[0])
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
  })

  it('clicking an indicator dot does not call onSelect', () => {
    const onSelect = vi.fn()
    render(<TripTable trips={[makeTrip('t1', { source_system: 'manual' })]} selectedId={null} onSelect={onSelect} onSaved={vi.fn()} meta={null} />)
    fireEvent.click(screen.getAllByTitle('Activo')[0])
    expect(onSelect).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd monitor-app/frontend && npm test -- TripTable`
Expected: FAIL — "does not render Indicadores for a TMS-sourced trip" falla (el componente hoy siempre renderiza `IndicatorDots`)

- [ ] **Step 3: Condicionar `IndicatorDots` en la fila mobile**

Reemplazar (línea 424):

```tsx
                <IndicatorDots trip={trip} onSaved={onSaved} />
```

por:

```tsx
                {trip.source_system === 'manual' && <IndicatorDots trip={trip} onSaved={onSaved} />}
```

- [ ] **Step 4: Condicionar `IndicatorDots` en la fila desktop**

Reemplazar (líneas 595-598):

```tsx
                  {/* INDICADORES */}
                  <td className="px-3 py-2.5">
                    <IndicatorDots trip={trip} onSaved={onSaved} />
                  </td>
```

por:

```tsx
                  {/* INDICADORES */}
                  <td className="px-3 py-2.5">
                    {trip.source_system === 'manual' && <IndicatorDots trip={trip} onSaved={onSaved} />}
                  </td>
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `cd monitor-app/frontend && npm test -- TripTable`
Expected: `Test Files  1 passed (1)`, 7 tests passed

- [ ] **Step 6: Correr todos los tests y verificar tipos**

Run: `cd monitor-app/frontend && npm test && npx tsc --noEmit`
Expected: todos los tests pasan, sin errores de tipo

- [ ] **Step 7: Commit**

```bash
git add monitor-app/frontend/components/dashboard/TripTable.tsx monitor-app/frontend/components/dashboard/TripTable.test.tsx
git commit -m "feat(diario): oculta Indicadores en TripTable para viajes no-manuales

Mismo criterio que TripSlideOver (Task 2) — consistencia entre el
detalle y la fila de tabla."
```

---

### Task 4: `TripCard.tsx` — Indicadores condicionales por fuente

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/TripCard.tsx`
- Modify: `monitor-app/frontend/components/dashboard/TripCard.test.tsx`

**Interfaces:**
- Consumes: `Trip.source_system` (ya existe, ya tipado).
- Sin cambio de firma pública del componente.

- [ ] **Step 1: Actualizar los tests**

Reemplazar (líneas 24-43):

```tsx
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
```

por:

```tsx
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

  it('renders Indicadores for a manual trip and clicking a dot does not call onSelect', () => {
    const onSelect = vi.fn()
    render(<TripCard trip={makeTrip({ source_system: 'manual' })} meta={null} onSaved={vi.fn()} onSelect={onSelect} />)
    fireEvent.click(screen.getAllByTitle('Activo')[0])
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('does not render Indicadores for a TMS-sourced trip', () => {
    render(<TripCard trip={makeTrip({ source_system: 'qanalytics' })} meta={null} onSaved={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.queryByTitle('Activo')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd monitor-app/frontend && npm test -- TripCard`
Expected: FAIL — "does not render Indicadores for a TMS-sourced trip" falla

- [ ] **Step 3: Condicionar `IndicatorDots`**

Reemplazar (línea 47-52):

```tsx
      <div className="flex items-center justify-between mt-1.5">
        <IndicatorDots trip={trip} onSaved={onSaved} />
        {compliance === 'warn' && (
          <span className="text-[8px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">OFF TIME</span>
        )}
      </div>
```

por:

```tsx
      <div className="flex items-center justify-between mt-1.5">
        {trip.source_system === 'manual' && <IndicatorDots trip={trip} onSaved={onSaved} />}
        {compliance === 'warn' && (
          <span className="text-[8px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">OFF TIME</span>
        )}
      </div>
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd monitor-app/frontend && npm test -- TripCard`
Expected: `Test Files  1 passed (1)`, 6 tests passed

- [ ] **Step 5: Correr todos los tests y verificar tipos**

Run: `cd monitor-app/frontend && npm test && npx tsc --noEmit`
Expected: todos los tests pasan, sin errores de tipo

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/components/dashboard/TripCard.tsx monitor-app/frontend/components/dashboard/TripCard.test.tsx
git commit -m "feat(diario): oculta Indicadores en TripCard para viajes no-manuales

Mismo criterio que TripSlideOver (Task 2) y TripTable (Task 3) —
consistencia en los 3 lugares donde se usa IndicatorDots."
```

---

### Task 5: Verificación end-to-end

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

- [ ] **Step 4: Verificar backend (sin cambios esperados, solo confirmar que nada se rompió)**

Run: `cd monitor-app/backend/api && ./venv/bin/python -m pytest tests/ -q`
Expected: `12 passed` — este plan es 100% frontend, no toca `trips.py` ni ningún router.

- [ ] **Step 5: Smoke test manual en navegador**

1. Levantar backend (`uvicorn app.main:app --port 8001` desde `monitor-app/backend/api`) y frontend (`npm run dev`, con `.env.local` apuntando al backend local).
2. Ir a `/dashboard/diario`, abrir el detalle de un viaje QAnalytics/Wingsuite/Sodimac real.
3. Confirmar: no hay fila de flags (Activo/Trab./Asig./1V) en el header. Si el viaje tiene temperatura registrada, aparece un badge junto al Estado (rojo si está fuera de rango).
4. Bajo el header, una sola línea "TMS reportó hace X · Pipeline sincronizó hace Y" — no hay tira de KPIs ni timestamps sueltos.
5. La sección "Ruta" aparece primero en el cuerpo, antes que "Datos operativos".
6. "Datos operativos" tiene fondo gris; "Gestión" tiene fondo con acento y borde izquierdo — visualmente distintos.
7. Dentro de "Gestión": NO aparece la sección "Indicadores" (viaje TMS). Bitácora está siempre visible, sin necesidad de expandir nada. Empresa transportista sigue siendo un acordeón colapsable.
8. Al final del panel, un footer chico con "Ingresó al sistema" (si existe) y el uuid del viaje.
9. Si hay un viaje creado manualmente (`source_system = 'manual'`, se puede crear uno vía "Agregar viaje" → fuente "Manual"), abrir su detalle y confirmar que ahí SÍ aparece la sección "Indicadores", editable.
10. En `TripTable` (vista Tabla) y `TripBoard` (vista Tablero), confirmar que la columna/bloque "Indicadores" no aparece para viajes TMS y sí aparece para el viaje manual de prueba.

Expected: todo lo anterior funciona sin errores de consola.

- [ ] **Step 6: Actualizar `AGENTLOG.md`**

Agregar una entrada nueva documentando: qué se implementó, referencia a `specs/2026-07-02-diario-detalle-rediseno-design.md` y este plan.

---

## Self-Review

**Cobertura de la spec:** las 4 decisiones de diseño de la spec están cubiertas — estructura general reordenada (Task 2), sincronización consolidada con `formatRelativeTime` (Task 1 + Task 2), Indicadores condicionales en los 3 componentes (Task 2, 3, 4), Bitácora reubicada sin acordeón (Task 2). El badge de temperatura (decisión tomada durante la escritura de este plan, confirmada con el usuario) está en Task 2. Adjuntos quedan explícitamente fuera de alcance, sin ninguna tarea que los toque.

**Placeholders:** ninguno — cada step tiene código completo o comandos exactos con output esperado.

**Consistencia de tipos:** `formatRelativeTime(iso: string | null | undefined): string` (Task 1) se importa y usa con esa misma firma en `TripSlideOver.tsx` (Task 2), pasándole `trip.status_reported_at`/`trip.pipeline_updated_at` (ambos `string | null` en `Trip`, compatibles). La condición `trip.source_system === 'manual'` se usa idéntica en los 3 componentes (Tasks 2, 3, 4) — mismo campo, mismo valor literal, sin variantes.

**Nota de dependencias entre tasks:** Task 2 depende de Task 1 (`formatRelativeTime`). Tasks 3 y 4 son independientes entre sí y de Task 2 (mismo patrón de condicional, pero en archivos distintos) — podrían ejecutarse en cualquier orden relativo entre ellas, aunque el orden 1→2→3→4→5 definido arriba es el más natural (de la pieza más pequeña a la más grande, terminando en los dos condicionales más simples).
