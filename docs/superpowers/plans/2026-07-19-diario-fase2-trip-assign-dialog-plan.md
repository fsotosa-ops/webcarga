# Diario Fase 2 — TripAssignDialog Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruir `TripAssignDialog` (el diálogo de "Nuevo Viaje") sobre los 3 componentes compartidos del Plan 2 (`RouteEditor`, `FleetAssignSection`, `ClientPicker`), cerrando el bug original de la sesión (la patente no se sincronizaba de forma confiable) y alineando el formulario de creación al mismo contrato de datos que ya usa el detalle del viaje.

**Architecture:** Reemplazo estructural de `TripAssignDialog.tsx` — mismo diálogo centrado, misma semántica de foco/Escape/Tab-trap, pero el estado interno pasa de 6 piezas dispersas (`clientChoice`/`clientOther`/`stops` sin origen/`pickedDriver`/campos sueltos de empresa-vehículo) a 4 piezas alineadas 1:1 con los 3 componentes compartidos (`clientName: string`, `stops: TripStopCreatePayload[]` con origen incluido, `fleet: FleetAssignValue`) + el estado ya existente de "sistema de origen" (sin cambios). Requiere un ajuste chico y previo en `FleetAssignSection` (Plan 2) para exponer un hueco de contenido condicional (`notFoundHint`) que hoy vive hardcodeado en `TripAssignDialog`.

**Tech Stack:** Next.js 16 / React, TanStack Query, Vitest + Testing Library.

## Global Constraints

- `docs/superpowers/plans/2026-07-19-diario-fase2-backend-foundations-plan.md` (Plan 1, ya commiteado) y el Plan 2 de componentes compartidos (ya commiteado) **no se pushean solos** — este plan es el que finalmente conecta todo. Al terminar este plan, confirmar con el usuario antes de cualquier `git push` (puede ser el momento de pushear los 3 juntos).
- `npx tsc --noEmit` y `npm test` (vitest) limpios al final de cada task.
- Reusar los estilos/clases Tailwind ya establecidos (`INPUT`, tamaños de fuente, paleta ámbar/accent ya usada para avisos) — no introducir un sistema de diseño paralelo.
- Sin verificación en navegador (SSO real, sin credenciales de test en este entorno) — cubierto con tests de componente + `tsc`/build.

---

