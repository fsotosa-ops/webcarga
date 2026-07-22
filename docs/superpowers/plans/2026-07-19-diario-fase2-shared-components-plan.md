# Diario Fase 2 — Shared Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir los 3 componentes compartidos de frontend (`RouteEditor`, `FleetAssignSection`, `ClientPicker`) que el Plan 3 (`TripAssignDialog`) y el Plan 4 (`TripSlideOver`) van a consumir — sin tocar esos dos archivos todavía.

**Architecture:** 3 componentes controlados (`value`/`onChange`), sin llamadas a API propias salvo `ClientPicker` (que sí necesita `POST /shippers` para el flujo "crear cliente al vuelo"). Cada uno reusa los pickers ya existentes de rondas anteriores (`DriverSearchPicker` de la Ronda 26, `RegionCityPicker` de Fase 1) en vez de reimplementar búsqueda. Ningún componente hace la llamada final de guardado (`POST /trips`, `PATCH .../fleet-link`) — eso lo deciden los Planes 3/4 según su propio flujo (creación vs. edición en vivo).

**Tech Stack:** Next.js 16 / React, TanStack Query, Vitest + Testing Library.

## Global Constraints

- Este plan es **solo componentes nuevos** — no modifica `TripAssignDialog.tsx` ni `TripSlideOver.tsx`. Ambos siguen funcionando exactamente igual que hoy hasta que los Planes 3/4 los rewireen.
- Cualquier tipo nuevo/modificado en `lib/types.ts` debe ser **aditivo u opcional** — `TripAssignDialog.tsx` sigue construyendo `TripStopCreatePayload` sin `stop_type` (línea 425 actual) y seguirá compilando hasta que el Plan 3 lo toque.
- Reusar los estilos/clases Tailwind ya establecidos en `TripAssignDialog.tsx`/`CarrierSearchPicker.tsx`/`DriverSearchPicker.tsx` (mismos valores de `INPUT`, tamaños de fuente, paleta) — no introducir un sistema de diseño paralelo.
- `npx tsc --noEmit` y `npm test` (vitest) limpios al final de cada task — mismo estándar que el resto de la sesión.
- Sin verificación en navegador (la app usa SSO real, sin credenciales de test disponibles en este entorno) — cubierto con tests de componente + `tsc`/build, como el resto de la sesión.

---

### Task 1: `RouteEditor` — origen + paradas unificados

**Files:**
- Create: `monitor-app/frontend/components/dashboard/RouteEditor.tsx`
- Create: `monitor-app/frontend/components/dashboard/RouteEditor.test.tsx`
- Modify: `monitor-app/frontend/lib/types.ts:306-312` (`TripStopCreatePayload` gana `stop_type`)

**Interfaces:**
- Consumes: `TripStopCreatePayload` (`lib/types.ts`), `RegionCityPicker` (`components/ui/RegionCityPicker.tsx`, ya existente, sin cambios).
- Produces: `RouteEditor({ stops: TripStopCreatePayload[], onChange: (stops: TripStopCreatePayload[]) => void, size?: 'sm' | 'md' })` — componente controlado. `stops` debe traer a lo sumo 1 elemento con `stop_type: 'ORIGIN'` (el resto `'DESTINATION'`), mismo contrato que ya acepta `POST /trips` desde el Plan 1 de esta Fase 2 (backend, ya commiteado). Los Planes 3/4 consumen esto directo.

- [ ] **Step 1: Agregar `stop_type` a `TripStopCreatePayload`**

En `monitor-app/frontend/lib/types.ts`, `TripStopCreatePayload` (línea 306) pasa de:

```typescript
export type TripStopCreatePayload = {
  local:               string
  planning_date?:      string | null
  /** Dropdown región/ciudad de Chile — van a las claves destination_* del jsonb stops */
  destination_region?: string | null
  destination_city?:   string | null
}
```

A:

```typescript
export type TripStopCreatePayload = {
  local:               string
  planning_date?:      string | null
  /** Dropdown región/ciudad de Chile — van a las claves destination_* del jsonb stops */
  destination_region?: string | null
  destination_city?:   string | null
  /** 'ORIGIN' | 'DESTINATION' — el origen del viaje se manda como una parada
   *  más (Ronda 26, Fase 2, backend ya unificado). Opcional (default
   *  'DESTINATION' en el backend) para no romper construcciones existentes
   *  de este tipo que todavía no lo mandan (TripAssignDialog.tsx, hasta que
   *  el Plan 3 de esta Fase lo rewiree sobre RouteEditor). */
  stop_type?:          'ORIGIN' | 'DESTINATION'
}
```

