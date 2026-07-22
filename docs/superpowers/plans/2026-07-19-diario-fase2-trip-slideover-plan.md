# Diario Fase 2 — TripSlideOver Structural Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplanar los 2 acordeones de `TripSlideOver`, reordenar sus columnas, reemplazar `CarrierAssignSection` (carrier-first) por `FleetAssignSection` (driver-first, ya commiteado), retirar `RouteProgress` (redundante con `StopTimeline`), agregar el link a la TMS y unificar los IDs en el header.

**Architecture:** Reescritura completa de un único archivo grande (`TripSlideOver.tsx`, 895 líneas) — los cambios tocan casi todas las secciones del componente (header, hero, ambas columnas), así que dividirlo en pasos incrementales dejaría el componente en un estado roto entre pasos. Se trata como una sola unidad de reescritura con TDD (test completo reescrito primero, luego la implementación completa).

**Tech Stack:** Next.js 16 / React, TanStack Query, Vitest + Testing Library.

## Global Constraints

- Este plan **no reusa el componente `RouteEditor`** dentro de `TripSlideOver` — ver la nota de alcance en la Task 2. `StopTimeline` + la tabla técnica siguen siendo la única forma de ver/editar horarios de paradas de un viaje ya existente.
- `TripNotesFeed.tsx` **no se modifica** en este plan — solo cambia dónde vive su contenedor dentro de `TripSlideOver.tsx`. El retiro del texto legacy y el ciclo de vida de incidentes son del Plan 5.
- `IndicatorDots.tsx` **no se modifica** — sigue siendo el mismo componente de puntos. El rediseño a switches con etiqueta es del Plan 5.
- `npx tsc --noEmit` y `npm test` (vitest) limpios al final de cada task.
- Sin verificación en navegador (SSO real, sin credenciales de test en este entorno).

---

### Task 1: `TMS_LOGIN_URLS` — link público a cada TMS

**Files:**
- Create: `monitor-app/frontend/lib/utils/tmsLinks.ts`
- Create: `monitor-app/frontend/lib/utils/tmsLinks.test.ts`

**Interfaces:**
- Produces: `TMS_LOGIN_URLS: Record<string, string>` — mapa `source_system` (minúscula) → URL pública de login del TMS. Sin entrada para `'manual'`. Consumido por la Task 2.

- [ ] **Step 1: Escribir el test que falla**

Crear `monitor-app/frontend/lib/utils/tmsLinks.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { TMS_LOGIN_URLS } from './tmsLinks'

describe('TMS_LOGIN_URLS', () => {
  it('maps the 3 known TMS sources to their public login URL', () => {
    expect(TMS_LOGIN_URLS.qanalytics).toBe('https://www.qanalytics.cl/qnew/#')
    expect(TMS_LOGIN_URLS.wingsuite).toBe('https://suite.wing.cl/web/core/inicio_sesion.php')
    expect(TMS_LOGIN_URLS.sodimac).toBe('https://tms.falabella.supply/login')
  })

  it('has no entry for manual (no TMS to link to)', () => {
    expect(TMS_LOGIN_URLS.manual).toBeUndefined()
  })
})
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `cd monitor-app/frontend && npx vitest run lib/utils/tmsLinks.test.ts`
Expected: FAIL — `./tmsLinks` no existe todavía.

- [ ] **Step 3: Implementar `tmsLinks.ts`**

Crear `monitor-app/frontend/lib/utils/tmsLinks.ts`:

```typescript
/** URLs públicas de login de cada TMS — NO son credenciales, solo el punto
 *  de entrada donde el gestor inicia sesión con su propia cuenta y busca el
 *  viaje a mano del otro lado. Nunca usar esto para ningún flujo
 *  autenticado/deep-link con la cuenta de servicio de extraction_service —
 *  esa cuenta es compartida (sin trazabilidad por usuario) y Sodimac además
 *  usa evasión de Cloudflare pensada para scraping, no sesiones humanas
 *  (decisión de seguridad explícita, Fase 2 del hardening del Diario). */
export const TMS_LOGIN_URLS: Record<string, string> = {
  qanalytics: 'https://www.qanalytics.cl/qnew/#',
  wingsuite:  'https://suite.wing.cl/web/core/inicio_sesion.php',
  sodimac:    'https://tms.falabella.supply/login',
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `cd monitor-app/frontend && npx vitest run lib/utils/tmsLinks.test.ts`
Expected: 2 passed.

- [ ] **Step 5: `tsc` limpio**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/frontend/lib/utils/tmsLinks.ts monitor-app/frontend/lib/utils/tmsLinks.test.ts
git commit -m "feat(diario): TMS_LOGIN_URLS — link público a la TMS de origen, sin credenciales"
```

---

### Task 2: `TripSlideOver` reconstruido — secciones aplanadas, `FleetAssignSection`, IDs unificados, `RouteProgress` retirado

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/TripSlideOver.tsx` (reescritura completa)
- Delete: `monitor-app/frontend/components/dashboard/RouteProgress.tsx`
- Modify: `monitor-app/frontend/components/dashboard/TripSlideOver.test.tsx` (reescritura completa)

**Interfaces:**
- Consumes: `TMS_LOGIN_URLS` (Task 1), `FleetAssignSection`/`EMPTY_FLEET_ASSIGN_VALUE`/`FleetAssignValue` (Plan 2, ya commiteado), `FleetLinkPayload` (`lib/api/trips.ts`, ya existente: `{ carrier_id, driver_id?, tractor_asset_id?, trailer_asset_id?, tractor_plate?, trailer_plate?, driver_name? }`).
- Produces: `TripSlideOver` sigue exponiendo la misma interfaz pública (`trip`/`onClose`/`onSaved`/`meta`) — sin cambios para quien lo usa desde `page.tsx`.

**Nota de alcance (documentada, no a redecidir)**: la sección "Ruta" sigue usando `StopTimeline` + la tabla técnica — **no** se integra el componente `RouteEditor` (de creación) acá. No existe ningún endpoint de backend para agregar/quitar/renombrar paradas de un viaje ya existente (el Plan 1 solo tocó el contrato de creación), y la decisión de diseño #2 del spec dice explícitamente que las secciones que solo aplican a un viaje en curso (timeline GPS) siguen existiendo solo en el detalle. La mención del spec a "RouteEditor, origen primero" se interpreta como el mismo principio de orden (origen antes que destinos) que `StopTimeline` ya respeta desde la Ronda 21, no como reuso literal del componente.

- [ ] **Step 1: Borrar `RouteProgress.tsx` (sin más consumidores tras este plan)**

```bash
rm monitor-app/frontend/components/dashboard/RouteProgress.tsx
```

(Se borra ahora, antes de reescribir `TripSlideOver.tsx`, para que el `tsc`/test run de los pasos siguientes confirme que ya no queda ninguna referencia.)

- [ ] **Step 2: Reescribir `TripSlideOver.test.tsx` completo**

Reemplazar `monitor-app/frontend/components/dashboard/TripSlideOver.test.tsx` completo:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TripSlideOver } from './TripSlideOver'
import { tripsApi } from '@/lib/api/trips'
import { driversApi } from '@/lib/api/drivers'
import type { Trip, TripNote } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: {
    patch: vi.fn(),
    patchStop: vi.fn(),
    resetField: vi.fn(),
    assignFleetLink: vi.fn(),
    removeFleetLink: vi.fn(),
    listNotes: vi.fn(),
    addNote: vi.fn(),
    pinNote: vi.fn(),
  },
}))
vi.mock('@/lib/api/drivers', () => ({
  driversApi: { search: vi.fn() },
}))