### Task 1: `FleetAssignSection` gana `notFoundHint`

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/FleetAssignSection.tsx` (componente del Plan 2, ya commiteado)
- Modify: `monitor-app/frontend/components/dashboard/FleetAssignSection.test.tsx`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `FleetAssignSection` gana el prop `notFoundHint?: React.ReactNode`, mostrado bajo `DriverSearchPicker` cuando el query interno del componente tiene ≥2 caracteres y no hay conductor elegido. Task 3 de este plan lo consume.

- [ ] **Step 1: Escribir los tests que fallan**

En `monitor-app/frontend/components/dashboard/FleetAssignSection.test.tsx`, la función `Harness` pasa de:

```tsx
function Harness({
  initial = EMPTY_FLEET_ASSIGN_VALUE, onChangeSpy, suggested,
}: {
  initial?: FleetAssignValue
  onChangeSpy?: (v: FleetAssignValue) => void
  suggested?: React.ComponentProps<typeof FleetAssignSection>['suggested']
}) {
  const [value, setValue] = useState<FleetAssignValue>(initial)
  return (
    <Wrapper>
      <FleetAssignSection value={value} onChange={v => { setValue(v); onChangeSpy?.(v) }} suggested={suggested} />
    </Wrapper>
  )
}
```

A:

```tsx
function Harness({
  initial = EMPTY_FLEET_ASSIGN_VALUE, onChangeSpy, suggested, notFoundHint,
}: {
  initial?: FleetAssignValue
  onChangeSpy?: (v: FleetAssignValue) => void
  suggested?: React.ComponentProps<typeof FleetAssignSection>['suggested']
  notFoundHint?: React.ComponentProps<typeof FleetAssignSection>['notFoundHint']
}) {
  const [value, setValue] = useState<FleetAssignValue>(initial)
  return (
    <Wrapper>
      <FleetAssignSection
        value={value}
        onChange={v => { setValue(v); onChangeSpy?.(v) }}
        suggested={suggested}
        notFoundHint={notFoundHint}
      />
    </Wrapper>
  )
}
```

Y al final del `describe('FleetAssignSection', ...)`, agregar (antes del cierre `})`):

```tsx
  it('shows the notFoundHint once the search query reaches 2 characters', () => {
    render(<Harness notFoundHint={<p>Alta en Empresas</p>} />)
    fireEvent.change(screen.getByLabelText('Buscar conductor'), { target: { value: 'Na' } })
    expect(screen.getByText('Alta en Empresas')).toBeInTheDocument()
  })

  it('does not show the notFoundHint below 2 characters', () => {
    render(<Harness notFoundHint={<p>Alta en Empresas</p>} />)
    fireEvent.change(screen.getByLabelText('Buscar conductor'), { target: { value: 'N' } })
    expect(screen.queryByText('Alta en Empresas')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/FleetAssignSection.test.tsx`
Expected: FAIL en los 2 tests nuevos — `notFoundHint` no existe todavía como prop, `Harness` lo ignora silenciosamente (TypeScript se queja, y el texto nunca se renderiza).

- [ ] **Step 3: Agregar el prop `notFoundHint`**

En `monitor-app/frontend/components/dashboard/FleetAssignSection.tsx`, la interfaz `Props` pasa de:

```tsx
interface Props {
  value:           FleetAssignValue
  onChange:        (value: FleetAssignValue) => void
  /** Ej: conductores disponibles hoy (tripsApi.availableDrivers) — mostrado
   *  cuando el campo de búsqueda está vacío, mismo patrón de DriverSearchPicker. */
  suggested?:      DriverPickCandidate[]
  suggestedLabel?: string
  size?:           'sm' | 'md'
}
```

A:

```tsx
interface Props {
  value:           FleetAssignValue
  onChange:        (value: FleetAssignValue) => void
  /** Ej: conductores disponibles hoy (tripsApi.availableDrivers) — mostrado
   *  cuando el campo de búsqueda está vacío, mismo patrón de DriverSearchPicker. */
  suggested?:      DriverPickCandidate[]
  suggestedLabel?: string
  size?:           'sm' | 'md'
  /** Mostrado bajo la búsqueda cuando el operador tipeó ≥2 caracteres y
   *  todavía no eligió un conductor — cada consumidor pasa su propio texto
   *  (ej. TripAssignDialog explica que bloquea la creación del viaje). El
   *  componente no expone su estado de búsqueda interno al padre, así que
   *  esta es la única forma de condicionar contenido según ese estado. */
  notFoundHint?:   React.ReactNode
}
```

Y `export function FleetAssignSection({ value, onChange, suggested = [], suggestedLabel, size = 'md' }: Props) {` pasa a:

```tsx
export function FleetAssignSection({ value, onChange, suggested = [], suggestedLabel, size = 'md', notFoundHint }: Props) {
```

El bloque de retorno para "sin conductor elegido" (`if (!value.driver_id) { return ( <DriverSearchPicker ... /> ) }`) pasa de:

```tsx
  if (!value.driver_id) {
    return (
      <DriverSearchPicker
        query={query}
        onQueryChange={setQuery}
        onPick={pick}
        suggested={suggested}
        suggestedLabel={suggestedLabel}
      />
    )
  }
```

A:

```tsx
  if (!value.driver_id) {
    return (
      <div>
        <DriverSearchPicker
          query={query}
          onQueryChange={setQuery}
          onPick={pick}
          suggested={suggested}
          suggestedLabel={suggestedLabel}
        />
        {notFoundHint && query.trim().length >= 2 && notFoundHint}
      </div>
    )
  }
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/FleetAssignSection.test.tsx`
Expected: 8 passed (6 anteriores + 2 nuevos).

- [ ] **Step 5: `tsc` limpio**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/frontend/components/dashboard/FleetAssignSection.tsx monitor-app/frontend/components/dashboard/FleetAssignSection.test.tsx
git commit -m "feat(diario): FleetAssignSection — notFoundHint configurable por el consumidor"
```

---

### Task 2: `TripAssignDialog` reconstruido sobre `RouteEditor`/`FleetAssignSection`/`ClientPicker`

**Files:**
- Modify: `monitor-app/frontend/lib/types.ts` (`TripCreatePayload` pierde `origin`)
- Modify: `monitor-app/frontend/components/dashboard/TripAssignDialog.tsx` (reescritura completa)
- Modify: `monitor-app/frontend/components/dashboard/TripAssignDialog.test.tsx` (reescritura completa)

**Interfaces:**
- Consumes: `RouteEditor` (`stops`/`onChange`, Plan 2), `FleetAssignSection` (`value`/`onChange`/`suggested`/`suggestedLabel`/`notFoundHint`, Plan 2 + Task 1 de este plan), `ClientPicker` (`value`/`onChange`, Plan 2), `TripStopCreatePayload.stop_type` (Plan 2).
- Produces: `TripAssignDialog` sigue exponiendo la misma interfaz pública (`open`/`onClose`/`onCreated`/`meta`/`fecha`) — sin cambios para quien lo usa desde `page.tsx`.

- [ ] **Step 1: Quitar `origin` de `TripCreatePayload`**

En `monitor-app/frontend/lib/types.ts`, `TripCreatePayload` (línea 314) pierde la línea `origin?: string | null` (confirmado sin otros usos en el frontend — solo `TripAssignDialog.tsx` lo usaba, y este mismo task lo deja de usar):

```typescript
export type TripCreatePayload = {
  planning_date:          string
  /** Sistema de ORIGEN del viaje (TMS mapeado, texto libre o null) — el canal
   *  de ingreso es siempre 'manual' (lo fuerza el backend) */
  origin_tms?:            string | null
  source_system_trip_id?: string | null
  client_name?:           string | null
  origin_region?:         string | null
  origin_city?:            string | null
  cargo_type?:            string | null
  current_status?:        string | null
  stops?:                 TripStopCreatePayload[]
  tractor_plate?:         string | null
  trailer_plate?:         string | null
  driver_name?:           string | null
  driver_rut?:            string | null
  driver_phone?:          string | null
  transporter_name?:      string | null
  carrier_id?:            string | null
  driver_id?:             string | null
  tractor_asset_id?:      string | null
  trailer_asset_id?:      string | null
}
```

(nota: `origin_region`/`origin_city` **no se tocan** — siguen siendo campos válidos del tipo, los usa `TripBulkUpload.tsx`/la carga CSV, fuera de alcance de este plan; lo único que cambia es que `TripAssignDialog` deja de mostrarlos y de mandarlos)

- [ ] **Step 2: Reescribir `TripAssignDialog.test.tsx` completo**

Reemplazar `monitor-app/frontend/components/dashboard/TripAssignDialog.test.tsx` completo:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TripAssignDialog } from './TripAssignDialog'
import { tripsApi } from '@/lib/api/trips'
import { driversApi } from '@/lib/api/drivers'
import { shippersApi } from '@/lib/api/locations'
import type { TripsMeta } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { create: vi.fn(), availableDrivers: vi.fn() },
}))
vi.mock('@/lib/api/drivers', () => ({
  driversApi: { search: vi.fn() },
}))
vi.mock('@/lib/api/locations', () => ({
  shippersApi: { list: vi.fn(), create: vi.fn() },
}))

const meta: TripsMeta = {
  statuses: [{ id: 'ASIGNADO', label: 'ASIGNADO', bg_color: '#fff', text_color: '#000', group: 'otro' }],
  tms_sources: [
    { id: 'qanalytics', label: 'QA', bg_color: '#fff', text_color: '#000' },
    { id: 'manual', label: 'Manual', bg_color: '#fff', text_color: '#000' },
  ],
  operational_states: [], alert_thresholds: [], csv_columns: [], temperature_ranges: [], unassigned_reasons: [], operation_types: [],
}

function renderCreate(props: Partial<Parameters<typeof TripAssignDialog>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TripAssignDialog open onClose={vi.fn()} onCreated={vi.fn()} meta={meta} fecha="2026-07-18" {...props} />
    </QueryClientProvider>,
  )
}