- [ ] **Step 2: Escribir los tests que fallan**

Crear `monitor-app/frontend/components/dashboard/RouteEditor.test.tsx`:

```tsx
import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RouteEditor } from './RouteEditor'
import type { TripStopCreatePayload } from '@/lib/types'

function Harness({
  initial = [] as TripStopCreatePayload[], onChangeSpy,
}: {
  initial?: TripStopCreatePayload[]
  onChangeSpy?: (s: TripStopCreatePayload[]) => void
}) {
  const [stops, setStops] = useState<TripStopCreatePayload[]>(initial)
  return (
    <RouteEditor
      stops={stops}
      onChange={s => { setStops(s); onChangeSpy?.(s) }}
    />
  )
}

describe('RouteEditor', () => {
  it('starts with an empty origin field and no destinations', () => {
    render(<Harness />)
    expect(screen.getByLabelText('Origen')).toHaveValue('')
    expect(screen.queryByLabelText(/Nombre destino/)).not.toBeInTheDocument()
  })

  it('typing in Origen adds a stop_type=ORIGIN entry at the front', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} />)
    fireEvent.change(screen.getByLabelText('Origen'), { target: { value: 'CD Lo Aguirre' } })
    expect(spy).toHaveBeenCalledWith([{ local: 'CD Lo Aguirre', stop_type: 'ORIGIN' }])
  })

  it('renders an existing origin stop and lets it be edited without duplicating it', () => {
    const spy = vi.fn()
    render(<Harness initial={[{ local: 'CD Viejo', stop_type: 'ORIGIN' }]} onChangeSpy={spy} />)
    expect(screen.getByLabelText('Origen')).toHaveValue('CD Viejo')
    fireEvent.change(screen.getByLabelText('Origen'), { target: { value: 'CD Nuevo' } })
    expect(spy).toHaveBeenCalledWith([{ local: 'CD Nuevo', stop_type: 'ORIGIN' }])
  })

  it('adds a destination row with "Agregar destino"', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} />)
    fireEvent.click(screen.getByText('Agregar destino'))
    expect(spy).toHaveBeenCalledWith([{ local: '', planning_date: null, stop_type: 'DESTINATION' }])
  })

  it('edits a destination name without touching the origin entry', () => {
    const spy = vi.fn()
    render(<Harness
      initial={[
        { local: 'CD Origen', stop_type: 'ORIGIN' },
        { local: '', planning_date: null, stop_type: 'DESTINATION' },
      ]}
      onChangeSpy={spy}
    />)
    fireEvent.change(screen.getByLabelText('Nombre destino 1'), { target: { value: 'Local Maipú' } })
    expect(spy).toHaveBeenCalledWith([
      { local: 'CD Origen', stop_type: 'ORIGIN' },
      { local: 'Local Maipú', planning_date: null, stop_type: 'DESTINATION' },
    ])
  })

  it('removes a destination row via its trash button, keeping the origin', () => {
    const spy = vi.fn()
    render(<Harness
      initial={[
        { local: 'CD Origen', stop_type: 'ORIGIN' },
        { local: 'Destino A', planning_date: null, stop_type: 'DESTINATION' },
      ]}
      onChangeSpy={spy}
    />)
    fireEvent.click(screen.getByLabelText('Quitar destino 1'))
    expect(spy).toHaveBeenCalledWith([{ local: 'CD Origen', stop_type: 'ORIGIN' }])
  })

  it('sets region/city on a destination via RegionCityPicker without touching its name', () => {
    const spy = vi.fn()
    render(<Harness
      initial={[{ local: 'Destino A', planning_date: null, stop_type: 'DESTINATION' }]}
      onChangeSpy={spy}
    />)
    fireEvent.change(screen.getByLabelText('Región destino 1'), { target: { value: 'Biobío' } })
    expect(spy).toHaveBeenCalledWith([
      { local: 'Destino A', planning_date: null, stop_type: 'DESTINATION', destination_region: 'Biobío', destination_city: null },
    ])
  })
})
```

- [ ] **Step 3: Correr los tests y confirmar que fallan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/RouteEditor.test.tsx`
Expected: FAIL — `./RouteEditor` no existe todavía.

- [ ] **Step 4: Implementar `RouteEditor`**

Crear `monitor-app/frontend/components/dashboard/RouteEditor.tsx`:

```tsx
'use client'