const baseTrip: Trip = {
  id: 't1', source_system: 'qanalytics', client_name: 'walmart', planning_date: '2026-07-02',
  status_reported_at: null, current_status: 'ORIGEN', tractor_plate: 'ABCD12', tractor_plate_tms: null, trailer_plate: null,
  driver_name: 'Juan Perez', driver_name_tms: null, driver_tax_id: null, driver_phone: null, carrier_name: null, carrier_name_tms: null,
  origin: 'CD Quilicura', cargo_type: 'FRIO', stops: [], is_active: true, is_working: false, is_assigned: true,
  is_first_leg: false, manual_status: null, notes: null, comments: null, unassigned_reason_id: null,
  fleet_link_id: null, carrier_id: null, driver_id: null, tractor_asset_id: null, trailer_asset_id: null, manually_edited_fields: [], edited_at: null,
  edited_by: null, created_at: null,
  updated_at: null, source_system_trip_id: '2000711', milestone_status: null, pipeline_updated_at: null,
}

const makeStop = (overrides: Partial<Trip['stops'][number]> = {}): Trip['stops'][number] => ({
  stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: null, departure_date: null,
  departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
  on_time_status: null, destination_city: null, destination_region: null, s2s: null,
  temperature: null, milestone_status: null,
  ...overrides,
})

function renderSlideOver(trip: Trip, props: Partial<Parameters<typeof TripSlideOver>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TripSlideOver trip={trip} onClose={vi.fn()} onSaved={vi.fn()} meta={null} {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(tripsApi.patch).mockReset()
  vi.mocked(tripsApi.patchStop).mockReset()
  vi.mocked(tripsApi.resetField).mockReset()
  vi.mocked(tripsApi.assignFleetLink).mockReset()
  vi.mocked(tripsApi.removeFleetLink).mockReset()
  vi.mocked(tripsApi.listNotes).mockReset().mockResolvedValue([])
  vi.mocked(tripsApi.addNote).mockReset()
  vi.mocked(driversApi.search).mockReset().mockResolvedValue([])
})

describe('TripSlideOver — hero (la historia del viaje)', () => {
  it('shows the active stop with its ETA in the hero', () => {
    const stops = [
      makeStop({ stop_id: 's1', local: 'Local 1', arrival_date: '2026-07-02 10:00:00', departure_date: '2026-07-02 10:30:00' }),
      makeStop({ stop_id: 's2', local: 'Local 2', planning_date: '2026-07-02 14:00:00' }),
    ]
    renderSlideOver({ ...baseTrip, stops })
    expect(screen.getAllByText('Local 2').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/llega ~/).length).toBeGreaterThan(0)
  })

  it('shows stop progress (N/M paradas) and badges only exceptions (no ON TIME badge)', () => {
    const stops = [
      makeStop({ stop_id: 's1', local: 'Local 1', arrival_date: '2026-07-02 10:00:00', on_time_status: 'ON TIME' }),
      makeStop({ stop_id: 's2', local: 'Local 2' }),
    ]
    renderSlideOver({ ...baseTrip, stops })
    expect(screen.getByText('1/2 paradas')).toBeInTheDocument()
    expect(screen.queryByText('ON TIME')).not.toBeInTheDocument()
  })

  it('shows the OFF TIME badge in the hero when a stop is off time', () => {
    const stops = [makeStop({ stop_id: 's1', local: 'Local 1', on_time_status: 'OFF TIME' })]
    renderSlideOver({ ...baseTrip, stops })
    expect(screen.getAllByText('OFF TIME').length).toBeGreaterThan(0)
  })

  it('degrades gracefully for a trip without stops', () => {
    renderSlideOver(baseTrip)
    expect(screen.getByText('Sin paradas registradas')).toBeInTheDocument()
  })

  it('shows a consolidated sync line with relative times', () => {
    const tripSynced = {
      ...baseTrip,
      status_reported_at: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
      pipeline_updated_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    }
    renderSlideOver(tripSynced)
    expect(screen.getByText(/TMS reportó hace 12 min/)).toBeInTheDocument()
    expect(screen.getByText(/sync hace 8 min/)).toBeInTheDocument()
  })

  it('shows a temperature badge when a reading exists', () => {
    const stops = [makeStop({ arrival_date: '2026-07-02 10:00:00', temperature: 4 })]
    renderSlideOver({ ...baseTrip, stops })
    expect(screen.getAllByText('4°C').length).toBeGreaterThan(0)
  })

  it('does not render RouteProgress anymore (retirado, StopTimeline es el único timeline)', () => {
    const stops = [makeStop({ stop_id: 's1', local: 'Local 1' })]
    const { container } = renderSlideOver({ ...baseTrip, stops })
    // RouteProgress usaba nodos redondos con title=local; StopTimeline (Ruta,
    // siempre visible) usa otro layout — confirmamos que no hay 2 renders de
    // la misma parada en el hero contando cuántas veces aparece su nombre
    // fuera de la sección "Ruta" (una sola vez, no dos).
    expect(container.querySelectorAll('[title="Local 1"]').length).toBe(0)
  })
})