/** La mayoría de los tests de este archivo necesitan un conductor elegido
 *  antes de poder enviar el form — Crear viaje queda disabled sin
 *  fleet.driver_id (Ronda 26, bloqueo driver-first). */
async function pickDriver() {
  vi.mocked(driversApi.search).mockResolvedValueOnce([{
    driver_id: 'd1', driver_name: 'Juan Pérez', driver_rut: '12345678-9', driver_phone: null,
    carrier_id: 'c1', carrier_name: 'Transportes Sur Spa', tractor_asset_id: 'a1', tractor_plate: 'ABCD12',
  }])
  fireEvent.change(screen.getByLabelText('Buscar conductor'), { target: { value: 'Juan' } })
  fireEvent.click(await screen.findByText('Juan Pérez'))
}

beforeEach(() => {
  vi.mocked(tripsApi.create).mockReset()
  vi.mocked(tripsApi.availableDrivers).mockReset().mockResolvedValue([])
  vi.mocked(driversApi.search).mockReset().mockResolvedValue([])
  vi.mocked(shippersApi.list).mockReset().mockResolvedValue([
    { id: 's1', name: 'Walmart', status: 'ACTIVE' },
  ] as never)
  vi.mocked(shippersApi.create).mockReset()
})

describe('TripAssignDialog', () => {
  it('has dialog semantics and closes with Escape', () => {
    const onClose = vi.fn()
    renderCreate({ onClose })
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('defaults planning_date to today', () => {
    renderCreate()
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
    expect(screen.getByDisplayValue(today)).toBeInTheDocument()
  })

  it('Crear viaje queda deshabilitado hasta elegir un conductor del directorio', () => {
    renderCreate()
    expect(screen.getByText('Crear viaje')).toBeDisabled()
  })

  it('picks a driver, autofills empresa/vehículo (editables), and sends driver_id + carrier_id + tractor_asset_id on create', async () => {
    vi.mocked(tripsApi.create).mockResolvedValue({ id: 't-new' } as never)
    renderCreate()

    await pickDriver()

    expect(screen.getByDisplayValue('Transportes Sur Spa')).toBeInTheDocument()
    expect(screen.getByDisplayValue('ABCD12')).toBeInTheDocument()
    expect(screen.getByText('Crear viaje')).not.toBeDisabled()

    fireEvent.click(screen.getByText('Crear viaje'))
    await waitFor(() => expect(tripsApi.create).toHaveBeenCalled())
    const payload = vi.mocked(tripsApi.create).mock.calls[0][0]
    expect(payload.driver_id).toBe('d1')
    expect(payload.carrier_id).toBe('c1')
    expect(payload.tractor_asset_id).toBe('a1')
    expect(payload.transporter_name).toBe('Transportes Sur Spa')
  })

  it('shows a warning with a link to Empresas when the driver search has no matches', async () => {
    renderCreate()
    fireEvent.change(screen.getByLabelText('Buscar conductor'), { target: { value: 'Nadie Real' } })
    expect(await screen.findByText(/no se puede crear el viaje sin un conductor vinculado/)).toBeInTheDocument()
  })

  it('lets clearing the picked driver ("Cambiar") to search again', async () => {
    renderCreate()
    await pickDriver()
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Cambiar'))
    expect(screen.getByLabelText('Buscar conductor')).toBeInTheDocument()
    expect(screen.getByText('Crear viaje')).toBeDisabled()
  })

  it('submits with Enter (form submit) y manda el origen y los destinos dentro de stops', async () => {
    vi.mocked(tripsApi.create).mockResolvedValue({ id: 't-new', planning_date: '2026-07-06' } as never)
    const onCreated = vi.fn()
    renderCreate({ onCreated })
    await pickDriver()

    fireEvent.change(screen.getByLabelText('Origen'), { target: { value: 'CD Lo Aguirre' } })
    fireEvent.click(screen.getByText('Agregar destino'))
    fireEvent.change(screen.getByLabelText('Nombre destino 1'), { target: { value: 'Local Maipú' } })

    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    await waitFor(() => expect(tripsApi.create).toHaveBeenCalled())
    const payload = vi.mocked(tripsApi.create).mock.calls[0][0]
    expect(payload.stops).toEqual([
      { local: 'CD Lo Aguirre', stop_type: 'ORIGIN' },
      { local: 'Local Maipú', planning_date: null, stop_type: 'DESTINATION' },
    ])
    expect(payload.origin_tms).toBeUndefined() // modo "Sin TMS"
    expect(onCreated).toHaveBeenCalled()
  })

  it('shows TMS selector y los 2 avisos de reconciliación cuando el origen es un TMS mapeado', async () => {
    renderCreate()
    fireEvent.click(screen.getByText('TMS integrado'))
    fireEvent.change(screen.getByLabelText('TMS de origen'), { target: { value: 'qanalytics' } })
    fireEvent.change(screen.getByPlaceholderText('1994062'), { target: { value: '555' } })
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'Walmart' } })
    expect(await screen.findByText(/Se vinculará automáticamente/)).toBeInTheDocument()
    expect(screen.getByText(/pueden reemplazarse por lo que reporte el TMS/)).toBeInTheDocument()
  })

  it('Cliente busca contra el directorio real y permite crear uno nuevo al vuelo', async () => {
    vi.mocked(tripsApi.create).mockResolvedValue({ id: 't-new' } as never)
    vi.mocked(shippersApi.create).mockResolvedValue({ id: 's2', name: 'Agrosuper', status: 'ACTIVE' } as never)
    renderCreate()
    await pickDriver()

    fireEvent.focus(screen.getByLabelText('Cliente'))
    fireEvent.click(await screen.findByText('Walmart'))
    fireEvent.click(screen.getByText('Crear viaje'))
    await waitFor(() => expect(tripsApi.create).toHaveBeenCalled())
    expect(vi.mocked(tripsApi.create).mock.calls[0][0].client_name).toBe('Walmart')

    vi.mocked(tripsApi.create).mockClear()
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'Agrosuper' } })
    fireEvent.click(await screen.findByText('Crear cliente “Agrosuper”'))
    await waitFor(() => expect(shippersApi.create).toHaveBeenCalledWith({ name: 'Agrosuper' }))
    fireEvent.click(screen.getByText('Crear viaje'))
    await waitFor(() => expect(tripsApi.create).toHaveBeenCalled())
    expect(vi.mocked(tripsApi.create).mock.calls[0][0].client_name).toBe('Agrosuper')
  })

  it('tipo de carga es dropdown con SECO/FRIO/CONGELADO', () => {
    renderCreate()
    const select = screen.getByLabelText('Tipo de carga') as HTMLSelectElement
    const values = Array.from(select.options).map(o => o.value)
    expect(values).toEqual(expect.arrayContaining(['SECO', 'FRIO', 'CONGELADO']))
  })

  it('modo Sin TMS permite anotar un ID de seguimiento y lo envía sin origin_tms', async () => {
    vi.mocked(tripsApi.create).mockResolvedValue({ id: 't-new' } as never)
    renderCreate()
    await pickDriver()
    fireEvent.change(screen.getByPlaceholderText(/Guía, hoja de ruta/), { target: { value: 'FAC-50' } })
    fireEvent.click(screen.getByText('Crear viaje'))
    await waitFor(() => expect(tripsApi.create).toHaveBeenCalled())
    const payload = vi.mocked(tripsApi.create).mock.calls[0][0]
    expect(payload.source_system_trip_id).toBe('FAC-50')
    expect(payload.origin_tms).toBeUndefined()
  })

  it('el selector de TMS integrado no ofrece "manual" como opción', () => {
    renderCreate()
    fireEvent.click(screen.getByText('TMS integrado'))
    const select = screen.getByLabelText('TMS de origen') as HTMLSelectElement
    const values = Array.from(select.options).map(o => o.value)
    expect(values).toContain('qanalytics')
    expect(values).not.toContain('manual')
  })

  it('shows a visible error when the backend rejects (409 duplicado)', async () => {
    vi.mocked(tripsApi.create).mockRejectedValue(new Error('Ya registraste el viaje 555 de Walmart'))
    renderCreate()
    await pickDriver()
    fireEvent.click(screen.getByText('Crear viaje'))
    expect(await screen.findByText(/Ya registraste el viaje/)).toBeInTheDocument()
  })

  it('envía región/ciudad de cada destino en el payload (sin región/ciudad de origen — se retiró del form de creación)', async () => {
    vi.mocked(tripsApi.create).mockResolvedValue({ id: 't-new' } as never)
    renderCreate()
    await pickDriver()

    fireEvent.click(screen.getByText('Agregar destino'))
    fireEvent.change(screen.getByLabelText('Nombre destino 1'), { target: { value: 'CD El Peñón' } })
    fireEvent.change(screen.getByLabelText('Región destino 1'), { target: { value: 'Región Metropolitana de Santiago' } })
    fireEvent.change(screen.getByLabelText('Ciudad destino 1'), { target: { value: 'San Bernardo' } })

    fireEvent.click(screen.getByText('Crear viaje'))
    await waitFor(() => expect(tripsApi.create).toHaveBeenCalled())
    const payload = vi.mocked(tripsApi.create).mock.calls[0][0]
    expect(payload.origin_region).toBeUndefined()
    expect(payload.origin_city).toBeUndefined()
    expect(payload.stops?.[0]).toMatchObject({
      local: 'CD El Peñón',
      destination_region: 'Región Metropolitana de Santiago',
      destination_city: 'San Bernardo',
    })
  })

  it('no expone ningún picker de región/ciudad de origen (retirado en Fase 2, Plan 3)', () => {
    renderCreate()
    expect(screen.queryByLabelText('Región de origen')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Ciudad de origen')).not.toBeInTheDocument()
  })

  it('destinos can be removed', () => {
    renderCreate()
    fireEvent.click(screen.getByText('Agregar destino'))
    expect(screen.getByLabelText('Nombre destino 1')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Quitar destino 1'))
    expect(screen.queryByLabelText('Nombre destino 1')).not.toBeInTheDocument()
  })

  it('shows the "Disponibles hoy" suggested list from availableDrivers when the search field is empty', async () => {
    vi.mocked(tripsApi.availableDrivers).mockResolvedValue([{
      driver_id: 's1', driver_name: 'Pedro Soto', driver_rut: null, driver_phone: null,
      carrier_id: 'c2', carrier_name: 'TransCargo', tractor_asset_id: null, tractor_plate: null,
      trips_total: 0, last_report_at: null,
    }])
    renderCreate()
    expect(await screen.findByText('Pedro Soto')).toBeInTheDocument()
    expect(driversApi.search).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Correr los tests y confirmar que fallan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/TripAssignDialog.test.tsx`
Expected: FAIL — el componente actual todavía tiene el dropdown `MANUAL_CLIENTS`, el input suelto de Origen, `RegionCityPicker` de origen, y no tiene los 2 avisos ámbar nuevos.

- [ ] **Step 4: Reescribir `TripAssignDialog.tsx` completo**

Reemplazar `monitor-app/frontend/components/dashboard/TripAssignDialog.tsx` completo:

```tsx
'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Loader2, Plus, Search, User, MapPin, Link2 } from 'lucide-react'
import type { Trip, TripsMeta, TripCreatePayload, TripStopCreatePayload } from '@/lib/types'
import { tripsApi } from '@/lib/api/trips'
import { useQuery } from '@tanstack/react-query'
import { RouteEditor } from '@/components/dashboard/RouteEditor'
import { FleetAssignSection, EMPTY_FLEET_ASSIGN_VALUE, type FleetAssignValue } from '@/components/dashboard/FleetAssignSection'
import { ClientPicker } from '@/components/dashboard/ClientPicker'

interface Props {
  open:      boolean
  onClose:   () => void
  onCreated: (trip: Trip) => void
  meta?:     TripsMeta | null
  /** Fecha activa del Diario — para sugerir conductores disponibles hoy */
  fecha:     string
}

const INPUT = "w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all placeholder:text-gray-300"

const BASE_CARGO_TYPES = ['SECO', 'FRIO', 'CONGELADO']

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-accent">{icon}</span>
      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">{children}</h3>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type OriginMode = 'none' | 'mapped' | 'other'

export function TripAssignDialog({ open, onClose, onCreated, meta, fecha }: Props) {
  const [form, setForm]             = useState<Partial<TripCreatePayload>>({})
  const [clientName, setClientName] = useState('')
  const [originMode, setOriginMode] = useState<OriginMode>('none')
  const [originTms, setOriginTms]   = useState('')
  const [stops, setStops]           = useState<TripStopCreatePayload[]>([])
  const [fleet, setFleet]           = useState<FleetAssignValue>(EMPTY_FLEET_ASSIGN_VALUE)
  const [saving, setSaving]         = useState(false)
  const [err, setErr]               = useState<string | null>(null)
  const panelRef                    = useRef<HTMLDivElement>(null)
  const firstFieldRef               = useRef<HTMLInputElement>(null)

  const availableQuery = useQuery({
    queryKey: ['available-drivers', fecha],
    queryFn: () => tripsApi.availableDrivers(fecha),
    enabled: open,
  })

  useEffect(() => {
    if (open) {
      setForm({ planning_date: todayISO() })
      setClientName('')
      setOriginMode('none')
      setOriginTms('')
      setStops([])
      setFleet(EMPTY_FLEET_ASSIGN_VALUE)
      setErr(null)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Semántica de diálogo: Escape cierra, Tab atrapado, foco inicial y retorno
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    firstFieldRef.current?.focus()

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
  }, [open, onClose])

  function set(field: keyof TripCreatePayload, value: string) {
    setForm(f => ({ ...f, [field]: value || undefined }))
  }

  const mappedTms = (meta?.tms_sources ?? []).filter(t => t.id !== 'manual')

  // Tipos de carga: base + los configurados en Rangos de Temperatura (dedup)
  const cargoTypes = Array.from(new Set([
    ...BASE_CARGO_TYPES,
    ...(meta?.temperature_ranges ?? []).map(r => r.cargo_type),
    ...(form.cargo_type ? [form.cargo_type] : []),
  ]))

  const canReconcile =
    originMode === 'mapped' && !!originTms && !!form.source_system_trip_id && !!clientName

  async function handleCreate() {
    if (!form.planning_date) { setErr('La fecha de planificación es requerida'); return }
    if (!fleet.driver_id) { setErr('Elegí un conductor del directorio de Empresas antes de crear el viaje'); return }
    if (stops.some(s => s.stop_type !== 'ORIGIN' && !s.local.trim())) { setErr('Cada destino debe tener un nombre'); return }
    setSaving(true); setErr(null)
    try {
      const payload: TripCreatePayload = {
        planning_date:          form.planning_date,
        origin_tms:              originMode === 'none' ? undefined : originTms || undefined,
        source_system_trip_id:  form.source_system_trip_id,
        client_name:             clientName.trim() || undefined,
        cargo_type:              form.cargo_type,
        current_status:          form.current_status,
        stops:                   stops.filter(s => s.local.trim()),
        tractor_plate:           fleet.tractor_plate ?? undefined,
        trailer_plate:           fleet.trailer_plate ?? undefined,
        driver_name:             fleet.driver_name ?? undefined,
        driver_rut:              fleet.driver_rut ?? undefined,
        driver_phone:            fleet.driver_phone ?? undefined,
        transporter_name:        fleet.carrier_name ?? undefined,
        carrier_id:               fleet.carrier_id ?? undefined,
        driver_id:                fleet.driver_id ?? undefined,
        tractor_asset_id:        fleet.tractor_asset_id ?? undefined,
      }
      const created = await tripsApi.create(payload)
      onCreated(created)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al crear el viaje')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 md:p-8 animate-backdrop-in">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Nuevo viaje manual"
        tabIndex={-1}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-auto overflow-hidden flex flex-col focus:outline-none animate-modal-in"
      >

        {/* Header */}
        <div className="bg-slate-900 px-6 py-4 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent/20 flex items-center justify-center">
              <Plus size={18} className="text-accent" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Nuevo Viaje</h2>
              <p className="text-xs text-white/40 mt-0.5">Registro manual — quedará con fuente MAN</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-white/50 hover:text-white transition-colors p-2 rounded-xl hover:bg-white/10">
            <X size={20} />
          </button>
        </div>

        {/* Body — form con Enter para crear */}
        <form
          className="flex-1 overflow-y-auto min-h-0 flex flex-col"
          onSubmit={e => { e.preventDefault(); handleCreate() }}
        >
          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/50 flex-1">

            {/* LEFT — Esencial + Sistema de origen + Ruta (origen y destinos unificados) */}
            <div className="p-6 space-y-5">
              <SectionTitle icon={<Search size={14} />}>Datos del viaje</SectionTitle>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Fecha planificación" required>
                  <input ref={firstFieldRef} type="date" value={form.planning_date ?? ''} onChange={e => set('planning_date', e.target.value)} className={INPUT} />
                </Field>
                <Field label="Cliente">
                  <ClientPicker value={clientName} onChange={setClientName} placeholder="Buscar o crear cliente…" />
                </Field>
              </div>
              <Field label="Tipo de carga">
                <select
                  value={form.cargo_type ?? ''}
                  onChange={e => set('cargo_type', e.target.value)}
                  aria-label="Tipo de carga"
                  className={INPUT}
                >
                  <option value="">— Sin especificar</option>
                  {cargoTypes.map(ct => (
                    <option key={ct} value={ct}>{ct}</option>
                  ))}
                </select>
              </Field>
              <Field label="Estado inicial">
                <select value={form.current_status ?? ''} onChange={e => set('current_status', e.target.value)} className={INPUT}>
                  <option value="">— Sin estado</option>
                  {(meta?.statuses ?? []).map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </Field>

              {/* Sistema de origen — separa el canal de ingreso (manual) del origen real */}
              <div className="border-t border-border/50 pt-5">
                <SectionTitle icon={<Link2 size={14} />}>¿De dónde viene este viaje?</SectionTitle>
                <div className="flex items-center gap-1.5 flex-wrap mb-3">
                  {([
                    { id: 'none',   label: 'Sin TMS'      },
                    { id: 'mapped', label: 'TMS integrado' },
                    { id: 'other',  label: 'Otro sistema'  },
                  ] as const).map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { setOriginMode(m.id); setOriginTms('') }}
                      aria-pressed={originMode === m.id}
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
                        originMode === m.id
                          ? 'bg-accent border-accent text-white'
                          : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {originMode === 'none' && (
                  <div>
                    <Field label="ID de seguimiento (opcional)">
                      <input
                        type="text"
                        value={form.source_system_trip_id ?? ''}
                        onChange={e => set('source_system_trip_id', e.target.value)}
                        placeholder="Guía, hoja de ruta, factura…"
                        className={INPUT}
                      />
                    </Field>
                    <p className="mt-2 text-[10px] text-gray-400">
                      El viaje queda igual con un ID interno de Webcarga para trazabilidad y facturación.
                    </p>
                  </div>
                )}
                {originMode === 'mapped' && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="TMS">
                      <select value={originTms} onChange={e => setOriginTms(e.target.value)} aria-label="TMS de origen" className={INPUT}>
                        <option value="">— Seleccionar…</option>
                        {mappedTms.map(t => (
                          <option key={t.id} value={t.id}>{t.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="ID del viaje en ese TMS">
                      <input type="text" value={form.source_system_trip_id ?? ''} onChange={e => set('source_system_trip_id', e.target.value)} placeholder="1994062" className={INPUT} />
                    </Field>
                  </div>
                )}
                {originMode === 'other' && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Nombre del sistema">
                      <input type="text" value={originTms} onChange={e => setOriginTms(e.target.value)} placeholder="Ej: Beetrack" className={INPUT} />
                    </Field>
                    <Field label="ID del viaje (opcional)">
                      <input type="text" value={form.source_system_trip_id ?? ''} onChange={e => set('source_system_trip_id', e.target.value)} placeholder="VJE-001" className={INPUT} />
                    </Field>
                  </div>
                )}
                {canReconcile && (
                  <div className="mt-2 space-y-1.5">
                    <p className="text-[10px] text-accent bg-accent/5 border border-accent/15 rounded-lg px-3 py-2">
                      Se vinculará automáticamente cuando {mappedTms.find(t => t.id === originTms)?.label ?? originTms} reporte este viaje (mismo cliente e ID).
                    </p>
                    <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                      El origen se conserva siempre, pero si {mappedTms.find(t => t.id === originTms)?.label ?? originTms} reporta paradas distintas a las que cargues abajo, los destinos que hayas puesto acá pueden reemplazarse por lo que reporte el TMS.
                    </p>
                  </div>
                )}
              </div>

              {/* Ruta — origen + destinos unificados (Fase 2, Plan 3) */}
              <div className="border-t border-border/50 pt-5">
                <SectionTitle icon={<MapPin size={14} />}>Ruta</SectionTitle>
                <RouteEditor stops={stops} onChange={setStops} />
              </div>
            </div>

            {/* RIGHT — Conductor primero (llave real de la operación diaria);
                empresa/vehículo se autocompletan editables desde sus
                asignaciones activas — Ronda 26, sobre FleetAssignSection (Fase 2, Plan 3) */}
            <div className="p-6 space-y-5">
              <SectionTitle icon={<User size={14} />}>Conductor</SectionTitle>
              <FleetAssignSection
                value={fleet}
                onChange={setFleet}
                suggested={availableQuery.data ?? []}
                suggestedLabel="Disponibles hoy"
                notFoundHint={
                  <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-2">
                    Si no aparece en la lista, hay que darlo de alta primero en{' '}
                    <a href="/dashboard/transportistas" className="underline font-semibold">Empresas</a> — no se puede crear el viaje sin un conductor vinculado al directorio real.
                  </p>
                }
              />
            </div>
          </div>

          {/* Footer */}
          {err && (
            <div className="px-6 pt-3 pb-0 shrink-0">
              <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>
            </div>
          )}
          <div className="shrink-0 border-t border-border px-6 py-4 flex items-center gap-3 bg-gray-50/50 mt-3">
            <button type="button" onClick={onClose} className="px-4 py-2.5 text-sm text-gray-500 border border-border rounded-lg hover:bg-white transition-colors">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !form.planning_date || !fleet.driver_id}
              className="flex-1 flex items-center justify-center gap-2 bg-accent text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-40 transition-colors"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Crear viaje
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Correr los tests y confirmar que pasan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/TripAssignDialog.test.tsx`
Expected: 16 passed.

- [ ] **Step 6: `tsc` limpio y suite completa**

Run: `cd monitor-app/frontend && npx tsc --noEmit && npm test`
Expected: sin errores de tipos; toda la suite de vitest pasa (sin regresiones en otros archivos — nada más importa `TripCreatePayload.origin` ni el `MANUAL_CLIENTS`/`RegionCityPicker` de `TripAssignDialog`).

- [ ] **Step 7: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/frontend/lib/types.ts monitor-app/frontend/components/dashboard/TripAssignDialog.tsx monitor-app/frontend/components/dashboard/TripAssignDialog.test.tsx
git commit -m "feat(diario): TripAssignDialog reconstruido sobre RouteEditor/FleetAssignSection/ClientPicker"
```

---

## Self-Review

**1. Cobertura del spec**: cubre el punto central del bug original de la sesión (patente no sincronizada — resuelto de raíz al mover conductor/empresa/vehículo a un único componente controlado, `FleetAssignSection`, sin dos copias de estado desincronizables); unifica el contrato de creación con `RouteEditor` (origen dentro de `stops[]`, ya consistente con el backend del Plan 1); reemplaza el dropdown hardcodeado de 4 clientes por el directorio real (`ClientPicker`); retira región/ciudad de origen del formulario de creación (decisión explícita del spec, línea 51); agrega el aviso de reconciliación de destinos (decisión explícita del spec, línea 40).
**2. Placeholders**: ninguno — cada paso tiene el archivo completo (componente + test), sin fragmentos parciales.
**3. Consistencia de tipos**: `FleetAssignValue`/`EMPTY_FLEET_ASSIGN_VALUE` se importan tal cual los exporta `FleetAssignSection.tsx` (Plan 2); `TripStopCreatePayload.stop_type` se usa igual que en `RouteEditor.tsx` (Plan 2); `notFoundHint` se define en la Task 1 de este plan y se consume en la Task 2, mismo nombre y tipo (`React.ReactNode`).
**4. Alcance**: no toca `TripSlideOver.tsx` (Plan 4) ni `TripTable.tsx` (Plan 6) — el único archivo ya commiteado que este plan modifica fuera de `TripAssignDialog` es `FleetAssignSection.tsx` (Task 1, aditivo — un prop opcional nuevo no rompe a ningún otro consumidor futuro).
**5. Orden entre tasks**: Task 1 (prop `notFoundHint`) es un prerrequisito real de Task 2 (el nuevo `TripAssignDialog.tsx` la usa desde el primer render) — deben ejecutarse en ese orden, tal como están numeradas.
**6. Riesgo real**: después de este plan, el frontend deja de mandar `origin` (ya no existe el campo) — coincide exactamente con el momento que el Plan 1 (backend) identificó como seguro para dejar de aceptarlo. Push conjunto de los Planes 1+2+3 sigue pendiente de confirmación del usuario (Global Constraints).
