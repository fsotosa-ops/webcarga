# Detalle de viaje: página inmersiva — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el modal saturado `TripSlideOver` por una página con URL propia (`/dashboard/operations/monitor/trips/[id]`), usando Next.js intercepting routes para que se sienta como un overlay al navegar desde la tabla pero funcione como página real con back button y links compartibles.

**Architecture:** `TripDetailView` (componente puro, sin semántica de diálogo) se extrae del actual `TripSlideOver` y lo consumen dos rutas nuevas: una interceptada (`@modal/(.)trips/[id]/page.tsx`, overlay sobre la tabla) y una standalone (`trips/[id]/page.tsx`, página completa). `AccordionSection` y `GestionPanel` se extraen primero como piezas reutilizables/aisladas.

**Tech Stack:** Next.js App Router (intercepting + parallel routes), TanStack Query (fetch por id + siembra de caché), Tailwind, Vitest + Testing Library.

## Global Constraints

- El spec aprobado es `docs/superpowers/specs/2026-07-29-trip-detail-immersive-page-design.md` — toda tarea de este plan implementa una sección de ese documento.
- Fuera de alcance (decisión explícita del usuario): NO rediseñar la tabla técnica de 10 columnas de paradas; NO persistir la preferencia de colapso de Gestión entre viajes (sin localStorage).
- Cada tarea debe dejar el árbol en verde (`npx vitest run` + `npx tsc --noEmit` en `monitor-app/frontend`) antes de pasar a la siguiente.
- Único call site de `TripSlideOver` en producción: `app/dashboard/operations/monitor/page.tsx` (confirmado — el otro match de "TripSlideOver" en `app/dashboard/carriers/page.tsx` es solo un comentario, no un import real).

---

### Task 1: `AccordionSection` — componente nuevo, aislado

**Files:**
- Create: `monitor-app/frontend/components/dashboard/AccordionSection.tsx`
- Test: `monitor-app/frontend/components/dashboard/AccordionSection.test.tsx`

**Interfaces:**
- Produces: `AccordionSection({ title: ReactNode, defaultOpen?: boolean, children: ReactNode })` — sección con header clickeable (chevron + título) que muestra/oculta `children`. Usado por Task 3 para envolver "Ruta" y "Bitácora".

- [ ] **Step 1: Write the failing test**

```tsx
// monitor-app/frontend/components/dashboard/AccordionSection.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AccordionSection } from './AccordionSection'

describe('AccordionSection', () => {
  it('renders children when defaultOpen is true (or omitted)', () => {
    render(<AccordionSection title="Bitácora"><p>contenido</p></AccordionSection>)
    expect(screen.getByText('contenido')).toBeInTheDocument()
  })

  it('hides children when defaultOpen is false', () => {
    render(<AccordionSection title="Bitácora" defaultOpen={false}><p>contenido</p></AccordionSection>)
    expect(screen.queryByText('contenido')).not.toBeInTheDocument()
  })

  it('toggles visibility on header click', () => {
    render(<AccordionSection title="Bitácora"><p>contenido</p></AccordionSection>)
    fireEvent.click(screen.getByRole('button', { name: /Bitácora/ }))
    expect(screen.queryByText('contenido')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Bitácora/ }))
    expect(screen.getByText('contenido')).toBeInTheDocument()
  })

  it('exposes aria-expanded matching the current state', () => {
    render(<AccordionSection title="Bitácora"><p>contenido</p></AccordionSection>)
    const button = screen.getByRole('button', { name: /Bitácora/ })
    expect(button).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('accepts a ReactNode title (icon + dynamic text), not just a string', () => {
    render(
      <AccordionSection title={<span>Ruta (3 paradas)</span>}>
        <p>contenido</p>
      </AccordionSection>,
    )
    expect(screen.getByText('Ruta (3 paradas)')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/AccordionSection.test.tsx`
Expected: FAIL — `Cannot find module './AccordionSection'`

- [ ] **Step 3: Write the implementation**

```tsx
// monitor-app/frontend/components/dashboard/AccordionSection.tsx
'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

interface Props {
  title:       ReactNode
  defaultOpen?: boolean
  children:    ReactNode
}

export function AccordionSection({ title, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 hover:text-gray-500 transition-colors"
      >
        <ChevronDown size={12} className={`shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
        {title}
      </button>
      {open && children}
    </section>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/dashboard/AccordionSection.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd monitor-app/frontend