import type { TripStopCreatePayload } from '@/lib/types'
import { Plus, Trash2 } from 'lucide-react'
import { RegionCityPicker } from '@/components/ui/RegionCityPicker'

interface Props {
  /** Incluye a lo sumo 1 stop con stop_type='ORIGIN' + N con stop_type=
   *  'DESTINATION' (o sin stop_type, tratado como DESTINATION). Mismo shape
   *  que POST /trips espera desde el Plan 1 de la Fase 2 (backend). */
  stops:    TripStopCreatePayload[]
  onChange: (stops: TripStopCreatePayload[]) => void
  size?:    'sm' | 'md'
}

const INPUT = "w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all placeholder:text-gray-300"
const INPUT_SM = "w-full text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all placeholder:text-gray-300"
// Sin w-full: convive en la fila de destino con el input de nombre (INPUT trae
// w-full y dos utilidades de ancho en conflicto dejan el ancho al azar del stylesheet)
const INPUT_DATE = "text-sm border border-border rounded-lg px-2 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all w-[150px] sm:w-[185px]"

export function RouteEditor({ stops, onChange, size = 'md' }: Props) {
  const origin       = stops.find(s => s.stop_type === 'ORIGIN') ?? null
  const destinations = stops.filter(s => s.stop_type !== 'ORIGIN')
  const inputCls      = size === 'sm' ? INPUT_SM : INPUT

  function setOrigin(local: string) {
    const rest = stops.filter(s => s.stop_type !== 'ORIGIN')
    onChange([{ local, stop_type: 'ORIGIN' }, ...rest])
  }

  function addDestination() {
    onChange([...stops, { local: '', planning_date: null, stop_type: 'DESTINATION' }])
  }

  function patchDestination(index: number, patch: Partial<TripStopCreatePayload>) {
    let seen = -1
    onChange(stops.map(s => {
      if (s.stop_type === 'ORIGIN') return s
      seen += 1
      return seen === index ? { ...s, ...patch } : s
    }))
  }

  function removeDestination(index: number) {
    let seen = -1
    onChange(stops.filter(s => {
      if (s.stop_type === 'ORIGIN') return true
      seen += 1
      return seen !== index
    }))
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Origen</label>
        <input
          type="text"
          value={origin?.local ?? ''}
          onChange={e => setOrigin(e.target.value)}
          placeholder="Nombre del origen (CD, planta…)"
          aria-label="Origen"
          className={inputCls}
        />
      </div>
      <div className="space-y-2">
        <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Destinos</label>
        {destinations.map((s, i) => (
          <div key={i} className="space-y-1.5 border border-border/60 rounded-lg p-2">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
              <input
                type="text"
                value={s.local}
                onChange={e => patchDestination(i, { local: e.target.value })}
                placeholder={`Destino ${i + 1} — nombre del local`}
                className={inputCls}
                aria-label={`Nombre destino ${i + 1}`}
              />
              <input
                type="datetime-local"
                value={s.planning_date ?? ''}
                onChange={e => patchDestination(i, { planning_date: e.target.value || null })}
                className={INPUT_DATE}
                aria-label={`Fecha planificada destino ${i + 1}`}
              />
              <button
                type="button"
                onClick={() => removeDestination(i)}
                aria-label={`Quitar destino ${i + 1}`}
                className="p-2 rounded-lg border border-transparent text-gray-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <RegionCityPicker
              size="sm"
              region={s.destination_region ?? null}
              city={s.destination_city ?? null}
              onChange={(region, city) => patchDestination(i, { destination_region: region, destination_city: city })}
              labelSuffix={`destino ${i + 1}`}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={addDestination}
          className="flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 transition-colors"
        >
          <Plus size={12} />
          Agregar destino
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Correr los tests y confirmar que pasan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/RouteEditor.test.tsx`
Expected: 7 passed.

- [ ] **Step 6: `tsc` limpio**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: sin errores (confirma que `TripAssignDialog.tsx:425` sigue compilando con `stop_type` opcional).

- [ ] **Step 7: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/frontend/lib/types.ts monitor-app/frontend/components/dashboard/RouteEditor.tsx monitor-app/frontend/components/dashboard/RouteEditor.test.tsx
git commit -m "feat(diario): RouteEditor — origen y paradas unificados en un solo componente"
```

---

### Task 2: `FleetAssignSection` — conductor→empresa/vehículo, driver-first

**Files:**
- Create: `monitor-app/frontend/components/dashboard/FleetAssignSection.tsx`
- Create: `monitor-app/frontend/components/dashboard/FleetAssignSection.test.tsx`

**Interfaces:**
- Consumes: `DriverSearchPicker` (`components/dashboard/DriverSearchPicker.tsx`, ya existente, sin cambios), `DriverPickCandidate` (`lib/types.ts`, ya existente).
- Produces: `FleetAssignValue` (nuevo tipo, exportado desde este archivo) y `EMPTY_FLEET_ASSIGN_VALUE` (constante exportada). `FleetAssignSection({ value: FleetAssignValue, onChange: (v: FleetAssignValue) => void, suggested?: DriverPickCandidate[], suggestedLabel?: string, size?: 'sm' | 'md' })` — componente controlado, **sin llamada a API propia**. El Plan 3 (`TripAssignDialog`) lo usa para poblar su `form` local (igual que hace hoy con `handlePickDriver`); el Plan 4 (`TripSlideOver`) lo envuelve en su propio `draft` + botón "Vincular" que llama a `tripsApi.assignFleetLink` (reemplazando `CarrierAssignSection`, que queda retirado en ese plan, no en este).

- [ ] **Step 1: Escribir los tests que fallan**

Crear `monitor-app/frontend/components/dashboard/FleetAssignSection.test.tsx`:

```tsx
import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FleetAssignSection, EMPTY_FLEET_ASSIGN_VALUE, type FleetAssignValue } from './FleetAssignSection'
import { driversApi } from '@/lib/api/drivers'

vi.mock('@/lib/api/drivers', () => ({
  driversApi: { search: vi.fn() },
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

function Harness({
  initial = EMPTY_FLEET_ASSIGN_VALUE, onChangeSpy, suggested,
}: {
  initial?: FleetAssignValue
  onChangeSpy?: (v: FleetAssignValue) => void
  suggested?: FleetAssignValue extends never ? never : Parameters<typeof FleetAssignSection>[0]['suggested']
}) {
  const [value, setValue] = useState<FleetAssignValue>(initial)
  return (
    <Wrapper>
      <FleetAssignSection value={value} onChange={v => { setValue(v); onChangeSpy?.(v) }} suggested={suggested} />
    </Wrapper>
  )
}

const CANDIDATE = {
  driver_id: 'd1', driver_name: 'Juan Pérez', driver_rut: '11.111.111-1', driver_phone: '+56911112222',
  carrier_id: 'c1', carrier_name: 'TransCargo', tractor_asset_id: 'a1', tractor_plate: 'ABCD12',
}

describe('FleetAssignSection', () => {
  it('shows the driver search when no driver is picked', () => {
    render(<Harness />)
    expect(screen.getByLabelText('Buscar conductor')).toBeInTheDocument()
  })

  it('picking a suggested driver fills every field from the candidate', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} suggested={[CANDIDATE]} />)
    fireEvent.click(screen.getByText('Juan Pérez'))
    expect(spy).toHaveBeenCalledWith({
      driver_id: 'd1', driver_name: 'Juan Pérez', driver_rut: '11.111.111-1', driver_phone: '+56911112222',
      carrier_id: 'c1', carrier_name: 'TransCargo', tractor_asset_id: 'a1', tractor_plate: 'ABCD12',
      trailer_plate: null,
    })
  })

  it('preserves an already-typed trailer plate when a driver is picked', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} suggested={[CANDIDATE]} initial={{ ...EMPTY_FLEET_ASSIGN_VALUE, trailer_plate: 'RMPLA01' }} />)
    fireEvent.click(screen.getByText('Juan Pérez'))
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ trailer_plate: 'RMPLA01' }))
  })

  it('shows the picked driver summary and editable fleet fields once a driver is set', () => {
    render(<Harness initial={{
      driver_id: 'd1', driver_name: 'Juan Pérez', driver_rut: '11.111.111-1', driver_phone: null,
      carrier_id: 'c1', carrier_name: 'TransCargo', tractor_asset_id: 'a1', tractor_plate: 'ABCD12',
      trailer_plate: null,
    }} />)
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByLabelText('Empresa de transporte')).toHaveValue('TransCargo')
    expect(screen.getByLabelText('Patente tracto')).toHaveValue('ABCD12')
  })

  it('editing the tractor plate patches only that field, uppercased', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} initial={{
      driver_id: 'd1', driver_name: 'Juan Pérez', driver_rut: null, driver_phone: null,
      carrier_id: 'c1', carrier_name: 'TransCargo', tractor_asset_id: 'a1', tractor_plate: '',
      trailer_plate: null,
    }} />)
    fireEvent.change(screen.getByLabelText('Patente tracto'), { target: { value: 'bgvs12' } })
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ tractor_plate: 'BGVS12', driver_id: 'd1' }))
  })

  it('"Cambiar" resets the whole selection back to empty', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} initial={{
      driver_id: 'd1', driver_name: 'Juan Pérez', driver_rut: null, driver_phone: null,
      carrier_id: 'c1', carrier_name: 'TransCargo', tractor_asset_id: 'a1', tractor_plate: 'ABCD12',
      trailer_plate: 'RMPLA01',
    }} />)
    fireEvent.click(screen.getByText('Cambiar'))
    expect(spy).toHaveBeenCalledWith(EMPTY_FLEET_ASSIGN_VALUE)
  })
})
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/FleetAssignSection.test.tsx`
Expected: FAIL — `./FleetAssignSection` no existe todavía.

- [ ] **Step 3: Implementar `FleetAssignSection`**

Crear `monitor-app/frontend/components/dashboard/FleetAssignSection.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { User } from 'lucide-react'
import type { DriverPickCandidate } from '@/lib/types'
import { DriverSearchPicker } from './DriverSearchPicker'

export type FleetAssignValue = {
  driver_id:        string | null
  driver_name:      string | null
  driver_rut:       string | null
  driver_phone:     string | null
  carrier_id:       string | null
  carrier_name:     string | null
  tractor_asset_id: string | null
  tractor_plate:    string | null
  trailer_plate:    string | null
}

export const EMPTY_FLEET_ASSIGN_VALUE: FleetAssignValue = {
  driver_id: null, driver_name: null, driver_rut: null, driver_phone: null,
  carrier_id: null, carrier_name: null, tractor_asset_id: null, tractor_plate: null,
  trailer_plate: null,
}

interface Props {
  value:           FleetAssignValue
  onChange:        (value: FleetAssignValue) => void
  /** Ej: conductores disponibles hoy (tripsApi.availableDrivers) — mostrado
   *  cuando el campo de búsqueda está vacío, mismo patrón de DriverSearchPicker. */
  suggested?:      DriverPickCandidate[]
  suggestedLabel?: string
  size?:           'sm' | 'md'
}

const INPUT = "w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all placeholder:text-gray-300"
const INPUT_SM = "w-full text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all placeholder:text-gray-300"

function Field({ label, ariaLabel, children }: { label: string; ariaLabel: string; children: (cls: string, ariaLabel: string) => React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{label}</label>
      {children(INPUT, ariaLabel)}
    </div>
  )
}

export function FleetAssignSection({ value, onChange, suggested = [], suggestedLabel, size = 'md' }: Props) {
  const [query, setQuery] = useState('')
  const inputCls = size === 'sm' ? INPUT_SM : INPUT

  function pick(d: DriverPickCandidate) {
    setQuery('')
    onChange({
      driver_id:        d.driver_id,
      driver_name:       d.driver_name,
      driver_rut:        d.driver_rut,
      driver_phone:      d.driver_phone,
      carrier_id:        d.carrier_id,
      carrier_name:      d.carrier_name,
      tractor_asset_id:  d.tractor_asset_id,
      tractor_plate:     d.tractor_plate,
      trailer_plate:     value.trailer_plate,
    })
  }

  function clear() {
    onChange(EMPTY_FLEET_ASSIGN_VALUE)
  }

  function patch(field: keyof FleetAssignValue, v: string) {
    onChange({ ...value, [field]: v || null })
  }

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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between bg-accent/5 border border-accent/20 rounded-xl px-4 py-3">
        <div className="min-w-0 flex items-center gap-2">
          <User size={14} className="text-accent shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{value.driver_name}</p>
            <p className="text-[10px] text-gray-400 font-mono">{value.driver_rut ?? ''}</p>
          </div>
        </div>
        <button type="button" onClick={clear} className="text-xs text-gray-400 hover:text-red-400 transition-colors shrink-0 ml-3">
          Cambiar
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Empresa de transporte</label>
          <input type="text" value={value.carrier_name ?? ''} onChange={e => patch('carrier_name', e.target.value)} placeholder="Se autocompleta al elegir conductor" aria-label="Empresa de transporte" className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Teléfono</label>
          <input type="text" value={value.driver_phone ?? ''} onChange={e => patch('driver_phone', e.target.value)} placeholder="+56912345678" aria-label="Teléfono" className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Patente tracto</label>
          <input type="text" value={value.tractor_plate ?? ''} onChange={e => patch('tractor_plate', e.target.value.toUpperCase())} placeholder="BGVS12" aria-label="Patente tracto" className={inputCls + ' uppercase'} />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Patente rampla</label>
          <input type="text" value={value.trailer_plate ?? ''} onChange={e => patch('trailer_plate', e.target.value.toUpperCase())} placeholder="RMPLA01" aria-label="Patente rampla" className={inputCls + ' uppercase'} />
        </div>
      </div>
      <p className="text-[10px] text-gray-400">
        Autocompletado editable desde la asignación activa del conductor — corregí acá si ese día manejó otro equipo.
      </p>
    </div>
  )
}
```

Nota: el helper `Field` queda declarado pero sin uso en el cuerpo final (se optó por inline directo para no forzar una firma de children con 2 parámetros por un ahorro marginal de líneas) — **eliminar la declaración de `Field` antes de commitear**, no dejarla como código muerto.

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/FleetAssignSection.test.tsx`
Expected: 6 passed.

- [ ] **Step 5: `tsc` limpio**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/frontend/components/dashboard/FleetAssignSection.tsx monitor-app/frontend/components/dashboard/FleetAssignSection.test.tsx
git commit -m "feat(diario): FleetAssignSection — conductor→empresa/vehículo driver-first, compartido crear/editar"
```

---

### Task 3: `ClientPicker` — cliente/shipper real contra `public.shippers`

**Files:**
- Create: `monitor-app/frontend/components/dashboard/ClientPicker.tsx`
- Create: `monitor-app/frontend/components/dashboard/ClientPicker.test.tsx`
- Modify: `monitor-app/frontend/lib/api/locations.ts:37-39` (`shippersApi` gana `create`)

**Interfaces:**
- Consumes: `Shipper` (`lib/api/locations.ts`, ya existente), `ApiError` (`lib/api/client.ts`, ya existente).
- Produces: `shippersApi.create(body: { name: string }): Promise<Shipper>`. `ClientPicker({ value: string, onChange: (name: string) => void, placeholder?: string, size?: 'sm' | 'md' })` — controlado directo sobre el string `client_name` (mismo campo que ya manda `TripCreatePayload.client_name`, sin cambios de contrato en el backend). El Plan 3 lo usa para reemplazar el `<select>` fijo de 4 clientes + "Otro cliente" en `TripAssignDialog`.

- [ ] **Step 1: Agregar `shippersApi.create`**

En `monitor-app/frontend/lib/api/locations.ts`, `shippersApi` (línea 37) pasa de:

```typescript
export const shippersApi = {
  list: () => apiFetch<Shipper[]>('/api/v1/shippers'),
}
```

A:

```typescript
export const shippersApi = {
  list: () => apiFetch<Shipper[]>('/api/v1/shippers'),

  create: (body: { name: string }) =>
    apiFetch<Shipper>('/api/v1/shippers', { method: 'POST', body: JSON.stringify(body) }),
}
```

- [ ] **Step 2: Escribir los tests que fallan**

Crear `monitor-app/frontend/components/dashboard/ClientPicker.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ClientPicker } from './ClientPicker'
import { shippersApi } from '@/lib/api/locations'
import { ApiError } from '@/lib/api/client'

vi.mock('@/lib/api/locations', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api/locations')>()
  return { ...actual, shippersApi: { list: vi.fn(), create: vi.fn() } }
})

const SHIPPERS = [
  { id: 's1', name: 'Walmart', status: 'ACTIVE' },
  { id: 's2', name: 'Colún', status: 'ACTIVE' },
]

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

function Harness({ value = '', onChange }: { value?: string; onChange?: (n: string) => void }) {
  return (
    <Wrapper>
      <ClientPicker value={value} onChange={onChange ?? vi.fn()} />
    </Wrapper>
  )
}

beforeEach(() => {
  vi.mocked(shippersApi.list).mockReset().mockResolvedValue(SHIPPERS as never)
  vi.mocked(shippersApi.create).mockReset()
})

describe('ClientPicker', () => {
  it('shows all shippers when the field is focused and empty', async () => {
    render(<Harness />)
    fireEvent.focus(screen.getByLabelText('Cliente'))
    expect(await screen.findByText('Walmart')).toBeInTheDocument()
    expect(screen.getByText('Colún')).toBeInTheDocument()
  })

  it('filters shippers by the typed text and calls onChange when one is clicked', async () => {
    const onChange = vi.fn()
    render(<Harness value="wal" onChange={onChange} />)
    fireEvent.focus(screen.getByLabelText('Cliente'))
    fireEvent.click(await screen.findByText('Walmart'))
    expect(onChange).toHaveBeenCalledWith('Walmart')
    expect(screen.queryByText('Colún')).not.toBeInTheDocument()
  })

  it('offers to create a new shipper when no exact match exists', async () => {
    render(<Harness value="Agrosuper" />)
    fireEvent.focus(screen.getByLabelText('Cliente'))
    expect(await screen.findByText('Crear cliente “Agrosuper”')).toBeInTheDocument()
  })

  it('does not offer to create when the typed name exactly matches an existing shipper', async () => {
    render(<Harness value="Walmart" />)
    fireEvent.focus(screen.getByLabelText('Cliente'))
    await screen.findByText('Walmart')
    expect(screen.queryByText(/Crear cliente/)).not.toBeInTheDocument()
  })

  it('creates the shipper and selects it on click', async () => {
    vi.mocked(shippersApi.create).mockResolvedValue({ id: 's3', name: 'Agrosuper', status: 'ACTIVE' } as never)
    const onChange = vi.fn()
    render(<Harness value="Agrosuper" onChange={onChange} />)
    fireEvent.focus(screen.getByLabelText('Cliente'))
    fireEvent.click(await screen.findByText('Crear cliente “Agrosuper”'))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('Agrosuper'))
    expect(shippersApi.create).toHaveBeenCalledWith({ name: 'Agrosuper' })
  })

  it('on a 409 duplicate race, selects the name anyway instead of showing an error', async () => {
    vi.mocked(shippersApi.create).mockRejectedValue(new ApiError('Ya existe', 409, {}))
    const onChange = vi.fn()
    render(<Harness value="Agrosuper" onChange={onChange} />)
    fireEvent.focus(screen.getByLabelText('Cliente'))
    fireEvent.click(await screen.findByText('Crear cliente “Agrosuper”'))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('Agrosuper'))
    expect(screen.queryByText('Ya existe')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Correr los tests y confirmar que fallan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/ClientPicker.test.tsx`
Expected: FAIL — `./ClientPicker` no existe todavía.

- [ ] **Step 4: Implementar `ClientPicker`**

Crear `monitor-app/frontend/components/dashboard/ClientPicker.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Search, Loader2, Building2, Plus } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { shippersApi } from '@/lib/api/locations'
import { ApiError } from '@/lib/api/client'

interface Props {
  /** client_name actual — texto libre o el nombre exacto de un shipper real */
  value:       string
  onChange:    (name: string) => void
  placeholder?: string
  size?:       'sm' | 'md'
}

export function ClientPicker({ value, onChange, placeholder = 'Cliente…', size = 'md' }: Props) {
  const [open, setOpen]         = useState(false)
  const [creating, setCreating] = useState(false)
  const [err, setErr]           = useState<string | null>(null)

  const shippersQuery = useQuery({
    queryKey: ['shippers', 'list'],
    queryFn: () => shippersApi.list(),
    staleTime: 5 * 60 * 1000,
  })
  const shippers = shippersQuery.data ?? []
  const q = value.trim().toLowerCase()
  const results = q ? shippers.filter(s => s.name.toLowerCase().includes(q)) : shippers
  const exactMatch = shippers.some(s => s.name.toLowerCase() === q)

  async function handleCreate() {
    const name = value.trim()
    if (!name) return
    setCreating(true); setErr(null)
    try {
      const created = await shippersApi.create({ name })
      onChange(created.name)
      setOpen(false)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Carrera: alguien más lo creó justo antes — igual queda seleccionado,
        // no es un error real desde la perspectiva del operador.
        await shippersQuery.refetch()
        onChange(name)
        setOpen(false)
      } else {
        setErr(e instanceof Error ? e.message : 'Error al crear el cliente')
      }
    } finally {
      setCreating(false)
    }
  }

  const inputCls = size === 'sm'
    ? 'w-full text-xs border border-border rounded-lg pl-7 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/20'
    : 'w-full text-sm border border-border rounded-lg pl-8 pr-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all placeholder:text-gray-300'
  const iconSize = size === 'sm' ? 12 : 13

  return (
    <div className="relative">
      <div className="relative">
        <Search size={iconSize} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          aria-label="Cliente"
          className={inputCls}
        />
      </div>
      {open && (
        <div className="max-h-40 overflow-y-auto border border-border rounded-lg divide-y divide-border/60 mt-1.5 absolute z-10 bg-white w-full shadow-lg">
          {shippersQuery.isLoading && (
            <p className="px-3 py-2 text-center text-[11px] text-gray-400 flex items-center justify-center gap-1.5">
              <Loader2 size={11} className="animate-spin" /> Cargando…
            </p>
          )}
          {!shippersQuery.isLoading && results.map(s => (
            <button
              key={s.id}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange(s.name); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
            >
              <Building2 size={12} className="text-gray-400 shrink-0" />
              <p className="text-[11px] font-semibold text-text-primary truncate">{s.name}</p>
            </button>
          ))}
          {!shippersQuery.isLoading && q && !exactMatch && (
            <button
              type="button"
              disabled={creating}
              onMouseDown={e => e.preventDefault()}
              onClick={handleCreate}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/5 transition-colors text-accent disabled:opacity-50"
            >
              {creating ? <Loader2 size={12} className="animate-spin shrink-0" /> : <Plus size={12} className="shrink-0" />}
              <p className="text-[11px] font-semibold truncate">Crear cliente &ldquo;{value.trim()}&rdquo;</p>
            </button>
          )}
          {!shippersQuery.isLoading && !q && results.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-gray-400">Sin clientes registrados</p>
          )}
        </div>
      )}
      {err && <p className="text-[11px] text-red-500 mt-1">{err}</p>}
    </div>
  )
}
```

- [ ] **Step 5: Correr los tests y confirmar que pasan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/ClientPicker.test.tsx`
Expected: 6 passed.

- [ ] **Step 6: `tsc` limpio y suite completa**

Run: `cd monitor-app/frontend && npx tsc --noEmit && npm test`
Expected: sin errores de tipos; toda la suite de vitest pasa (incluye los tests nuevos de las 3 tasks + los ya existentes, sin regresiones).

- [ ] **Step 7: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/frontend/lib/api/locations.ts monitor-app/frontend/components/dashboard/ClientPicker.tsx monitor-app/frontend/components/dashboard/ClientPicker.test.tsx
git commit -m "feat(diario): ClientPicker — selector de cliente contra public.shippers, crea uno nuevo al vuelo"
```

---

## Self-Review

**1. Cobertura del spec**: cubre los 3 componentes del Plan 2 (`RouteEditor`, `FleetAssignSection`, `ClientPicker`) descritos en `docs/superpowers/specs/2026-07-19-diario-fase2-bitacora-design.md`. No wirea `TripAssignDialog`/`TripSlideOver` — eso es explícitamente Plan 3/Plan 4, fuera de este documento.
**2. Placeholders**: ninguno — cada paso tiene código completo, incluyendo los 3 componentes enteros y sus tests. La nota del Step 3 de la Task 2 (retirar el helper `Field` sin uso) es una instrucción de limpieza concreta, no un placeholder.
**3. Consistencia de tipos**: `FleetAssignValue` se usa igual en el componente (Task 2) y sus tests; `TripStopCreatePayload.stop_type` (Task 1) es el mismo tipo que ya espera el backend desde el Plan 1 de esta Fase (`TripStopCreate.stop_type` en `trips.py`, ya commiteado); `Shipper`/`shippersApi.create` (Task 3) reusa el tipo `Shipper` ya existente en `lib/api/locations.ts`, sin duplicarlo.
**4. Alcance**: 100% frontend, sin dependencias del Plan 1 backend más allá de contratos ya commiteados y verificados en producción (`stop_type` en `POST /trips`, `POST /shippers`). Sin riesgo de romper `TripAssignDialog.tsx`/`TripSlideOver.tsx` — ninguno de los dos se toca, y el único tipo compartido modificado (`TripStopCreatePayload`) es aditivo.
**5. Orden entre tasks**: las 3 tasks son independientes entre sí (no hay imports cruzados) — pueden ejecutarse en cualquier orden, aunque el documento las presenta en el mismo orden que las usará el Plan 3 (origen/paradas → conductor/flota → cliente) por legibilidad.