describe('TripSlideOver — header (IDs unificados + link a TMS)', () => {
  it('copies the external id via its own button', () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    renderSlideOver(baseTrip)
    fireEvent.click(screen.getByTitle('Copiar ID externo'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('2000711')
  })

  it('shows the internal uuid in the header with its own copy button (no footer anymore)', () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    renderSlideOver(baseTrip)
    expect(screen.getByText('t1')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Copiar ID interno'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('t1')
  })

  it('the TMS chip links to the public login page for a TMS-sourced trip', () => {
    renderSlideOver({ ...baseTrip, source_system: 'qanalytics' })
    const link = screen.getByTitle(/Abrir en/)
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', 'https://www.qanalytics.cl/qnew/#')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('the TMS chip is not a link for a manual trip (no TMS to open)', () => {
    renderSlideOver({ ...baseTrip, source_system: 'manual' })
    expect(screen.queryByTitle(/Abrir en/)).not.toBeInTheDocument()
  })
})

describe('TripSlideOver — layout y a11y', () => {
  it('has dialog semantics (role, aria-modal)', () => {
    renderSlideOver(baseTrip)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('closes when Escape is pressed', () => {
    const onClose = vi.fn()
    renderSlideOver(baseTrip, { onClose })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('shows the driver search directly in Gestión, no accordion, when no company is linked', () => {
    renderSlideOver(baseTrip)
    expect(screen.getByLabelText('Buscar conductor')).toBeInTheDocument()
  })

  it('shows "en el Diario desde" with created_at in the hero', () => {
    renderSlideOver({ ...baseTrip, created_at: '2026-06-30 08:00:00' })
    expect(screen.getByText(/en el Diario desde/)).toBeInTheDocument()
  })

  it('shows Datos operativos always visible, no accordion, without EETT TMS', () => {
    renderSlideOver({ ...baseTrip, carrier_name_tms: 'Transportes ACME (texto TMS)' })
    expect(screen.getByText('Fecha planificación')).toBeInTheDocument()
    expect(screen.queryByText('EETT TMS')).not.toBeInTheDocument()
  })

  it('shows the technical stops table always visible, no "Ver detalle técnico" toggle', () => {
    const stops = [makeStop({ stop_id: 's1', local: 'Local 1' })]
    renderSlideOver({ ...baseTrip, stops })
    expect(screen.queryByText(/Ver detalle técnico/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Desc. inicio de Local 1')).toBeInTheDocument()
  })
})

describe('TripSlideOver — Conductor y flota (FleetAssignSection, driver-first)', () => {
  it('searches a driver, then Vincular calls assignFleetLink with the picked fleet', async () => {
    vi.mocked(driversApi.search).mockResolvedValueOnce([{
      driver_id: 'd1', driver_name: 'Juan Perez', driver_rut: '11.111.111-1', driver_phone: '+56911112222',
      carrier_id: 'c1', carrier_name: 'Transportes Sur Spa', tractor_asset_id: 'a1', tractor_plate: 'ABCD12',
    }])
    vi.mocked(tripsApi.assignFleetLink).mockResolvedValue({ ...baseTrip, carrier_id: 'c1', carrier_name: 'Transportes Sur Spa' })
    renderSlideOver(baseTrip)

    fireEvent.change(screen.getByLabelText('Buscar conductor'), { target: { value: 'Juan' } })
    fireEvent.click(await screen.findByText('Juan Perez'))
    fireEvent.click(screen.getByText('Vincular'))

    await waitFor(() =>
      expect(tripsApi.assignFleetLink).toHaveBeenCalledWith('t1', {
        carrier_id: 'c1', driver_id: 'd1', tractor_asset_id: 'a1',
        driver_name: 'Juan Perez', tractor_plate: 'ABCD12',
      }))
  })

  it('lets the operator correct the autofilled tractor plate before confirming', async () => {
    vi.mocked(driversApi.search).mockResolvedValueOnce([{
      driver_id: 'd1', driver_name: 'Juan Perez', driver_rut: null, driver_phone: null,
      carrier_id: 'c1', carrier_name: 'Transportes Sur Spa', tractor_asset_id: 'a1', tractor_plate: 'ABCD12',
    }])
    vi.mocked(tripsApi.assignFleetLink).mockResolvedValue({ ...baseTrip, carrier_id: 'c1' })
    renderSlideOver(baseTrip)

    fireEvent.change(screen.getByLabelText('Buscar conductor'), { target: { value: 'Juan' } })
    fireEvent.click(await screen.findByText('Juan Perez'))
    fireEvent.change(screen.getByLabelText('Patente tracto'), { target: { value: 'zxzx99' } })
    fireEvent.click(screen.getByText('Vincular'))

    await waitFor(() =>
      expect(tripsApi.assignFleetLink).toHaveBeenCalledWith('t1', expect.objectContaining({ tractor_plate: 'ZXZX99' })))
  })

  it('does not show Vincular until a driver is picked', () => {
    renderSlideOver(baseTrip)
    expect(screen.queryByText('Vincular')).not.toBeInTheDocument()
  })

  it('shows the linked carrier as a compact card (not FleetAssignSection) and unlinks via removeFleetLink', async () => {
    vi.mocked(tripsApi.removeFleetLink).mockResolvedValue({ ok: true })
    renderSlideOver({ ...baseTrip, carrier_id: 'c1', carrier_name: 'Transportes Sur Spa' })
    expect(screen.getByText('Transportes Sur Spa')).toBeInTheDocument()
    expect(screen.queryByLabelText('Buscar conductor')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Desvincular'))
    await waitFor(() => expect(tripsApi.removeFleetLink).toHaveBeenCalledWith('t1'))
  })

  it('shows the driver search again after unlinking, with a clean draft', async () => {
    vi.mocked(tripsApi.removeFleetLink).mockResolvedValue({ ok: true })
    const onSaved = vi.fn()
    renderSlideOver({ ...baseTrip, carrier_id: 'c1', carrier_name: 'Transportes Sur Spa' }, { onSaved })
    fireEvent.click(screen.getByText('Desvincular'))
    await waitFor(() => expect(tripsApi.removeFleetLink).toHaveBeenCalled())
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ carrier_id: null }))
  })

  it('shows a reconciliation banner including carrier divergence, and reverts via "Usar dato del TMS"', async () => {
    vi.mocked(tripsApi.removeFleetLink).mockResolvedValue({ ok: true })
    renderSlideOver({
      ...baseTrip,
      fleet_link_id: 'fl1', carrier_id: 'c1', carrier_name: 'Transportes Sur Spa',
      carrier_name_tms: 'Transportes ACME SPA',
    })
    expect(screen.getByText(/TMS reporta empresa/)).toBeInTheDocument()
    expect(screen.getByText('Transportes ACME SPA')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Usar dato del TMS'))
    await waitFor(() => expect(tripsApi.removeFleetLink).toHaveBeenCalledWith('t1'))
  })

  it('does not show the reconciliation banner when TMS and linked carrier match', () => {
    renderSlideOver({
      ...baseTrip,
      fleet_link_id: 'fl1', carrier_id: 'c1', carrier_name: 'Transportes Sur Spa',
      carrier_name_tms: 'Transportes Sur Spa',
    })
    expect(screen.queryByText(/TMS reporta empresa/)).not.toBeInTheDocument()
  })
})

describe('TripSlideOver — override de estado', () => {
  it('shows an inline "set manual override" affordance', () => {
    renderSlideOver(baseTrip)
    expect(screen.getByText(/Establecer estado operativo/)).toBeInTheDocument()
  })

  it('shows a microcopy clarifying it mirrors the header when there is no manual override', () => {
    renderSlideOver(baseTrip)
    expect(screen.getByText(/mismo estado que se muestra en el encabezado/)).toBeInTheDocument()
  })

  it('shows attribution with editor name and a revert control when manual_status is set', () => {
    renderSlideOver({ ...baseTrip, manual_status: 'en_seguimiento', edited_at: '2026-07-02 10:15:00', edited_by: 'Felipe Sumadots' })
    expect(screen.getByText(/confirmado manualmente/)).toBeInTheDocument()
    expect(screen.getByText(/Felipe Sumadots/)).toBeInTheDocument()
  })

  it('reverting the override calls tripsApi.resetField with manual_status', async () => {
    vi.mocked(tripsApi.resetField).mockResolvedValue({ ok: true, field: 'manual_status' })
    renderSlideOver({ ...baseTrip, manual_status: 'en_seguimiento' })
    fireEvent.click(screen.getByTitle('Revertir a valor del TMS'))
    await waitFor(() => expect(tripsApi.resetField).toHaveBeenCalledWith('t1', 'manual_status'))
  })

  it('shows a visible error when reverting the override fails', async () => {
    vi.mocked(tripsApi.resetField).mockRejectedValue(new Error('network down'))
    renderSlideOver({ ...baseTrip, manual_status: 'en_seguimiento' })
    fireEvent.click(screen.getByTitle('Revertir a valor del TMS'))
    expect(await screen.findByText('network down')).toBeInTheDocument()
  })
})

describe('TripSlideOver — indicadores', () => {
  it('renders editable Indicadores for a TMS-sourced trip', () => {
    renderSlideOver(baseTrip)
    expect(screen.getByTitle('Activo')).toBeInTheDocument()
  })

  it('renders editable Indicadores for a manual trip', () => {
    renderSlideOver({ ...baseTrip, source_system: 'manual' })
    expect(screen.getByTitle('Activo')).toBeInTheDocument()
  })
})

describe('TripSlideOver — Bitácora (feed con historial)', () => {
  const note: TripNote = {
    id: 'n1', trip_id: 't1', author_id: 'u1', author_name: 'Operador Uno',
    body: 'Conductor confirmó por teléfono', note_type: 'llamada', pinned: false,
    created_at: '2026-07-05 12:00:00', attachments: [],
  }

  it('renders existing notes with author and type chip', async () => {
    vi.mocked(tripsApi.listNotes).mockResolvedValue([note])
    renderSlideOver(baseTrip)
    expect(await screen.findByText('Conductor confirmó por teléfono')).toBeInTheDocument()
    expect(screen.getByText('Operador Uno')).toBeInTheDocument()
    expect(screen.getAllByText('Llamada').length).toBeGreaterThan(0)
  })

  it('adds a note through the composer with the selected type', async () => {
    vi.mocked(tripsApi.addNote).mockResolvedValue({ ...note, id: 'n2', body: 'nueva nota', note_type: 'incidente' })
    renderSlideOver(baseTrip)
    fireEvent.click(screen.getByTitle('Incidente'))
    fireEvent.change(screen.getByPlaceholderText(/Registrar novedad/), { target: { value: 'nueva nota' } })
    fireEvent.click(screen.getByText('Agregar nota'))
    await waitFor(() =>
      expect(tripsApi.addNote).toHaveBeenCalledWith('t1', { body: 'nueva nota', note_type: 'incidente', files: [] }))
    expect(await screen.findByText('nueva nota')).toBeInTheDocument()
  })

  it('shows a visible error when adding a note fails', async () => {
    vi.mocked(tripsApi.addNote).mockRejectedValue(new Error('network down'))
    renderSlideOver(baseTrip)
    fireEvent.change(screen.getByPlaceholderText(/Registrar novedad/), { target: { value: 'x' } })
    fireEvent.click(screen.getByText('Agregar nota'))
    expect(await screen.findByText('network down')).toBeInTheDocument()
  })

  it('shows legacy notes/comments as a read-only entry (retiro es del Plan 5, no de este)', () => {
    renderSlideOver({ ...baseTrip, notes: 'obs vieja', comments: 'comentario viejo' })
    expect(screen.getByText(/Nota anterior/)).toBeInTheDocument()
    expect(screen.getByText(/obs vieja/)).toBeInTheDocument()
    expect(screen.getByText(/comentario viejo/)).toBeInTheDocument()
  })

  it('renders pinned notes in a Destacadas section above the feed', async () => {
    vi.mocked(tripsApi.listNotes).mockResolvedValue([
      { ...note, id: 'n1', body: 'nota normal' },
      { ...note, id: 'n2', body: 'nota fijada', pinned: true },
    ])
    renderSlideOver(baseTrip)
    expect(await screen.findByText('Destacadas')).toBeInTheDocument()
    const destacadas = screen.getByText('Destacadas')
    const fijada = screen.getByText('nota fijada')
    const normal = screen.getByText('nota normal')
    expect(destacadas.compareDocumentPosition(fijada) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(fijada.compareDocumentPosition(normal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('pinning a note calls tripsApi.pinNote', async () => {
    vi.mocked(tripsApi.listNotes).mockResolvedValue([note])
    vi.mocked(tripsApi.pinNote).mockResolvedValue({ ok: true, pinned: true })
    renderSlideOver(baseTrip)
    await screen.findByText('Conductor confirmó por teléfono')
    fireEvent.click(screen.getByTitle('Destacar nota'))
    await waitFor(() => expect(tripsApi.pinNote).toHaveBeenCalledWith('t1', 'n1', true))
  })

  it('renders system events as compact one-line entries without a pin control', async () => {
    vi.mocked(tripsApi.listNotes).mockResolvedValue([
      { ...note, id: 'n3', note_type: 'sistema', body: 'Estableció estado operativo manual: en_seguimiento' },
    ])
    renderSlideOver(baseTrip)
    expect(await screen.findByText(/estableció estado operativo manual/)).toBeInTheDocument()
    expect(screen.queryByTitle('Destacar nota')).not.toBeInTheDocument()
  })

  it('filters the feed by note type', async () => {
    vi.mocked(tripsApi.listNotes).mockResolvedValue([
      { ...note, id: 'n1', note_type: 'llamada', body: 'nota de llamada' },
      { ...note, id: 'n2', note_type: 'incidente', body: 'nota de incidente' },
    ])
    renderSlideOver(baseTrip)
    await screen.findByText('nota de llamada')
    fireEvent.click(screen.getAllByText('Incidente')[0])
    expect(screen.queryByText('nota de llamada')).not.toBeInTheDocument()
    expect(screen.getByText('nota de incidente')).toBeInTheDocument()
  })

  it('renders attachments and lists them in the Documentos view', async () => {
    vi.mocked(tripsApi.listNotes).mockResolvedValue([
      {
        ...note,
        attachments: [{ id: 'a1', file_name: 'guia.pdf', mime_type: 'application/pdf', size_bytes: 2048, url: 'https://signed/x' }],
      },
    ])
    renderSlideOver(baseTrip)
    expect(await screen.findByText('guia.pdf')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Documentos'))
    expect(screen.getByText('guia.pdf')).toBeInTheDocument()
    expect(screen.getByText(/2 KB/)).toBeInTheDocument()
  })

  it('attaching a file enables sending a note without body', async () => {
    vi.mocked(tripsApi.addNote).mockResolvedValue({
      ...note, id: 'n9', body: '',
      attachments: [{ id: 'a2', file_name: 'foto.png', mime_type: 'image/png', size_bytes: 10, url: 'https://signed/y' }],
    })
    renderSlideOver(baseTrip)
    const file = new File(['x'], 'foto.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Adjuntar archivos'), { target: { files: [file] } })
    expect(await screen.findByText('foto.png')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Agregar nota'))
    await waitFor(() =>
      expect(tripsApi.addNote).toHaveBeenCalledWith('t1', { body: '', note_type: 'observacion', files: [file] }))
  })
})

describe('TripSlideOver — campos híbridos de fecha (Carga/Desc. Inicio-Fin) — tabla técnica siempre visible', () => {
  it('saves Carga inicio of the ORIGIN stop via tripsApi.patchStop on blur', async () => {
    vi.mocked(tripsApi.patchStop).mockResolvedValue(baseTrip)
    const stops = [makeStop({ stop_id: 'origin1', local: 'CD Origen', stop_type: 'ORIGIN' })]
    renderSlideOver({ ...baseTrip, stops })
    const input = screen.getByLabelText('Carga inicio de CD Origen') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2026-07-17T09:00' } })
    fireEvent.blur(input)
    await waitFor(() =>
      expect(tripsApi.patchStop).toHaveBeenCalledWith('t1', 'origin1', { desc_inicio: '2026-07-17T09:00' }))
  })

  it('saves Carga fin of the ORIGIN stop via tripsApi.patchStop on blur', async () => {
    vi.mocked(tripsApi.patchStop).mockResolvedValue(baseTrip)
    const stops = [makeStop({ stop_id: 'origin1', local: 'CD Origen', stop_type: 'ORIGIN' })]
    renderSlideOver({ ...baseTrip, stops })
    const input = screen.getByLabelText('Carga fin de CD Origen') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2026-07-17T09:30' } })
    fireEvent.blur(input)
    await waitFor(() =>
      expect(tripsApi.patchStop).toHaveBeenCalledWith('t1', 'origin1', { desc_fin: '2026-07-17T09:30' }))
  })

  it('shows an ORIGEN badge for the origin stop in the technical table', () => {
    const stops = [makeStop({ stop_id: 'origin1', local: 'CD Origen', stop_type: 'ORIGIN' })]
    renderSlideOver({ ...baseTrip, stops })
    expect(screen.getAllByText('ORIGEN').length).toBeGreaterThan(0)
  })

  it('saves Desc. inicio of a stop via tripsApi.patchStop on blur', async () => {
    vi.mocked(tripsApi.patchStop).mockResolvedValue(baseTrip)
    const stops = [makeStop({ stop_id: 's1', local: 'Local 1' })]
    renderSlideOver({ ...baseTrip, stops })
    const input = screen.getByLabelText('Desc. inicio de Local 1') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2026-07-17T10:00' } })
    fireEvent.blur(input)
    await waitFor(() =>
      expect(tripsApi.patchStop).toHaveBeenCalledWith('t1', 's1', { desc_inicio: '2026-07-17T10:00' }))
  })

  it('marks a stop\'s Desc. inicio/fin inputs as manual when desc_manual is true', () => {
    const stops = [makeStop({ stop_id: 's1', local: 'Local 1', desc_manual: true })]
    renderSlideOver({ ...baseTrip, stops })
    const input = screen.getByLabelText('Desc. inicio de Local 1') as HTMLInputElement
    expect(input.className).toMatch(/text-accent/)
  })
})

describe('TripSlideOver — clasificación RM/Zona Cero por parada (H2.6, catálogo de locales)', () => {
  it('shows the classification badge next to a stop in the technical table when operation_type resolved', () => {
    const stops = [makeStop({ stop_id: 's1', local: 'ALAMEDA - 72', operation_type: 'RM' })]
    const meta = {
      statuses: [], tms_sources: [], operational_states: [], alert_thresholds: [], csv_columns: [],
      temperature_ranges: [], unassigned_reasons: [],
      operation_types: [{ id: 'RM', label: 'RM', bg_color: '#e8eeff', text_color: '#053bfa' }],
    }
    renderSlideOver({ ...baseTrip, stops }, { meta: meta as never })
    expect(screen.getByText('RM')).toBeInTheDocument()
  })

  it('does not show a classification badge when the stop has no operation_type resolved', () => {
    const stops = [makeStop({ stop_id: 's1', local: 'CD LO AGUIRRE', operation_type: null })]
    renderSlideOver({ ...baseTrip, stops })
    expect(screen.queryByText('RM')).not.toBeInTheDocument()
  })
})

describe('TripSlideOver — Ubicación de origen (solo operation_type, sin región/ciudad)', () => {
  const metaWithOpTypes = {
    statuses: [], tms_sources: [], operational_states: [], alert_thresholds: [], csv_columns: [],
    temperature_ranges: [], unassigned_reasons: [],
    operation_types: [{ id: 'RM', label: 'RM', bg_color: '#e8eeff', text_color: '#053bfa' }],
  } as never

  it('shows the operation_type badge when resolved', () => {
    renderSlideOver({ ...baseTrip, origin_operation_type: 'RM' }, { meta: metaWithOpTypes })
    expect(screen.getByText('RM')).toBeInTheDocument()
  })

  it('shows "Sin clasificar" instead of an empty section when origin_operation_type is null', () => {
    renderSlideOver({ ...baseTrip, origin_operation_type: null })
    expect(screen.getByText('Sin clasificar')).toBeInTheDocument()
  })

  it('no longer shows a región/ciudad picker for the origin', () => {
    renderSlideOver(baseTrip)
    expect(screen.queryByLabelText('Región de origen')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Ciudad de origen')).not.toBeInTheDocument()
  })
})

describe('TripSlideOver — motivo de no asignación (Fase 1.5d)', () => {
  const metaWithReasons = {
    statuses: [], tms_sources: [], operational_states: [], alert_thresholds: [],
    csv_columns: [], temperature_ranges: [],
    unassigned_reasons: [{ id: 'pana', label: 'Pana' }, { id: 'sin_conductor', label: 'Sin conductor' }],
  } as never

  it('shows the reason dropdown when the trip is not is_assigned and saves via tripsApi.patch', async () => {
    vi.mocked(tripsApi.patch).mockResolvedValue(baseTrip)
    renderSlideOver({ ...baseTrip, is_assigned: false }, { meta: metaWithReasons })

    fireEvent.change(screen.getByDisplayValue('— Sin especificar —'), { target: { value: 'pana' } })

    await waitFor(() =>
      expect(tripsApi.patch).toHaveBeenCalledWith('t1', { unassigned_reason_id: 'pana' }))
  })

  it('hides the reason dropdown once the trip is is_assigned', () => {
    renderSlideOver({ ...baseTrip, is_assigned: true }, { meta: metaWithReasons })
    expect(screen.queryByText('Motivo de no asignación')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Correr los tests y confirmar que fallan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/TripSlideOver.test.tsx`
Expected: FAIL — el componente actual todavía tiene `RouteProgress` (ya borrado, así que esto ya rompe la importación), acordeones, `CarrierAssignSection`, footer con el UUID, `RegionCityPicker` de origen, y "EETT TMS".

- [ ] **Step 4: Reescribir `TripSlideOver.tsx` completo**

Reemplazar `monitor-app/frontend/components/dashboard/TripSlideOver.tsx` completo:

```tsx
'use client'

import { useState, useEffect, useRef } from 'react'
import {
  X, Loader2, Copy, Check,
  Truck, User, Phone, Hash,
  MapPin, RotateCcw, ClipboardList,
} from 'lucide-react'
import type { Trip, TripsMeta } from '@/lib/types'
import { tripsApi, type TripPatch } from '@/lib/api/trips'
import { getLatestTemp, stopWasVisited, classifyTemperature, getActiveStop, describeStopTiming } from '@/lib/utils/temperature'
import { stopComplianceSummary } from '@/lib/utils/compliance'
import { fmtDT, fmtDate, formatRelativeTime, toDatetimeLocalValue } from '@/lib/utils/datetime'
import { TMS_LOGIN_URLS } from '@/lib/utils/tmsLinks'
import { StopTimeline } from './StopTimeline'
import { IndicatorDots } from './IndicatorDots'
import { TripNotesFeed } from './TripNotesFeed'
import { FleetAssignSection, EMPTY_FLEET_ASSIGN_VALUE, type FleetAssignValue } from './FleetAssignSection'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { OperationTypeBadge } from '@/components/ui/OperationTypeBadge'

// ── MetaField helper ──────────────────────────────────────────────────────────

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

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  trip:    Trip | null
  onClose: () => void
  onSaved: (updated: Trip) => void
  meta?:   TripsMeta | null
}

export function TripSlideOver({ trip, onClose, onSaved, meta }: Props) {
  const [estadoDraft, setEstadoDraft]           = useState('')
  const [saving, setSaving]                     = useState(false)
  const [err, setErr]                           = useState<string | null>(null)
  const [copiedField, setCopiedField]           = useState<'external' | 'internal' | null>(null)
  const [showEstadoSelect, setShowEstadoSelect] = useState(false)
  const [clearingOverride, setClearingOverride] = useState(false)
  const [reasonSaving, setReasonSaving]         = useState(false)
  const [unlinkErr, setUnlinkErr]               = useState<string | null>(null)
  const [unlinking, setUnlinking]               = useState(false)
  // Conductor→empresa/vehículo (FleetAssignSection, driver-first) — solo
  // importa mientras el viaje no tiene carrier_id (rama "vincular"); la rama
  // "ya vinculado" muestra una tarjeta compacta aparte, sin usar este draft.
  const [fleetDraft, setFleetDraft]             = useState<FleetAssignValue>(EMPTY_FLEET_ASSIGN_VALUE)
  const [assigningFleet, setAssigningFleet]     = useState(false)
  const [fleetErr, setFleetErr]                 = useState<string | null>(null)
  const panelRef                                = useRef<HTMLDivElement>(null)

  // Semántica de diálogo: Escape cierra, Tab queda atrapado en el panel, el foco vuelve al origen al cerrar
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

  useEffect(() => {
    if (!trip) return
    setEstadoDraft('')
    setErr(null)
    setCopiedField(null)
    setShowEstadoSelect(false)
    setUnlinkErr(null)
    setFleetDraft(EMPTY_FLEET_ASSIGN_VALUE)
    setFleetErr(null)
  }, [trip?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Desc. Inicio/Fin (esquema de fechas 2026-07-17): override manual de lo
  // que reporta el TMS por parada — incluye el origen desde que se unificó
  // como parada 0 (Fase 1, 2026-07-18; antes vivía aparte como
  // trip.cag_inicio_at/cag_fin_at, "Carga Inicio/Fin"). Guardado directo al
  // cambiar, sin botón aparte — mismo patrón que onExpirationChange en
  // DocumentChecklist.
  const [stopSaving, setStopSaving] = useState<string | null>(null)

  async function handleStopFieldChange(stopId: string, field: 'desc_inicio' | 'desc_fin', value: string) {
    if (!trip) return
    setStopSaving(stopId)
    try {
      const updated = await tripsApi.patchStop(trip.id, stopId, { [field]: value })
      onSaved(updated)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setStopSaving(null)
    }
  }

  async function handleSetOverride() {
    if (!trip || !estadoDraft) return
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
    if (!trip) return
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

  function handleCopy(field: 'external' | 'internal', value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    })
  }

  async function handleUnlink() {
    if (!trip) return
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
    if (!trip || !fleetDraft.carrier_id) return
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

  if (!trip) return null

  const currentStatus = trip.manual_status ?? trip.current_status
  const tmsMeta       = trip.source_system ? meta?.tms_sources.find(t => t.id === trip.source_system.toLowerCase()) : null
  const tmsLabel      = tmsMeta?.label ?? trip.source_system?.toUpperCase().slice(0, 3) ?? '?'
  const tmsLoginUrl   = trip.source_system && trip.source_system !== 'manual' ? TMS_LOGIN_URLS[trip.source_system.toLowerCase()] : undefined
  const temp          = getLatestTemp(trip.stops ?? [])
  const tempStatus    = classifyTemperature(temp, trip.cargo_type, meta?.temperature_ranges ?? [])

  // Hero: la historia del viaje de un vistazo. `stops` incluye el origen
  // (Fase 1, 2026-07-18) — se pasa completo al timeline (ahí SÍ tiene que
  // aparecer como nodo 0), pero el conteo "N/M paradas" usa solo destinos:
  // "parada" en el vocabulario del equipo operativo significa destino de
  // entrega, no el punto de carga.
  const stops            = trip.stops ?? []
  const destinationStops = stops.filter(s => s.stop_type !== 'ORIGIN')
  const activeStop  = getActiveStop(stops)
  const activeTiming = activeStop ? describeStopTiming(activeStop) : null
  const doneCount   = destinationStops.filter(s => s.arrival_date || s.gps_arrival_date || s.on_time_status).length
  const compliance  = stopComplianceSummary(stops)
  const tmsSince    = formatRelativeTime(trip.status_reported_at)
  const syncSince   = formatRelativeTime(trip.pipeline_updated_at)

  // Reconciliación TMS↔manual (Fase 1.5b, extendida a empresa en Fase 2 Plan
  // 4): si hay vínculo manual y el TMS reporta conductor/patente/empresa
  // distinta a lo vinculado, avisar y ofrecer revertir — nunca sobrescribir
  // automáticamente. EETT TMS (antes en "Datos operativos") se retiró porque
  // esta es la única función real que cumplía: detectar cuándo la empresa
  // vinculada diverge de lo que reporta la TMS.
  const driverDiverges  = !!(trip.driver_name_tms && trip.driver_name_tms !== trip.driver_name)
  const tractorDiverges = !!(trip.tractor_plate_tms && trip.tractor_plate_tms !== trip.tractor_plate)
  const carrierDiverges = !!(trip.carrier_name_tms && trip.carrier_name_tms !== trip.carrier_name)
  const hasReconciliationDivergence = !!trip.fleet_link_id && (driverDiverges || tractorDiverges || carrierDiverges)

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Detalle de viaje ${trip.source_system_trip_id ?? trip.tractor_plate ?? ''}`}
        tabIndex={-1}
        className="fixed inset-0 z-50 flex flex-col bg-white
                      md:inset-4
                      md:rounded-2xl md:shadow-2xl overflow-hidden focus:outline-none animate-modal-in"
      >

        {/* ── Header — 1 fila compacta: identidad del viaje ─────────── */}
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

          {/* IDs unificados: externo (con copiar, ya existía) + interno
              (con copiar, antes vivía solo — casi invisible — en un footer
              que ya no existe) — un solo lugar para "los IDs de este viaje". */}
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
            onClick={onClose}
            className="text-white/50 hover:text-white transition-colors shrink-0 p-1 rounded-lg hover:bg-white/10 ml-auto"
            aria-label="Cerrar detalle"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Hero — la historia del viaje ──────────────────────────── */}
        <div className="px-4 py-3 md:px-6 border-b border-border bg-gray-50/80 shrink-0 space-y-2">
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

          {/* Gestión por excepción: solo se badgea lo que está mal (OFF TIME,
              temp fuera de rango) — lo demás es texto plano discreto. La
              barra de puntos RouteProgress se retiró (Fase 2, Plan 4) — era
              la 3ª representación de la misma secuencia de paradas junto a
              StopTimeline (Ruta) y la tabla técnica; este texto ya comunica
              el vistazo rápido sin un gráfico aparte. */}
          <div className="flex items-center gap-2.5 flex-wrap text-[11px] text-gray-500">
            {destinationStops.length > 0 && (
              <span>{doneCount}/{destinationStops.length} paradas</span>
            )}
            {compliance === 'warn' && (
              <span className="font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full text-[10px]">OFF TIME</span>
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

        {/* ── Body — 2 columnas en desktop, apilado en mobile (Gestión primero) ── */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">

          {/* Columna derecha en desktop / primera en mobile: GESTIÓN */}
          <aside className="order-1 md:order-2 md:w-[360px] md:shrink-0 md:overflow-y-auto md:border-l border-border bg-accent/[0.03] p-4 md:p-5 space-y-5">
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
                  {/* Microcopy (Fase 2, Plan 4): sin override, este badge y el
                      del hero muestran el mismo dato — antes no había nada
                      que lo explicara. */}
                  <p className="text-[9px] text-gray-400 mt-1">
                    Es el mismo estado que se muestra en el encabezado — acá podés confirmarlo manualmente si hace falta.
                  </p>
                </>
              )}

              {err && (
                <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-2">{err}</p>
              )}
            </div>

            {/* Indicadores — el rediseño a switches con etiqueta es el
                Plan 5; acá sigue siendo IndicatorDots sin cambios. */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Indicadores</p>
              <IndicatorDots trip={trip} onSaved={onSaved} size="md" />
            </div>

            {/* Motivo de no asignación — movido después de Indicadores (Fase
                2, Plan 4): es el mismo concepto causal que el switch
                "Asignado" de arriba, antes vivían en bloques sin relación
                visual. Catálogo editable en app.unassigned_reasons. */}
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

            {/* Conductor y flota — driver-first (Fase 2, Plan 4). Antes
                "Empresa transportista" con CarrierAssignSection (búsqueda
                de empresa primero, roster de conductor/tracto en
                dropdowns) — mismo bug de fondo que motivó toda esta Fase:
                una superficie de búsqueda propia en vez de reusar
                DriverSearchPicker. Ahora FleetAssignSection (compartido con
                TripAssignDialog, Plan 3) cubre la búsqueda + autocompletado
                editable; "Vincular" solo llama a la API cuando el operador
                confirma. */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                <User size={10} /> Conductor y flota
              </p>
              {trip.carrier_id ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2.5 border border-border/80 shadow-sm">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 truncate">{trip.carrier_name ?? '—'}</p>
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
                  <FleetAssignSection
                    value={fleetDraft}
                    onChange={setFleetDraft}
                    size="sm"
                    notFoundHint={
                      <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-2">
                        Si no aparece en la lista, hay que darlo de alta primero en{' '}
                        <a href="/dashboard/transportistas" className="underline font-semibold">Empresas</a>.
                      </p>
                    }
                  />
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

            {/* Ubicación de origen — solo operation_type (Fase 2, Plan 4).
                Región/ciudad (RegionCityPicker) se retiró por completo:
                origin_operation_type es el dato real/automático, la
                asignación manual de respaldo competía visualmente con él
                sin aportar. "Sin clasificar" explícito en vez de una
                sección vacía cuando OperationTypeBadge no tiene nada que
                mostrar (retorna null si operationType es falsy). */}
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

            {/* Datos operativos — antes acordeón colapsado en la columna
                principal (Fase 2, Plan 4): se aplana y se muda acá, es la
                sección que menos ancho horizontal necesita. EETT TMS se
                retira — su única función real (divergencia de empresa) la
                cubre ahora el banner de reconciliación de arriba. */}
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
          </aside>

          {/* Columna izquierda en desktop / segunda en mobile: RUTA + BITÁCORA */}
          <div className="order-2 md:order-1 flex-1 min-w-0 md:overflow-y-auto p-4 md:p-6 space-y-5">
            {stops.length > 0 && (
              <section>
                <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <MapPin size={11} /> Ruta ({stops.length} parada{stops.length === 1 ? '' : 's'})
                </h4>
                <StopTimeline stops={stops} />

                {/* Tabla técnica — siempre visible (Fase 2, Plan 4: acordeón
                    "Ver detalle técnico" retirado). No se reemplaza por
                    RouteEditor (el de creación): no existe endpoint para
                    agregar/quitar/renombrar paradas de un viaje ya
                    existente, y el timeline GPS/SAP es exclusivo del
                    detalle por diseño (decisión #2 del spec). */}
                <div className="overflow-x-auto mt-3 -mx-4 md:-mx-6">
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
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.arrival_date)}</td>
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.departure_date)}</td>
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.gps_arrival_date)}</td>
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.gps_departure_date)}</td>
                              <td className="px-2 py-1">
                                <input
                                  key={`${stop.stop_id}-desc_inicio-${stop.unload_start ?? ''}`}
                                  type="datetime-local"
                                  aria-label={`${opLabel} inicio de ${stop.local ?? 'parada'}`}
                                  defaultValue={toDatetimeLocalValue(stop.unload_start)}
                                  onBlur={e => e.target.value && stop.stop_id && handleStopFieldChange(stop.stop_id, 'desc_inicio', e.target.value)}
                                  disabled={stopSaving === stop.stop_id}
                                  className={`w-full text-[10px] font-mono border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-accent/30 bg-white disabled:opacity-50 ${stop.desc_manual ? 'border-accent/40 text-accent' : 'border-border text-gray-500'}`}
                                />
                              </td>
                              <td className="px-2 py-1">
                                <input
                                  key={`${stop.stop_id}-desc_fin-${stop.unload_end ?? ''}`}
                                  type="datetime-local"
                                  aria-label={`${opLabel} fin de ${stop.local ?? 'parada'}`}
                                  defaultValue={toDatetimeLocalValue(stop.unload_end)}
                                  onBlur={e => e.target.value && stop.stop_id && handleStopFieldChange(stop.stop_id, 'desc_fin', e.target.value)}
                                  disabled={stopSaving === stop.stop_id}
                                  className={`w-full text-[10px] font-mono border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-accent/30 bg-white disabled:opacity-50 ${stop.desc_manual ? 'border-accent/40 text-accent' : 'border-border text-gray-500'}`}
                                />
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
              </section>
            )}

            {/* Bitácora — full width (Fase 2, Plan 4: se muda desde el aside
                de Gestión de 360px). TripNotesFeed en sí no se toca acá —
                su max-h-80 interno y el retiro del texto legacy son del
                Plan 5. */}
            <section>
              <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Bitácora</h4>
              <TripNotesFeed trip={trip} />
            </section>
          </div>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 5: Correr los tests y confirmar que pasan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/TripSlideOver.test.tsx`
Expected: todos pasan (48 tests).

- [ ] **Step 6: `tsc` limpio y suite completa**

Run: `cd monitor-app/frontend && npx tsc --noEmit && npm test`
Expected: sin errores de tipos (confirma que ya no queda ninguna referencia a `RouteProgress`); toda la suite de vitest pasa sin regresiones.

- [ ] **Step 7: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/frontend/components/dashboard/TripSlideOver.tsx monitor-app/frontend/components/dashboard/TripSlideOver.test.tsx
git rm monitor-app/frontend/components/dashboard/RouteProgress.tsx
git commit -m "feat(diario): TripSlideOver reconstruido — secciones aplanadas, FleetAssignSection, IDs unificados, RouteProgress retirado"
```

---

## Self-Review

**1. Cobertura del spec**: cubre "TripSlideOver — secciones aplanadas" completo (acordeones eliminados, columna Gestión reordenada, EETT TMS retirado + banner extendido a `carrier_name_tms`, Ubicación de origen solo `operation_type` con "Sin clasificar", link a la TMS colgando del chip, IDs unificados en el header) y "`RouteProgress` se retira" completo (borrado del archivo, del import, del uso en el hero, `StopTimeline` queda como único timeline). No cubre — a propósito, son Plan 5 — el rediseño de Indicadores a switches ni los cambios de `TripNotesFeed` (ancho ya resuelto acá, contenido/incidentes no).
**2. Placeholders**: ninguno — Task 2 reescribe ambos archivos completos, sin fragmentos parciales.
**3. Consistencia de tipos**: `FleetAssignValue`/`EMPTY_FLEET_ASSIGN_VALUE` importados tal cual los exporta `FleetAssignSection.tsx` (Plan 2/3, ya commiteado); el payload de `handleAssignFleet` usa exactamente los campos de `FleetLinkPayload` (`carrier_id`, `driver_id?`, `tractor_asset_id?`, `driver_name?`, `tractor_plate?`) verificados contra `lib/api/trips.ts` real; `TMS_LOGIN_URLS` (Task 1) se consume en Task 2 con el mismo nombre exportado.
**4. Alcance**: la nota de la Task 2 documenta explícitamente por qué `RouteEditor` no se integra acá (sin endpoint de backend para editar paradas de un viaje existente, decisión #2 del spec reserva el timeline GPS al detalle) — evita que un ejecutor futuro intente esa integración por una lectura literal de una frase ambigua del spec.
**5. Riesgo real identificado**: el caso "empresa vinculada sin conductor" (posible en datos históricos, ~8% de los vínculos según la Ronda 18) sigue mostrando la tarjeta compacta simple (sin `FleetAssignSection`, que gatea en `driver_id`) — comportamiento idéntico al de hoy, sin regresión, documentado en el diseño de la Task 2 en vez de ignorado.
**6. Orden entre tasks**: Task 1 (`TMS_LOGIN_URLS`) es prerrequisito real de Task 2 (el nuevo `TripSlideOver.tsx` la importa desde el primer render) — deben ejecutarse en ese orden.