git add components/dashboard/AccordionSection.tsx components/dashboard/AccordionSection.test.tsx
git commit -m "feat(diario): add AccordionSection component"
```

---

### Task 2: Extraer `GestionPanel` + agregar colapso por ancho

**Files:**
- Create: `monitor-app/frontend/components/dashboard/GestionPanel.tsx`
- Modify: `monitor-app/frontend/components/dashboard/TripSlideOver.tsx:454-794` (reemplazar el `<aside>` inline por `<GestionPanel .../>`)
- Modify: `monitor-app/frontend/components/dashboard/TripSlideOver.test.tsx` (2 tests nuevos para el colapso)

**Interfaces:**
- Consumes: `Trip`, `TripsMeta` de `@/lib/types`; `tripsApi`, `TripPatch` de `@/lib/api/trips`; `driversApi` de `@/lib/api/drivers`; `IndicatorSwitches`, `FleetAssignSection`, `EMPTY_FLEET_ASSIGN_VALUE`, `FleetAssignValue` (componentes ya existentes, sin cambios); `StatusBadge`, `OperationTypeBadge`, `InsuranceAlertBadge`, `PendingDocsBadge` (componentes de UI ya existentes).
- Produces: `GestionPanel({ trip: Trip, meta?: TripsMeta | null, onSaved: (updated: Trip) => void })` — panel autocontenido (todo su estado vive adentro), colapsable por ancho en desktop, siempre expandido en mobile. Lo consume Task 3 (`TripDetailView`).

Este panel es TODO el contenido que hoy vive en el `<aside>` de `TripSlideOver.tsx` (líneas 454-794) — ninguna otra parte del componente depende de ese estado (verificado: `estadoDraft`, `saving`, `showEstadoSelect`, `clearingOverride`, `reasonSaving`, `unlinkErr`, `unlinking`, `fleetDraft`, `assigningFleet`, `fleetErr`, `fuzzyMatchQuery`, `driverDiverges`, `tractorDiverges`, `carrierDiverges`, `hasReconciliationDivergence`, `empresasHandoffHref` solo se usan dentro de ese `<aside>`).

- [ ] **Step 1: Write the failing tests (colapso — comportamiento nuevo)**

Agregar a `monitor-app/frontend/components/dashboard/TripSlideOver.test.tsx`, dentro de un nuevo `describe` después del de "indicadores":

```tsx
describe('TripSlideOver — Gestión colapsable (página inmersiva, 2026-07-29)', () => {
  it('shows a collapse toggle button for the Gestión panel', () => {
    renderSlideOver(baseTrip)
    expect(screen.getByTitle('Colapsar Gestión')).toBeInTheDocument()
  })

  it('collapsing Gestión hides its content and shows an expand toggle instead', () => {
    renderSlideOver(baseTrip)
    fireEvent.click(screen.getByTitle('Colapsar Gestión'))
    expect(screen.queryByText('+ Establecer estado operativo manual')).not.toBeInTheDocument()
    expect(screen.getByTitle('Expandir Gestión')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/dashboard/TripSlideOver.test.tsx -t "Gestión colapsable"`
Expected: FAIL — `Unable to find an element with the title: Colapsar Gestión` (el `<aside>` actual no tiene ningún botón de colapso)

- [ ] **Step 3: Crear `GestionPanel.tsx`**

Crear el archivo con esta estructura exacta. El bloque marcado `{/* CONTENIDO */}` es un copy-paste **literal, sin ningún cambio**, de `TripSlideOver.tsx` líneas 459-793 (desde el primer `{/* Estado operativo */}` hasta el cierre del último `<div>` de "Datos operativos", es decir todo lo que hoy está DENTRO de `<aside>...</aside>` menos el propio `<h4>Gestión</h4>` de la línea 455-457, que se reposiciona como se muestra abajo):

```tsx
// monitor-app/frontend/components/dashboard/GestionPanel.tsx
'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Loader2, Check, RotateCcw, ClipboardList, ShieldAlert, Search,
  FileWarning, AlertTriangle, User, MapPin, ChevronLeft, ChevronRight,
} from 'lucide-react'
import type { Trip, TripsMeta } from '@/lib/types'
import { tripsApi, type TripPatch } from '@/lib/api/trips'
import { driversApi } from '@/lib/api/drivers'
import { fmtDT, fmtDate } from '@/lib/utils/datetime'
import { IndicatorSwitches } from './IndicatorSwitches'
import { FleetAssignSection, EMPTY_FLEET_ASSIGN_VALUE, type FleetAssignValue } from './FleetAssignSection'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { OperationTypeBadge } from '@/components/ui/OperationTypeBadge'
import { InsuranceAlertBadge } from '@/components/ui/InsuranceAlertBadge'
import { PendingDocsBadge } from '@/components/ui/PendingDocsBadge'

// Movido de TripSlideOver.tsx — único consumidor.
function MetaField({
  label, value, highlight = false,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div>
      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className={`text-xs leading-snug ${highlight ? 'font-semibold text-accent' : 'text-slate-700'}`}>
        {value}
      </p>
    </div>
  )
}

interface Props {
  trip:    Trip
  meta?:   TripsMeta | null
  onSaved: (updated: Trip) => void
}

export function GestionPanel({ trip, meta, onSaved }: Props) {
  const [collapsed, setCollapsed]               = useState(false)
  const [estadoDraft, setEstadoDraft]           = useState('')
  const [saving, setSaving]                     = useState(false)
  const [err, setErr]                           = useState<string | null>(null)
  const [showEstadoSelect, setShowEstadoSelect] = useState(false)
  const [clearingOverride, setClearingOverride] = useState(false)
  const [reasonSaving, setReasonSaving]         = useState(false)
  const [unlinkErr, setUnlinkErr]               = useState<string | null>(null)
  const [unlinking, setUnlinking]               = useState(false)
  const [fleetDraft, setFleetDraft]             = useState<FleetAssignValue>(EMPTY_FLEET_ASSIGN_VALUE)
  const [assigningFleet, setAssigningFleet]     = useState(false)
  const [fleetErr, setFleetErr]                 = useState<string | null>(null)

  const fuzzyMatchQuery = useQuery({
    queryKey: ['drivers', 'fuzzy-match', trip.id, trip.driver_name_tms],
    queryFn: () => driversApi.fuzzyMatch(trip.driver_name_tms!),
    enabled: !trip.carrier_id && !!trip.driver_name_tms,
  })

  // Mismo criterio que TripSlideOver.tsx líneas 129-138: resetear drafts
  // (no `collapsed`, ver abajo) cuando cambia el viaje, no en cada render.
  useEffect(() => {
    setEstadoDraft('')
    setErr(null)
    setShowEstadoSelect(false)
    setUnlinkErr(null)
    setFleetDraft(EMPTY_FLEET_ASSIGN_VALUE)
    setFleetErr(null)
  }, [trip.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // `collapsed` también resetea a expandido en cada viaje nuevo — decisión
  // explícita (brainstorming 2026-07-29): "expandido por defecto con botón
  // para colapsar", sin persistencia entre viajes (sin localStorage).
  useEffect(() => { setCollapsed(false) }, [trip.id])

  async function handleSetOverride() {
    if (!estadoDraft) return
    setSaving(true)
    setErr(null)
    try {
      const updated = await tripsApi.patch(trip.id, { manual_status: estadoDraft } as TripPatch)
      onSaved(updated)
      setShowEstadoSelect(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleClearOverride() {
    setClearingOverride(true)
    try {
      await tripsApi.resetField(trip.id, 'manual_status')
      onSaved({ ...trip, manual_status: null })
      setEstadoDraft('')
      setShowEstadoSelect(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al revertir')
    } finally {
      setClearingOverride(false)
    }
  }

  async function handleUnlink() {
    setUnlinking(true); setUnlinkErr(null)
    try {
      await tripsApi.removeFleetLink(trip.id)
      onSaved({ ...trip, carrier_id: null, fleet_link_id: null })
      setFleetDraft(EMPTY_FLEET_ASSIGN_VALUE)
    } catch (e) {
      setUnlinkErr(e instanceof Error ? e.message : 'Error al desvincular')
    } finally {
      setUnlinking(false)
    }
  }

  async function handleAssignFleet() {
    if (!fleetDraft.carrier_id) return
    setAssigningFleet(true); setFleetErr(null)
    try {
      const updated = await tripsApi.assignFleetLink(trip.id, {
        carrier_id:       fleetDraft.carrier_id,
        driver_id:        fleetDraft.driver_id ?? undefined,
        tractor_asset_id: fleetDraft.tractor_asset_id ?? undefined,
        driver_name:      fleetDraft.driver_name ?? undefined,
        tractor_plate:    fleetDraft.tractor_plate ?? undefined,
      })
      onSaved(updated)
      setFleetDraft(EMPTY_FLEET_ASSIGN_VALUE)
    } catch (e) {
      setFleetErr(e instanceof Error ? e.message : 'Error al vincular')
    } finally {
      setAssigningFleet(false)
    }
  }

  const driverDiverges  = !!(trip.driver_name_tms && trip.driver_name_tms !== trip.driver_name)
  const tractorDiverges = !!(trip.tractor_plate_tms && trip.tractor_plate_tms !== trip.tractor_plate)
  const carrierDiverges = !!(trip.carrier_name_tms && trip.carrier_name_tms !== trip.carrier_name)
  const hasReconciliationDivergence = !!trip.fleet_link_id && (driverDiverges || tractorDiverges || carrierDiverges)

  const empresasHandoffHref = (() => {
    const params = new URLSearchParams({ create: '1' })
    if (trip.carrier_name_tms)  params.set('business_name', trip.carrier_name_tms)
    if (trip.driver_name_tms)   params.set('driver_name', trip.driver_name_tms)
    const plateTms = trip.tractor_plate_tms ?? trip.tractor_plate
    if (plateTms) params.set('tractor_plate', plateTms)
    return `/dashboard/carriers?${params.toString()}`
  })()

  return (
    <aside
      className={`order-1 md:order-2 shrink-0 md:overflow-y-auto md:border-l border-border bg-accent/[0.03] transition-[width] duration-200 ease-out ${collapsed ? 'md:w-[56px]' : 'md:w-[360px]'}`}
    >
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? 'Expandir Gestión' : 'Colapsar Gestión'}
        className="hidden md:flex items-center justify-center w-full h-10 text-accent hover:bg-accent/10 transition-colors"
      >
        {collapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </button>

      <div className={`hidden flex-col items-center gap-3 pt-2 ${collapsed ? 'md:flex' : 'md:hidden'}`}>
        <ClipboardList size={14} className="text-accent" />
      </div>

      <div className={`p-4 md:p-5 space-y-5 ${collapsed ? 'md:hidden' : ''}`}>
        <h4 className="text-[10px] font-bold text-accent uppercase tracking-widest flex items-center gap-1.5">
          <ClipboardList size={11} /> Gestión
        </h4>

        {/* Estado operativo */}
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="text-[9px] text-gray-400">TMS reporta:</span>
            <StatusBadge status={trip.current_status} meta={meta} />
          </div>

          {trip.manual_status ? (
            <div className="flex items-center gap-2 flex-wrap">
              {(() => {
                const opState = meta?.operational_states.find(s => s.id === trip.manual_status)
                const label = opState?.label ?? trip.manual_status
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
                value={estadoDraft}
                onChange={e => setEstadoDraft(e.target.value)}
                className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                <option value="">— Seleccionar estado…</option>
                {(meta?.operational_states ?? []).map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
              <button type="button" onClick={handleSetOverride} disabled={saving || !estadoDraft}
                className="p-1.5 text-accent disabled:opacity-40">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              </button>
              <button type="button" onClick={() => { setShowEstadoSelect(false); setEstadoDraft('') }}
                className="text-[10px] text-gray-400 hover:text-gray-600">
                Cancelar
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowEstadoSelect(true)}
                className="text-xs text-accent hover:text-accent/80 transition-colors"
              >
                + Establecer estado operativo manual
              </button>
              <p className="text-[9px] text-gray-400 mt-1">
                Es el mismo estado que se muestra en el encabezado — acá podés confirmarlo manualmente si hace falta.
              </p>
            </>
          )}

          {err && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-2">{err}</p>
          )}
        </div>

        {/* Indicadores — switches con etiqueta completa */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Indicadores</p>
          <IndicatorSwitches trip={trip} onSaved={onSaved} />
        </div>

        {/* Motivo de no asignación */}
        {!trip.is_assigned && (meta?.unassigned_reasons?.length ?? 0) > 0 && (
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Motivo de no asignación</p>
            <select
              value={trip.unassigned_reason_id ?? ''}
              disabled={reasonSaving}
              onChange={async e => {
                const value = e.target.value
                setReasonSaving(true)
                try {
                  const updated = await tripsApi.patch(trip.id, { unassigned_reason_id: value } as TripPatch)
                  onSaved(updated)
                } catch {
                  // best-effort — el select vuelve al valor real del trip en el próximo render
                } finally {
                  setReasonSaving(false)
                }
              }}
              className="w-full text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
            >
              <option value="">— Sin especificar —</option>
              {meta!.unassigned_reasons.map(r => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Conductor y flota — driver-first */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1">
            <User size={10} /> Conductor y flota
          </p>
          {trip.carrier_id ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2.5 border border-border/80 shadow-sm">
                <div className="min-w-0 flex items-center gap-2 flex-wrap">
                  <p className="text-xs font-semibold text-slate-800 truncate">{trip.carrier_name ?? '—'}</p>
                  <InsuranceAlertBadge alert={trip.insurance_alert} />
                  <PendingDocsBadge count={trip.carrier_pending_docs} critical={trip.carrier_pending_docs_critical} label="Empresa" />
                  <PendingDocsBadge count={trip.driver_pending_docs} critical={trip.driver_pending_docs_critical} label="Conductor" />
                  <PendingDocsBadge count={trip.tractor_pending_docs} critical={trip.tractor_pending_docs_critical} label="Tracto" />
                </div>
                <button
                  type="button"
                  disabled={unlinking}
                  onClick={handleUnlink}
                  className="text-[11px] text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50 shrink-0 ml-2"
                >
                  {unlinking ? <Loader2 size={12} className="animate-spin" /> : 'Desvincular'}
                </button>
              </div>
              {unlinkErr && <p className="text-xs text-red-500 mt-1">{unlinkErr}</p>}
              {(trip.insurance_alert === 'EXPIRED' || trip.insurance_alert === 'OVERDUE_INSTALLMENTS') && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
                  <ShieldAlert size={13} className="text-red-600 shrink-0" />
                  <p className="text-[11px] text-red-700 font-medium">
                    {trip.insurance_alert === 'EXPIRED' ? 'Póliza vencida para esta empresa — ' : 'Cuotas críticas impagas para esta empresa — '}
                    <a href={`/dashboard/carriers/${trip.carrier_id}?tab=seguros`} className="underline hover:text-red-900">
                      revisar en Seguros
                    </a>.
                  </p>
                </div>
              )}
              {trip.driver_pending_docs_critical && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
                  <FileWarning size={13} className="text-red-600 shrink-0" />
                  <p className="text-[11px] text-red-700 font-medium">
                    Falta Licencia de Conducir o Carnet del conductor —{' '}
                    <a href={`/dashboard/carriers/${trip.carrier_id}?tab=conductores`} className="underline hover:text-red-900">
                      revisar en Empresas
                    </a>.
                  </p>
                </div>
              )}
              {trip.fleet_match_status === 'MISMATCH' && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1">
                  <p className="text-[10px] text-amber-700">
                    El conductor pertenece a <span className="font-semibold">{trip.fleet_match_driver_home_carrier}</span>, distinta de la empresa de este viaje —{' '}
                    <a href={`/dashboard/carriers/${trip.carrier_id}?tab=conductores`} className="underline hover:text-amber-900">
                      revisar en Empresas
                    </a>.
                  </p>
                </div>
              )}
              {hasReconciliationDivergence && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1">
                  {carrierDiverges && (
                    <p className="text-[10px] text-amber-700">
                      TMS reporta empresa: <span className="font-semibold">{trip.carrier_name_tms}</span>
                    </p>
                  )}
                  {driverDiverges && (
                    <p className="text-[10px] text-amber-700">
                      TMS reporta conductor: <span className="font-semibold">{trip.driver_name_tms}</span>
                    </p>
                  )}
                  {tractorDiverges && (
                    <p className="text-[10px] text-amber-700">
                      TMS reporta patente: <span className="font-semibold">{trip.tractor_plate_tms}</span>
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={unlinking}
                    onClick={handleUnlink}
                    className="text-[10px] font-semibold text-amber-700 hover:text-amber-900 underline disabled:opacity-50"
                  >
                    {unlinking ? 'Revirtiendo…' : 'Usar dato del TMS'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {trip.fleet_match_status === 'UNMATCHED' && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
                  <AlertTriangle size={13} className="text-amber-600 shrink-0" />
                  <p className="text-[11px] text-amber-700 font-medium">Sin identificar — sin cruce contra ninguna empresa todavía.</p>
                </div>
              )}
              {trip.driver_name_tms && (
                <p className="text-[10px] text-gray-400">
                  TMS reportó: <span className="font-semibold text-slate-600">{trip.driver_name_tms}</span>
                </p>
              )}
              <FleetAssignSection
                value={fleetDraft}
                onChange={setFleetDraft}
                size="sm"
                suggested={fuzzyMatchQuery.data ?? []}
                suggestedLabel="Posibles coincidencias (nombre TMS)"
                notFoundHint={
                  <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-2">
                    Si no aparece en la lista, hay que darlo de alta primero en{' '}
                    <a href={empresasHandoffHref} className="underline font-semibold">Empresas</a>.
                  </p>
                }
              />
              {trip.driver_name_tms && !fuzzyMatchQuery.isLoading && (fuzzyMatchQuery.data?.length ?? 0) === 0 && (
                <a
                  href={empresasHandoffHref}
                  className="flex items-center gap-1.5 text-[11px] font-semibold text-accent hover:underline"
                >
                  <Search size={11} /> Sin coincidencias — dar de alta empresa/conductor/equipo
                </a>
              )}
              {fleetDraft.driver_id && (
                <button
                  type="button"
                  disabled={assigningFleet || !fleetDraft.carrier_id}
                  onClick={handleAssignFleet}
                  className="w-full text-xs font-semibold bg-accent text-white rounded-lg py-1.5 hover:bg-accent/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {assigningFleet ? <Loader2 size={12} className="animate-spin" /> : 'Vincular'}
                </button>
              )}
              {fleetErr && <p className="text-[11px] text-red-500">{fleetErr}</p>}
            </div>
          )}
        </div>

        {/* Ubicación de origen — solo operation_type */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <MapPin size={10} /> Ubicación de origen
          </p>
          {trip.origin_operation_type ? (
            <OperationTypeBadge operationType={trip.origin_operation_type} meta={meta} size="md" />
          ) : (
            <span className="text-[11px] text-gray-400">Sin clasificar</span>
          )}
        </div>

        {/* Datos operativos */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Datos operativos</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            <MetaField label="Fecha planificación" value={fmtDate(trip.planning_date)} />
            <MetaField label="Tipo carga" value={trip.cargo_type ?? '—'} />
            {trip.milestone_status && (
              <MetaField label="Estado cumplimiento" value={trip.milestone_status} highlight />
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: Reemplazar el `<aside>` inline en `TripSlideOver.tsx` por `<GestionPanel>`**

En `TripSlideOver.tsx`, agregar el import:

```tsx
import { GestionPanel } from './GestionPanel'
```

Reemplazar el bloque completo `<aside className="order-1 md:order-2 md:w-[360px] ...">` ... `</aside>` (líneas 454-794) por:

```tsx
<GestionPanel trip={trip} meta={meta} onSaved={onSaved} />
```

Borrar de `TripSlideOver.tsx` todo el estado/handlers/imports que ahora solo usa `GestionPanel` y ya no se referencian en `TripSlideOver.tsx`: `estadoDraft/setEstadoDraft`, `saving/setSaving`, `err/setErr` (ojo: revisar si `err` se usaba en otro lado — no, solo en el `<aside>`), `showEstadoSelect/setShowEstadoSelect`, `clearingOverride/setClearingOverride`, `reasonSaving/setReasonSaving`, `unlinkErr/setUnlinkErr`, `unlinking/setUnlinking`, `fleetDraft/setFleetDraft`, `assigningFleet/setAssigningFleet`, `fleetErr/setFleetErr`, `fuzzyMatchQuery`, `handleSetOverride`, `handleClearOverride`, `handleUnlink`, `handleAssignFleet`, `driverDiverges`, `tractorDiverges`, `carrierDiverges`, `hasReconciliationDivergence`, `empresasHandoffHref`, y los imports que quedan sin uso (`RotateCcw, ClipboardList, ShieldAlert, Search, FileWarning, AlertTriangle` de `lucide-react`; `driversApi`; `FleetAssignSection, EMPTY_FLEET_ASSIGN_VALUE, FleetAssignValue`; `IndicatorSwitches`; `InsuranceAlertBadge, PendingDocsBadge`; la función `MetaField` completa, ya movida a `GestionPanel.tsx`).

- [ ] **Step 5: Run full test suite to verify no regression + new tests pass**

Run: `npx vitest run components/dashboard/TripSlideOver.test.tsx`
Expected: PASS — todos los tests existentes (incluidos los ~30 que cubren Conductor y flota, override de estado, indicadores, motivo de no asignación) siguen en verde porque `GestionPanel` reproduce el comportamiento exacto, más los 2 tests nuevos de colapso.

Run: `npx tsc --noEmit`
Expected: sin errores (confirma que no quedó ningún import/variable sin usar en `TripSlideOver.tsx`)

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/GestionPanel.tsx components/dashboard/TripSlideOver.tsx components/dashboard/TripSlideOver.test.tsx
git commit -m "refactor(diario): extract GestionPanel, add width-collapse toggle"
```

---

### Task 3: Extraer `TripDetailView` — componente de contenido puro

**Files:**
- Create: `monitor-app/frontend/components/dashboard/TripDetailView.tsx`
- Create: `monitor-app/frontend/components/dashboard/TripDetailView.test.tsx`
- Modify: `monitor-app/frontend/components/dashboard/TripSlideOver.tsx` (queda como wrapper fino)

**Interfaces:**
- Consumes: `AccordionSection` (Task 1), `GestionPanel` (Task 2), `StopTimeline`, `TripNotesFeed`, `StatusBadge`, `OperationTypeBadge` (existentes), `useTripNotes` hook (existente).
- Produces: `TripDetailView({ trip: Trip, onDismiss: () => void, onSaved: (updated: Trip) => void, meta?: TripsMeta | null, focusNotes?: boolean })` — sin `role="dialog"`, sin trampa de foco, sin manejo de Escape (eso vive en cada wrapper de ruta, Tasks 4 y 5). `trip` ya no acepta `null` — quien lo use debe resolver loading/error antes de renderizarlo.

**Diferencia con `TripSlideOver` de hoy**: no incluye los divs de backdrop (`fixed inset-0 bg-black/50`) ni panel flotante (`fixed inset-0 md:inset-4 md:rounded-2xl`) — el root es un simple `<div className="flex flex-col h-full bg-white overflow-hidden">`. El botón de cerrar llama `onDismiss` en vez de `onClose`.

- [ ] **Step 1: Crear `TripDetailView.tsx`**

```tsx
// monitor-app/frontend/components/dashboard/TripDetailView.tsx
'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Copy, Check, Truck, User, Phone, Hash, MapPin } from 'lucide-react'
import type { Trip, TripsMeta } from '@/lib/types'
import { tripsApi } from '@/lib/api/trips'
import { getLatestTemp, stopWasVisited, classifyTemperature, getActiveStop, describeStopTiming } from '@/lib/utils/temperature'
import { stopComplianceSummary } from '@/lib/utils/compliance'
import { fmtDT, formatRelativeTime, toDatetimeLocalValue } from '@/lib/utils/datetime'
import { TMS_LOGIN_URLS } from '@/lib/utils/tmsLinks'
import { StopTimeline } from './StopTimeline'
import { TripNotesFeed } from './TripNotesFeed'
import { useTripNotes } from '@/hooks/useTripNotes'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { OperationTypeBadge } from '@/components/ui/OperationTypeBadge'
import { AccordionSection } from './AccordionSection'
import { GestionPanel } from './GestionPanel'

interface Props {
  trip:        Trip
  onDismiss:   () => void
  onSaved:     (updated: Trip) => void
  meta?:       TripsMeta | null
  focusNotes?: boolean
}

export function TripDetailView({ trip, onDismiss, onSaved, meta, focusNotes = false }: Props) {
  const notesRef                    = useRef<HTMLElement>(null)
  const [stopSaving, setStopSaving] = useState<string | null>(null)
  const [copiedField, setCopiedField] = useState<'external' | 'internal' | null>(null)
  const notesQuery = useTripNotes(trip.id)

  useEffect(() => {
    if (!focusNotes) return
    notesRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [trip.id, focusNotes])

  async function handleStopFieldChange(
    stopId: string,
    field: 'desc_inicio' | 'desc_fin' | 'arrival' | 'departure' | 'gps_arrival' | 'gps_departure',
    value: string,
  ) {
    setStopSaving(stopId)
    try {
      const updated = await tripsApi.patchStop(trip.id, stopId, { [field]: value })
      onSaved(updated)
    } catch {
      // best-effort — la próxima edición reintenta; sin bloquear la tabla con un error persistente
    } finally {
      setStopSaving(null)
    }
  }

  function handleCopy(field: 'external' | 'internal', value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    })
  }

  const currentStatus = trip.manual_status ?? trip.current_status
  const tmsMeta       = trip.source_system ? meta?.tms_sources.find(t => t.id === trip.source_system.toLowerCase()) : null
  const tmsLabel      = tmsMeta?.label ?? trip.source_system?.toUpperCase().slice(0, 3) ?? '?'
  const tmsLoginUrl   = trip.source_system && trip.source_system !== 'manual' ? TMS_LOGIN_URLS[trip.source_system.toLowerCase()] : undefined
  const temp          = getLatestTemp(trip.stops ?? [])
  const tempStatus    = classifyTemperature(temp, trip.cargo_type, meta?.temperature_ranges ?? [])

  const stops            = trip.stops ?? []
  const destinationStops = stops.filter(s => s.stop_type !== 'ORIGIN')
  const openIncidents    = (notesQuery.data ?? []).filter(n => n.note_type === 'incidente' && !n.resolved_at).length
  const activeStop  = getActiveStop(stops)
  const activeTiming = activeStop ? describeStopTiming(activeStop) : null
  const doneCount   = destinationStops.filter(s => s.arrival_date || s.gps_arrival_date || s.on_time_status).length
  const compliance  = stopComplianceSummary(stops)
  const tmsSince    = formatRelativeTime(trip.status_reported_at)
  const syncSince   = formatRelativeTime(trip.pipeline_updated_at)

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* ── Header — 1 fila compacta: identidad del viaje ── */}
      <div className="bg-slate-900 px-4 py-2.5 md:px-6 shrink-0 flex items-center gap-3 flex-wrap">
        {tmsLoginUrl ? (
          <a
            href={tmsLoginUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={`Abrir en ${tmsMeta?.label ?? tmsLabel}`}
            className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 hover:opacity-80 transition-opacity"
            style={tmsMeta
              ? { backgroundColor: tmsMeta.bg_color, color: tmsMeta.text_color }
              : { backgroundColor: '#334155', color: '#94a3b8' }}
          >
            {tmsLabel}
          </a>
        ) : (
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
            style={tmsMeta
              ? { backgroundColor: tmsMeta.bg_color, color: tmsMeta.text_color }
              : { backgroundColor: '#334155', color: '#94a3b8' }}
          >
            {tmsLabel}
          </span>
        )}

        {trip.source_system_trip_id && (
          <span className="flex items-center gap-1.5 min-w-0">
            <Hash size={11} className="text-white/40 shrink-0" />
            <span className="font-mono text-xs text-white/60 truncate">{trip.source_system_trip_id}</span>
            <button
              type="button"
              onClick={() => handleCopy('external', trip.source_system_trip_id!)}
              title="Copiar ID externo"
              className="text-white/40 hover:text-white/80 transition-colors shrink-0"
            >
              {copiedField === 'external' ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            </button>
          </span>
        )}
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="font-mono text-[10px] text-white/30 truncate">{trip.id}</span>
          <button
            type="button"
            onClick={() => handleCopy('internal', trip.id)}
            title="Copiar ID interno"
            className="text-white/40 hover:text-white/80 transition-colors shrink-0"
          >
            {copiedField === 'internal' ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
          </button>
        </span>

        <span className="flex items-center gap-1.5 shrink-0">
          <Truck size={13} className="text-white/40" />
          <span className="font-mono text-sm font-bold text-white">
            {trip.tractor_plate ?? trip.trailer_plate ?? 'Sin patente'}
          </span>
          {trip.tractor_plate && trip.trailer_plate && (
            <span className="font-mono text-[11px] text-white/40">/ {trip.trailer_plate}</span>
          )}
        </span>

        <span className="flex items-center gap-1.5 min-w-0">
          <User size={11} className="text-white/40 shrink-0" />
          <span className="text-xs text-white/80 truncate">{trip.driver_name ?? '—'}</span>
        </span>

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
          <span className="text-[11px] text-white/35 truncate hidden sm:inline">· {trip.client_name}</span>
        )}

        <button
          onClick={onDismiss}
          className="text-white/50 hover:text-white transition-colors shrink-0 p-1 rounded-lg hover:bg-white/10 ml-auto"
          aria-label="Cerrar detalle"
        >
          <X size={18} />
        </button>
      </div>

      {/* ── Hero — la historia del viaje ── */}
      <div data-testid="hero" className="px-4 py-3 md:px-6 border-b border-border bg-gray-50/80 shrink-0 space-y-2">
        <div className="flex items-center gap-2.5 flex-wrap">
          <StatusBadge status={currentStatus} meta={meta} size="md" fallbackLabel="Sin estado" />
          {trip.manual_status && (
            <span className="text-[9px] font-semibold text-accent bg-accent/10 px-1.5 py-0.5 rounded-full">manual</span>
          )}
          {activeStop && (
            <span className="text-sm text-slate-700 min-w-0">
              <span className="text-gray-400">→</span>{' '}
              <span className="font-semibold">{activeStop.local ?? activeStop.destination_city ?? 'próxima parada'}</span>
              {activeTiming && <span className="text-gray-500"> · {activeTiming}</span>}
            </span>
          )}
          {!activeStop && stops.length === 0 && (
            <span className="text-sm text-gray-400">Sin paradas registradas</span>
          )}
        </div>

        <div className="flex items-center gap-2.5 flex-wrap text-[11px] text-gray-500">
          {destinationStops.length > 0 && (
            <span>{doneCount}/{destinationStops.length} paradas</span>
          )}
          {compliance === 'warn' && (
            <span className="font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full text-[10px]">OFF TIME</span>
          )}
          {openIncidents > 0 && (
            <span className="font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full text-[10px]">
              {openIncidents} incidente{openIncidents === 1 ? '' : 's'} abierto{openIncidents === 1 ? '' : 's'}
            </span>
          )}
          {temp != null && (
            tempStatus === 'out_of_range'
              ? <span className="font-semibold px-1.5 py-0.5 rounded-full text-[10px] bg-red-50 text-red-700">{temp}°C</span>
              : <span>{temp}°C</span>
          )}
          <span className="text-gray-400">
            TMS reportó {tmsSince}{syncSince !== '—' ? ` · sync ${syncSince}` : ''}
          </span>
          {trip.created_at && (
            <span className="text-gray-400">· en el Diario desde {fmtDT(trip.created_at)}</span>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
        <GestionPanel trip={trip} meta={meta} onSaved={onSaved} />

        <div className="order-2 md:order-1 flex-1 min-w-0 md:overflow-y-auto p-4 md:p-6 space-y-5">
          {stops.length > 0 && (
            <AccordionSection
              title={<><MapPin size={11} /> Ruta ({stops.length} parada{stops.length === 1 ? '' : 's'})</>}
              defaultOpen
            >
              <StopTimeline stops={stops} />

              <div className="overflow-x-auto mt-3 -mx-4 md:-mx-6">
                <div className="min-w-[860px] px-4 md:px-6">
                  <table className="w-full text-xs border border-border/80 rounded-lg overflow-hidden">
                    <thead>
                      <tr className="bg-slate-800 text-[9px] font-bold text-slate-300 uppercase tracking-wide">
                        <th className="px-3 py-2 text-left sticky left-0 bg-slate-800 z-10 min-w-[120px]">Local</th>
                        <th className="px-3 py-2 text-left min-w-[82px]">Plan.</th>
                        <th className="px-3 py-2 text-left min-w-[82px]">GPS Llegada</th>
                        <th className="px-3 py-2 text-left min-w-[82px]">GPS Salida</th>
                        <th className="px-3 py-2 text-left min-w-[82px]">Llegada TR</th>
                        <th className="px-3 py-2 text-left min-w-[82px]">Salida TR</th>
                        <th className="px-3 py-2 text-left min-w-[82px]">Desc. inicio</th>
                        <th className="px-3 py-2 text-left min-w-[82px]">Desc. fin</th>
                        <th className="px-3 py-2 text-center min-w-[52px]">S2S</th>
                        <th className="px-3 py-2 text-center min-w-[52px]">°C</th>
                        <th className="px-3 py-2 text-center min-w-[68px]">On Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {stops.map((stop, i) => {
                        const isOrigin = stop.stop_type === 'ORIGIN'
                        const rowBg =
                          isOrigin ? 'bg-slate-50' :
                          stop.on_time_status === 'ON TIME'  ? 'bg-green-50/40' :
                          stop.on_time_status === 'OFF TIME' ? 'bg-amber-50/40' :
                          i % 2 === 1 ? 'bg-gray-50/40' : 'bg-white'
                        const opLabel = isOrigin ? 'Carga' : 'Desc.'
                        return (
                          <tr key={stop.stop_id ?? i} className={rowBg}>
                            <td className={`px-3 py-2 sticky left-0 z-10 ${rowBg}`}>
                              <p className="font-medium text-slate-700 leading-snug flex items-center gap-1">
                                {isOrigin && (
                                  <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-slate-700 text-white shrink-0">ORIGEN</span>
                                )}
                                {stop.local ?? '—'}
                                <OperationTypeBadge operationType={stop.operation_type} meta={meta} />
                              </p>
                              {stop.destination_city && (
                                <p className="text-[9px] text-gray-400 mt-0.5">
                                  {stop.destination_city}{stop.destination_region ? `, ${stop.destination_region}` : ''}
                                </p>
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.planning_date)}</td>
                            {isOrigin ? (
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.gps_arrival_date)}</td>
                            ) : (
                              <td className="px-2 py-1">
                                <div className="relative">
                                  <input
                                    key={`${stop.stop_id}-gps_arrival-${stop.gps_arrival_date ?? ''}`}
                                    type="datetime-local"
                                    aria-label={`GPS Llegada de ${stop.local ?? 'parada'}`}
                                    defaultValue={toDatetimeLocalValue(stop.gps_arrival_date)}
                                    onBlur={e => e.target.value && stop.stop_id && handleStopFieldChange(stop.stop_id, 'gps_arrival', e.target.value)}
                                    disabled={stopSaving === stop.stop_id}
                                    className={`peer w-full text-[10px] font-mono border rounded px-1 py-0.5 text-transparent focus:text-inherit focus:outline-none focus:ring-1 focus:ring-accent/30 bg-white disabled:opacity-50 ${stop.gps_arrival_manual ? 'border-accent/40 text-accent' : 'border-border text-gray-500'}`}
                                  />
                                  <span className="absolute inset-0 flex items-center px-1 text-[10px] font-mono pointer-events-none peer-focus:opacity-0 truncate">{fmtDT(stop.gps_arrival_date)}</span>
                                </div>
                              </td>
                            )}
                            {isOrigin ? (
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.gps_departure_date)}</td>
                            ) : (
                              <td className="px-2 py-1">
                                <div className="relative">
                                  <input
                                    key={`${stop.stop_id}-gps_departure-${stop.gps_departure_date ?? ''}`}
                                    type="datetime-local"
                                    aria-label={`GPS Salida de ${stop.local ?? 'parada'}`}
                                    defaultValue={toDatetimeLocalValue(stop.gps_departure_date)}
                                    onBlur={e => e.target.value && stop.stop_id && handleStopFieldChange(stop.stop_id, 'gps_departure', e.target.value)}
                                    disabled={stopSaving === stop.stop_id}
                                    className={`peer w-full text-[10px] font-mono border rounded px-1 py-0.5 text-transparent focus:text-inherit focus:outline-none focus:ring-1 focus:ring-accent/30 bg-white disabled:opacity-50 ${stop.gps_departure_manual ? 'border-accent/40 text-accent' : 'border-border text-gray-500'}`}
                                  />
                                  <span className="absolute inset-0 flex items-center px-1 text-[10px] font-mono pointer-events-none peer-focus:opacity-0 truncate">{fmtDT(stop.gps_departure_date)}</span>
                                </div>
                              </td>
                            )}
                            {isOrigin ? (
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.arrival_date)}</td>
                            ) : (
                              <td className="px-2 py-1">
                                <div className="relative">
                                  <input
                                    key={`${stop.stop_id}-arrival-${stop.arrival_date ?? ''}`}
                                    type="datetime-local"
                                    aria-label={`Llegada TR de ${stop.local ?? 'parada'}`}
                                    defaultValue={toDatetimeLocalValue(stop.arrival_date)}
                                    onBlur={e => e.target.value && stop.stop_id && handleStopFieldChange(stop.stop_id, 'arrival', e.target.value)}
                                    disabled={stopSaving === stop.stop_id}
                                    className={`peer w-full text-[10px] font-mono border rounded px-1 py-0.5 text-transparent focus:text-inherit focus:outline-none focus:ring-1 focus:ring-accent/30 bg-white disabled:opacity-50 ${stop.arrival_manual ? 'border-accent/40 text-accent' : 'border-border text-gray-500'}`}
                                  />
                                  <span className="absolute inset-0 flex items-center px-1 text-[10px] font-mono pointer-events-none peer-focus:opacity-0 truncate">{fmtDT(stop.arrival_date)}</span>
                                </div>
                              </td>
                            )}
                            {isOrigin ? (
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.departure_date)}</td>
                            ) : (
                              <td className="px-2 py-1">
                                <div className="relative">
                                  <input
                                    key={`${stop.stop_id}-departure-${stop.departure_date ?? ''}`}
                                    type="datetime-local"
                                    aria-label={`Salida TR de ${stop.local ?? 'parada'}`}
                                    defaultValue={toDatetimeLocalValue(stop.departure_date)}
                                    onBlur={e => e.target.value && stop.stop_id && handleStopFieldChange(stop.stop_id, 'departure', e.target.value)}
                                    disabled={stopSaving === stop.stop_id}
                                    className={`peer w-full text-[10px] font-mono border rounded px-1 py-0.5 text-transparent focus:text-inherit focus:outline-none focus:ring-1 focus:ring-accent/30 bg-white disabled:opacity-50 ${stop.departure_manual ? 'border-accent/40 text-accent' : 'border-border text-gray-500'}`}
                                  />
                                  <span className="absolute inset-0 flex items-center px-1 text-[10px] font-mono pointer-events-none peer-focus:opacity-0 truncate">{fmtDT(stop.departure_date)}</span>
                                </div>
                              </td>
                            )}
                            <td className="px-2 py-1">
                              <span className="text-[8px] text-gray-400 block leading-none mb-0.5">{opLabel} inicio</span>
                              <div className="relative">
                              <input
                                key={`${stop.stop_id}-desc_inicio-${stop.unload_start ?? ''}`}
                                type="datetime-local"
                                aria-label={`${opLabel} inicio de ${stop.local ?? 'parada'}`}
                                defaultValue={toDatetimeLocalValue(stop.unload_start)}
                                onBlur={e => e.target.value && stop.stop_id && handleStopFieldChange(stop.stop_id, 'desc_inicio', e.target.value)}
                                disabled={stopSaving === stop.stop_id}
                                className={`peer w-full text-[10px] font-mono border rounded px-1 py-0.5 text-transparent focus:text-inherit focus:outline-none focus:ring-1 focus:ring-accent/30 bg-white disabled:opacity-50 ${stop.desc_manual ? 'border-accent/40 text-accent' : 'border-border text-gray-500'}`}
                              />
                              <span className="absolute inset-0 flex items-center px-1 text-[10px] font-mono pointer-events-none peer-focus:opacity-0 truncate">{fmtDT(stop.unload_start)}</span>
                              </div>
                            </td>
                            <td className="px-2 py-1">
                              <span className="text-[8px] text-gray-400 block leading-none mb-0.5">{opLabel} fin</span>
                              <div className="relative">
                              <input
                                key={`${stop.stop_id}-desc_fin-${stop.unload_end ?? ''}`}
                                type="datetime-local"
                                aria-label={`${opLabel} fin de ${stop.local ?? 'parada'}`}
                                defaultValue={toDatetimeLocalValue(stop.unload_end)}
                                onBlur={e => e.target.value && stop.stop_id && handleStopFieldChange(stop.stop_id, 'desc_fin', e.target.value)}
                                disabled={stopSaving === stop.stop_id}
                                className={`peer w-full text-[10px] font-mono border rounded px-1 py-0.5 text-transparent focus:text-inherit focus:outline-none focus:ring-1 focus:ring-accent/30 bg-white disabled:opacity-50 ${stop.desc_manual ? 'border-accent/40 text-accent' : 'border-border text-gray-500'}`}
                              />
                              <span className="absolute inset-0 flex items-center px-1 text-[10px] font-mono pointer-events-none peer-focus:opacity-0 truncate">{fmtDT(stop.unload_end)}</span>
                              </div>
                            </td>
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
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </AccordionSection>
          )}

          <section ref={notesRef}>
            <AccordionSection title="Bitácora" defaultOpen>
              <TripNotesFeed trip={trip} />
            </AccordionSection>
          </section>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Crear `TripDetailView.test.tsx` portando `TripSlideOver.test.tsx`**

Copiar `TripSlideOver.test.tsx` completo a `TripDetailView.test.tsx`, después aplicar exactamente estos cambios:

1. `import { TripSlideOver } from './TripSlideOver'` → `import { TripDetailView } from './TripDetailView'`
2. La función helper `renderSlideOver` se renombra a `renderDetailView` (con `replace_all` en todo el archivo — son ~50 usos):
   ```tsx
   function renderDetailView(trip: Trip, props: Partial<Parameters<typeof TripDetailView>[0]> = {}) {
     const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
     return render(
       <QueryClientProvider client={client}>
         <TripDetailView trip={trip} onDismiss={vi.fn()} onSaved={vi.fn()} meta={null} {...props} />
       </QueryClientProvider>,
     )
   }
   ```
3. Cualquier test que pase `{ onClose }` como override (buscar `onClose` en el archivo) pasa a `{ onDismiss }`.
4. **Eliminar** el test `'closes when Escape is pressed'` (describe "layout y a11y") — `TripDetailView` no maneja Escape, eso vive en el wrapper de la ruta interceptada (Task 5); se verifica ahí en el checklist en vivo (Task 8).
5. **Eliminar** el test `'has dialog semantics (role, aria-modal)'` (mismo describe) — `role="dialog"`/`aria-modal` ya no viven en este componente, se verifican en Task 5.

- [ ] **Step 3: Convertir `TripSlideOver` en wrapper fino sobre `TripDetailView`**

Reemplazar el contenido completo de `TripSlideOver.tsx` por:

```tsx
// monitor-app/frontend/components/dashboard/TripSlideOver.tsx
'use client'

import { useEffect, useRef } from 'react'
import type { Trip, TripsMeta } from '@/lib/types'
import { TripDetailView } from './TripDetailView'

interface Props {
  trip:        Trip | null
  onClose:     () => void
  onSaved:     (updated: Trip) => void
  meta?:       TripsMeta | null
  focusNotes?: boolean
}

export function TripSlideOver({ trip, onClose, onSaved, meta, focusNotes = false }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Semántica de diálogo: Escape cierra, Tab queda atrapado en el panel, el
  // foco vuelve al origen al cerrar — igual que antes de extraer
  // TripDetailView, ver docs/superpowers/plans/2026-07-29-trip-detail-immersive-page-plan.md
  useEffect(() => {
    if (!trip) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (!focusables.length) return
        const first = focusables[0]
        const last  = focusables[focusables.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || active === panelRef.current)) {
          e.preventDefault(); last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault(); first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [trip?.id, onClose]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!trip) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Detalle de viaje ${trip.source_system_trip_id ?? trip.tractor_plate ?? ''}`}
        tabIndex={-1}
        className="fixed inset-0 z-50 flex flex-col bg-white md:inset-4 md:rounded-2xl md:shadow-2xl overflow-hidden focus:outline-none animate-modal-in"
      >
        <TripDetailView trip={trip} onSaved={onSaved} onDismiss={onClose} meta={meta} focusNotes={focusNotes} />
      </div>
    </>
  )
}
```

- [ ] **Step 4: Run both test suites**

Run: `npx vitest run components/dashboard/TripSlideOver.test.tsx components/dashboard/TripDetailView.test.tsx`
Expected: PASS — `TripSlideOver.test.tsx` sigue en verde tal cual (prueba que el wrapper fino preserva el comportamiento externo exacto: dialog semantics, Escape, Tab-trap); `TripDetailView.test.tsx` en verde con 2 tests menos que el original (Escape y dialog semantics, removidos en el Step 2).

Run: `npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/TripDetailView.tsx components/dashboard/TripDetailView.test.tsx components/dashboard/TripSlideOver.tsx
git commit -m "refactor(diario): extract TripDetailView, TripSlideOver becomes a thin wrapper"
```

---

### Task 4: Rutas — layout con slot `@modal` + página standalone

**Files:**
- Create: `monitor-app/frontend/app/dashboard/operations/monitor/layout.tsx`
- Create: `monitor-app/frontend/app/dashboard/operations/monitor/@modal/default.tsx`
- Create: `monitor-app/frontend/app/dashboard/operations/monitor/trips/[id]/page.tsx`

**Interfaces:**
- Consumes: `TripDetailView` (Task 3), `tripsApi.get(id): Promise<Trip>` (existente, `lib/api/trips.ts`), `fetchTripsMeta(): Promise<TripsMeta>` (existente, `lib/api/tripsMeta.ts`), `TripListResponse` (existente, `lib/api/trips.ts`).
- Produces: la ruta `/dashboard/operations/monitor/trips/[id]` — accesible por link directo/F5, sin la tabla de fondo. Ningún otro archivo depende de esto todavía (Task 6 la usa recién al migrar los call sites).

No existe hoy ningún `layout.tsx` en `app/dashboard/operations/monitor/` — se crea nuevo. No modifica el padre `app/dashboard/layout.tsx`.

- [ ] **Step 1: Crear el layout con el slot paralelo**

```tsx
// monitor-app/frontend/app/dashboard/operations/monitor/layout.tsx
export default function MonitorLayout({
  children,
  modal,
}: {
  children: React.ReactNode
  modal:    React.ReactNode
}) {
  return (
    <>
      {children}
      {modal}
    </>
  )
}
```

- [ ] **Step 2: Crear el fallback del slot (nada que interceptar por defecto)**

```tsx
// monitor-app/frontend/app/dashboard/operations/monitor/@modal/default.tsx
export default function Default() {
  return null
}
```

- [ ] **Step 3: Crear la página standalone**

```tsx
// monitor-app/frontend/app/dashboard/operations/monitor/trips/[id]/page.tsx
'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { tripsApi, type TripListResponse } from '@/lib/api/trips'
import { fetchTripsMeta } from '@/lib/api/tripsMeta'
import type { Trip } from '@/lib/types'
import { TripDetailView } from '@/components/dashboard/TripDetailView'

export default function TripDetailStandalonePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()

  const tripQuery = useQuery({ queryKey: ['trip', id], queryFn: () => tripsApi.get(id) })
  const metaQuery = useQuery({ queryKey: ['trips-meta'], queryFn: fetchTripsMeta, staleTime: 60 * 60 * 1000 })

  function handleSaved(updated: Trip) {
    queryClient.setQueryData(['trip', id], updated)
    queryClient.setQueriesData<TripListResponse>({ queryKey: ['trips'] }, old =>
      old ? { ...old, data: old.data.map(t => (t.id === updated.id ? updated : t)) } : old)
  }

  if (tripQuery.isPending) {
    return (
      <div className="h-screen flex items-center justify-center bg-white text-gray-400 gap-2 text-sm">
        <Loader2 size={16} className="animate-spin" /> Cargando viaje…
      </div>
    )
  }

  if (tripQuery.isError || !tripQuery.data) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-white gap-3">
        <p className="text-sm text-gray-500">No se pudo cargar este viaje.</p>
        <button
          type="button"
          onClick={() => router.push('/dashboard/operations/monitor')}
          className="text-xs font-semibold text-accent hover:underline"
        >
          Volver a Monitor
        </button>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <TripDetailView
        trip={tripQuery.data}
        onSaved={handleSaved}
        onDismiss={() => router.push('/dashboard/operations/monitor')}
        meta={metaQuery.data ?? null}
        focusNotes={searchParams.get('focus') === 'bitacora'}
      />
    </div>
  )
}
```

- [ ] **Step 4: Verificación manual (no hay test automatizado de routing — ver Global Constraints)**

Run: `npx tsc --noEmit`
Expected: sin errores

Run: `npm run dev` (o el comando de dev del proyecto), navegar manualmente a `http://localhost:3000/dashboard/operations/monitor/trips/<un-id-real-de-un-viaje>` (buscar un id real con `execute_sql` contra Supabase si hace falta, o desde la tabla del Diario en dev). Confirmar: carga la página completa (sin la tabla de fondo), muestra el viaje correcto, "Volver a Monitor" navega a `/dashboard/operations/monitor`. Probar también un id inexistente (ej. `trips/no-existe`) — confirma el estado de error con el botón de volver.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/operations/monitor/layout.tsx app/dashboard/operations/monitor/@modal/default.tsx app/dashboard/operations/monitor/trips/\[id\]/page.tsx
git commit -m "feat(diario): standalone trip detail route with @modal slot foundation"
```

---

### Task 5: Ruta interceptada — overlay sobre la tabla

**Files:**
- Create: `monitor-app/frontend/app/dashboard/operations/monitor/@modal/(.)trips/[id]/page.tsx`

**Interfaces:**
- Consumes: mismo set que Task 4 (`TripDetailView`, `tripsApi.get`, `fetchTripsMeta`, `TripListResponse`).
- Produces: la experiencia overlay activada por navegación cliente-side desde `/dashboard/operations/monitor` (Task 6 la dispara).

Reusa el mismo patrón de foco/Escape/Tab-trap que tenía `TripSlideOver.tsx` antes de la Task 3 (guardado ahí mismo como wrapper fino) — acá aplica de verdad porque ESTE es el modo overlay; la página standalone (Task 4) no lo usa.

- [ ] **Step 1: Crear la página interceptada**

```tsx
// monitor-app/frontend/app/dashboard/operations/monitor/@modal/(.)trips/[id]/page.tsx
'use client'

import { useEffect, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { tripsApi, type TripListResponse } from '@/lib/api/trips'
import { fetchTripsMeta } from '@/lib/api/tripsMeta'
import type { Trip } from '@/lib/types'
import { TripDetailView } from '@/components/dashboard/TripDetailView'

export default function TripDetailOverlay() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const panelRef = useRef<HTMLDivElement>(null)

  const tripQuery = useQuery({ queryKey: ['trip', id], queryFn: () => tripsApi.get(id) })
  const metaQuery = useQuery({ queryKey: ['trips-meta'], queryFn: fetchTripsMeta, staleTime: 60 * 60 * 1000 })

  function dismiss() { router.back() }

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { dismiss(); return }
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (!focusables.length) return
        const first = focusables[0]
        const last  = focusables[focusables.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || active === panelRef.current)) {
          e.preventDefault(); last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault(); first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  function handleSaved(updated: Trip) {
    queryClient.setQueryData(['trip', id], updated)
    queryClient.setQueriesData<TripListResponse>({ queryKey: ['trips'] }, old =>
      old ? { ...old, data: old.data.map(t => (t.id === updated.id ? updated : t)) } : old)
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={dismiss} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={tripQuery.data ? `Detalle de viaje ${tripQuery.data.source_system_trip_id ?? tripQuery.data.tractor_plate ?? ''}` : 'Detalle de viaje'}
        tabIndex={-1}
        className="fixed inset-0 z-50 flex flex-col bg-white md:inset-4 md:rounded-2xl md:shadow-2xl overflow-hidden focus:outline-none animate-modal-in"
      >
        {tripQuery.isPending ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 gap-2 text-sm">
            <Loader2 size={16} className="animate-spin" /> Cargando viaje…
          </div>
        ) : tripQuery.isError || !tripQuery.data ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <p className="text-sm text-gray-500">No se pudo cargar este viaje.</p>
            <button type="button" onClick={dismiss} className="text-xs font-semibold text-accent hover:underline">
              Volver a Monitor
            </button>
          </div>
        ) : (
          <TripDetailView
            trip={tripQuery.data}
            onSaved={handleSaved}
            onDismiss={dismiss}
            meta={metaQuery.data ?? null}
            focusNotes={searchParams.get('focus') === 'bitacora'}
          />
        )}
      </div>
    </>
  )
}
```

**Nota sobre `previouslyFocused`**: a diferencia del wrapper fino de `TripSlideOver.tsx` (Task 3, donde el cleanup del `useEffect` corre al desmontar y ahí mismo restaura el foco), acá el desmontaje ocurre por navegación (`router.back()`), y React limpia el efecto de todas formas al desmontar el componente de ruta — el mismo `return () => { ...; previouslyFocused?.focus?.() }` funcionaría igual, pero se omitió arriba por simplicidad de una primera versión; si al verificar en vivo (Step 2) el foco no vuelve razonablemente a la fila clickeada, agregar esa misma línea al cleanup antes de continuar.

- [ ] **Step 2: Verificación manual en dev**

Run: `npx tsc --noEmit` — sin errores.

En `npm run dev`, navegar a `/dashboard/operations/monitor`, hacer click en una fila. Confirmar: el overlay se desliza encima de la tabla (la tabla de fondo sigue visible), la URL cambia a `/dashboard/operations/monitor/trips/<id>`, Escape lo cierra y vuelve a la tabla, click en el backdrop también cierra, Tab no se escapa del panel hacia la tabla de fondo.

**Nota**: en este punto del plan la tabla todavía no navega a esta ruta al hacer click (eso es Task 6) — para probar esta página manualmente antes de la Task 6, navegar directo con el botón atrás/adelante del navegador después de visitar `/dashboard/operations/monitor` y luego pegar la URL `/dashboard/operations/monitor/trips/<id>` en la barra de direcciones **usando un link, no un F5** (ej. un `<a href="...">` de prueba, o `router.push` desde la consola del navegador) — un F5/carga directa activa la standalone (Task 4), no esta interceptada, porque la interceptación de Next.js solo aplica a navegaciones client-side que parten de dentro de la app.

- [ ] **Step 3: Commit**

```bash
git add "app/dashboard/operations/monitor/@modal/(.)trips/[id]/page.tsx"
git commit -m "feat(diario): intercepted overlay route for trip detail"
```

---

### Task 6: Migrar `monitor/page.tsx` — de `setSelected` a navegación

**Files:**
- Modify: `monitor-app/frontend/app/dashboard/operations/monitor/page.tsx`

**Interfaces:**
- Consumes: `useRouter`, `usePathname` de `next/navigation`; las rutas creadas en Tasks 4-5.

Ningún otro archivo (`TripTable.tsx`, `TripBoard.tsx`, `CloseDayDialog.tsx`, `FleetCenterDialog.tsx`, `BitacoraFollowupBadge.tsx`) necesita cambios — todos reciben `onSelect`/`onSelectTrip`/`onSelectFocusNotes` como props y solo los invocan; la lógica que cambia vive entera en `monitor/page.tsx`.

- [ ] **Step 1: Agregar imports de routing**

En `monitor-app/frontend/app/dashboard/operations/monitor/page.tsx`, agregar a la línea 3 (import de `next/navigation`, no existe todavía en este archivo):

```tsx
import { useRouter, usePathname } from 'next/navigation'
```

Quitar el import de `TripSlideOver` (línea 14, ya no se usa en este archivo):

```diff
- import { TripSlideOver } from '@/components/dashboard/TripSlideOver'
```

- [ ] **Step 2: Reemplazar `selected`/`focusNotes` state por routing**

```diff
- const [selected,       setSelected]       = useState<Trip | null>(null)
- const [focusNotes,     setFocusNotes]     = useState(false)
```

Agregar, junto a la declaración de `queryClient` (línea 168):

```tsx
const router   = useRouter()
const pathname = usePathname()
// Mientras el overlay interceptado está abierto, la URL real de este mismo
// árbol de React sigue siendo /monitor/trips/[id] (Next.js actualiza el
// router context aunque este componente monte por el slot `children`, no
// por `@modal`) — se usa para resaltar la fila abierta en la tabla, mismo
// rol que cumplía `selected?.id` antes.
const openTripId = pathname.match(/\/trips\/([^/?]+)/)?.[1] ?? null
```

- [ ] **Step 3: Actualizar `handleSaved`**

```diff
  function handleSaved(updated: Trip) {
-   setSelected(updated)
+   queryClient.setQueryData(['trip', updated.id], updated)
    // Actualiza el viaje en todas las listas cacheadas — sin refetch
    queryClient.setQueriesData<TripListResponse>({ queryKey: ['trips'] }, old =>
      old ? { ...old, data: old.data.map(t => (t.id === updated.id ? updated : t)) } : old)
  }
```

- [ ] **Step 4: Actualizar `handleCreated`**

```diff
  function handleCreated(newTrip: Trip) {
-   setSelected(newTrip)
    // El viaje recién creado debe quedar visible: si su fecha no coincide con el
    // filtro actual, saltamos a esa fecha (si no, la lista lo escondería)
    if (newTrip.planning_date && (f.tab !== 'en_curso' || newTrip.planning_date !== f.fecha)) {
      dispatch({ type: 'patch', patch: { tab: 'en_curso', fecha: newTrip.planning_date } })
    }
    queryClient.invalidateQueries({ queryKey: ['trips'] })
+   queryClient.setQueryData(['trip', newTrip.id], newTrip)
+   router.push(`/dashboard/operations/monitor/trips/${newTrip.id}`)
  }
```

- [ ] **Step 5: Simplificar `handleSelectTrip`**

```diff
- async function handleSelectTrip(tripId: string) {
+ function handleSelectTrip(tripId: string) {
    setShowCloseDay(false)
    setShowFleetCenter(false)
-   try {
-     const trip = await tripsApi.get(tripId)
-     setSelected(trip)
-   } catch {
-     // silencioso — el operador puede reabrir el modal y reintentar
-   }
+   router.push(`/dashboard/operations/monitor/trips/${tripId}`)
  }
```

(La página de destino resuelve su propio loading/error — ya no hace falta el try/catch silencioso acá; si el fetch falla, el operador ve el estado de error con el botón "Volver a Monitor" en vez de que no pase nada.)

- [ ] **Step 6: Simplificar `handleSelectTripFocusNotes`**

```diff
  function handleSelectTripFocusNotes(trip: Trip) {
-   setSelected(trip)
-   setFocusNotes(true)
+   queryClient.setQueryData(['trip', trip.id], trip)
+   router.push(`/dashboard/operations/monitor/trips/${trip.id}?focus=bitacora`)
  }
```

- [ ] **Step 7: Actualizar `TripBoard` y `TripTable`**

```diff
                <TripBoard
                  trips={visibleTrips}
                  groups={defaultGroups}
                  meta={tripsMeta}
                  onSaved={handleSaved}
-                 onSelect={setSelected}
+                 onSelect={trip => {
+                   queryClient.setQueryData(['trip', trip.id], trip)
+                   router.push(`/dashboard/operations/monitor/trips/${trip.id}`)
+                 }}
                  updatedIds={updatedIds}
                />
              ) : (
                <TripTable
                  trips={visibleTrips}
-                 selectedId={selected?.id ?? null}
-                 onSelect={trip => { setSelected(trip); setFocusNotes(false) }}
+                 selectedId={openTripId}
+                 onSelect={trip => {
+                   queryClient.setQueryData(['trip', trip.id], trip)
+                   router.push(`/dashboard/operations/monitor/trips/${trip.id}`)
+                 }}
                  onSelectFocusNotes={handleSelectTripFocusNotes}
                  meta={tripsMeta}
                  updatedIds={updatedIds}
                />
              )}
```

- [ ] **Step 8: Quitar el render de `<TripSlideOver>`**

```diff
-      <TripSlideOver
-        trip={selected}
-        onClose={() => { setSelected(null); setFocusNotes(false) }}
-        onSaved={handleSaved}
-        meta={tripsMeta}
-        focusNotes={focusNotes}
-      />
       <TripAssignDialog
```

- [ ] **Step 9: Verificar**

Run: `npx tsc --noEmit` — sin errores (confirma que no queda ninguna referencia colgante a `selected`/`setSelected`/`focusNotes`/`setFocusNotes`).

Run: `npx vitest run` — la suite completa de `monitor-app/frontend` en verde (este archivo no tiene su propio `.test.tsx` hoy — confirmar con `find app/dashboard/operations/monitor -iname "*.test.tsx"`; si no existe, esta verificación es solo `tsc` + la manual del Step 10).

- [ ] **Step 10: Verificación manual en dev**

Con `npm run dev`: click en una fila de la tabla → overlay se abre con URL real; guardar un campo (ej. Desc. inicio) → cerrar el overlay → confirmar que la fila en la tabla de fondo muestra el valor actualizado sin refrescar la página; click en el badge de Bitácora de una fila → overlay abre con la sección Bitácora expandida y scrolleada a la vista; abrir "Cerrar día" → seleccionar una fila MISMATCH → confirma que abre el viaje correcto; abrir "Flota" → seleccionar "equipo en viaje hoy" → confirma que abre el viaje correcto.

**Riesgo conocido — `openTripId` (Step 2)**: no hay certeza sin probarlo en vivo de que `usePathname()` dentro de `monitor/page.tsx` refleje la URL `/trips/[id]` mientras el componente sigue montado por el slot `children` durante una navegación interceptada (comportamiento de Next.js parallel routes, no confirmado contra esta versión específica del framework). Verificar acá: abrir una fila, confirmar visualmente si esa fila queda resaltada en la tabla de fondo. Si NO se resalta, `openTripId` está devolviendo `null` incorrectamente — degradar con gracia: dejar `selectedId={null}` fijo (sin el resaltado, pero sin romper nada más) y anotarlo como ítem pendiente, no bloquea el resto del plan.

- [ ] **Step 11: Commit**

```bash
git add app/dashboard/operations/monitor/page.tsx
git commit -m "refactor(diario): migrate monitor page from setSelected modal state to route navigation"
```

---

### Task 7: Borrar `TripSlideOver` (código muerto)

**Files:**
- Delete: `monitor-app/frontend/components/dashboard/TripSlideOver.tsx`
- Delete: `monitor-app/frontend/components/dashboard/TripSlideOver.test.tsx`

**Interfaces:**
- Consumes: nada — este es el paso de limpieza final, solo procede si Task 6 ya migró el único call site real.

- [ ] **Step 1: Confirmar que no queda ninguna referencia**

Run: `grep -rn "TripSlideOver" monitor-app/frontend --include="*.tsx" --include="*.ts"`
Expected: 0 resultados (o, como mucho, el comentario ya identificado en `app/dashboard/carriers/page.tsx` que menciona "TripSlideOver" en texto — si aparece, es seguro, no es un import).

- [ ] **Step 2: Borrar los archivos**

```bash
git rm components/dashboard/TripSlideOver.tsx components/dashboard/TripSlideOver.test.tsx
```

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npx vitest run`
Expected: ambos en verde — nada en el árbol dependía de estos archivos.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(diario): remove TripSlideOver, superseded by TripDetailView + route pages"
```

---

### Task 8: Checklist de verificación en vivo (staging)

**Files:** ninguno — tarea de verificación manual, no de código.

Con los cambios pusheados a `origin/dev` y desplegados (`gh run watch`, mismo flujo que el resto de esta sesión), contra `https://webcarga-frontend-dev-zcdyyci7ta-uc.a.run.app`:

- [ ] Click en una fila del Diario → el detalle entra deslizándose sobre la tabla (la tabla de fondo sigue visible), la URL cambia a `/dashboard/operations/monitor/trips/<id>`.
- [ ] Botón atrás del navegador → vuelve a la tabla exactamente como estaba (mismo scroll, mismos filtros activos).
- [ ] Copiar la URL del viaje abierto y pegarla en una pestaña nueva → carga la página completa standalone, sin la tabla de fondo, con un botón "Volver a Monitor".
- [ ] Con Playwright, probar una URL de viaje inexistente (`/dashboard/operations/monitor/trips/no-existe`) → confirma el estado de error con el botón de volver, no una pantalla en blanco ni un crash.
- [ ] Botón "Colapsar Gestión" → el panel se achica a un riel angosto con solo el ícono; "Expandir Gestión" lo devuelve a 360px.
- [ ] Colapsar la sección "Ruta" y "Bitácora" (click en sus headers) → el contenido se oculta/muestra correctamente.
- [ ] Editar un campo de la tabla técnica (ej. "Desc. inicio") → guardar → volver a la tabla (back button) → confirmar que la fila de fondo refleja el cambio sin necesidad de refrescar.
- [ ] Click en un `BitacoraFollowupBadge` (columna Estado de la tabla) → el overlay abre con la sección Bitácora ya expandida y scrolleada a la vista.
- [ ] "Cerrar día" → seleccionar una fila con estado MISMATCH → confirma que abre el detalle del viaje correcto.
- [ ] "Flota" → seleccionar un "equipo en viaje hoy" → confirma que abre el detalle del viaje correcto.
- [ ] Confirmar que Tab no se escapa del panel hacia la tabla de fondo mientras el overlay está abierto (accesibilidad — trampa de foco).
- [ ] Confirmar que después de cerrar el overlay (Escape o botón X), el foco vuelve razonablemente a la fila que se había clickeado (no se pierde en el `<body>`).

Si algún ítem falla, no continuar — volver a la tarea correspondiente, corregir, re-desplegar y repetir el checklist desde ese ítem.
