# Certificación: panel lateral por empresa + alta desde el módulo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Certificación (`/dashboard/certification`) gana un panel lateral por empresa (subir individual/masivo sin salir del módulo) y un botón "+ Nueva empresa", reutilizando componentes ya construidos (`TransporterSlideOver` como patrón, `BulkDocumentUploadModal`, `CarrierSearchPicker`) sin tocar su comportamiento interno.

**Architecture:** Sin cambios de backend ni de rutas. Un componente nuevo (`CertificationCompanyPanel`) y una extracción (`NewCarrierPanel`, sacado del panel de alta inline de `carriers/page.tsx`) se integran en `PendingDocumentsTable.tsx` y `app/dashboard/certification/page.tsx`.

**Tech Stack:** Next.js (App Router) + React + TanStack Query + Tailwind + Vitest/Testing Library, mismo stack que el resto del frontend.

## Global Constraints

- Sin cambios de backend — todos los endpoints necesarios (`GET /compliance-records/pending`, `POST /compliance-records/{id}/file`, `POST /compliance-records/bulk-file`, `POST /carriers`) ya existen y ya están probados.
- No modificar `BulkDocumentUploadModal.tsx`, `CarrierSearchPicker.tsx` ni `TransporterSlideOver.tsx` — se reusan tal cual.
- No tocar el modelo de datos ni los endpoints de Seguros (`insurance_policies`/etc.).
- El flujo de checkboxes + "Subir masivo" ya existente en `PendingDocumentsTable`/`certification/page.tsx` sigue funcionando sin cambios de comportamiento — el panel nuevo es una puerta de entrada adicional, no un reemplazo.
- Spec completo: `docs/superpowers/specs/2026-08-04-certificacion-por-empresa-design.md`.

---

## Task 1: Extraer `NewCarrierPanel.tsx`

**Files:**
- Create: `monitor-app/frontend/components/dashboard/NewCarrierPanel.tsx`
- Test: `monitor-app/frontend/components/dashboard/NewCarrierPanel.test.tsx`

**Interfaces:**
- Consumes: `carriersApi.create(body: CarrierCreateBody) => Promise<CarrierCreateResult>` (`lib/api/carriers.ts`, ya existe, sin cambios).
- Produces: `export function NewCarrierPanel({ open, initialBusinessName, onClose, onCreated }: Props)` donde `Props = { open: boolean; initialBusinessName?: string; onClose: () => void; onCreated: (carrier: CarrierCreateResult) => void }`. Usado por Task 2 y Task 6.

- [ ] **Step 1: Escribir el test que falla**

```tsx
// monitor-app/frontend/components/dashboard/NewCarrierPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NewCarrierPanel } from './NewCarrierPanel'
import { carriersApi } from '@/lib/api/carriers'

vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { create: vi.fn() },
}))

beforeEach(() => {
  vi.mocked(carriersApi.create).mockReset()
})

describe('NewCarrierPanel', () => {
  it('renders nothing when open=false', () => {
    render(<NewCarrierPanel open={false} onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.queryByText('Nueva empresa')).not.toBeInTheDocument()
  })

  it('pre-fills business_name from initialBusinessName', () => {
    render(<NewCarrierPanel open initialBusinessName="Agrocapilla Ltda" onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.getByLabelText('Razón social')).toHaveValue('Agrocapilla Ltda')
  })

  it('disables the create button until both fields are filled', () => {
    render(<NewCarrierPanel open onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Crear empresa/ })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Tax ID'), { target: { value: '76217085-K' } })
    expect(screen.getByRole('button', { name: /Crear empresa/ })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Razón social'), { target: { value: 'Nueva Spa' } })
    expect(screen.getByRole('button', { name: /Crear empresa/ })).toBeEnabled()
  })

  it('creates the carrier and calls onCreated with the result', async () => {
    const created = { id: 'c9', tax_id: '76217085-K', country_code: 'CL', business_name: 'Nueva Spa', operational_status: 'ACTIVE' as const, created_at: null }
    vi.mocked(carriersApi.create).mockResolvedValue(created)
    const onCreated = vi.fn()
    render(<NewCarrierPanel open onClose={vi.fn()} onCreated={onCreated} />)
    fireEvent.change(screen.getByLabelText('Tax ID'), { target: { value: '76217085-K' } })
    fireEvent.change(screen.getByLabelText('Razón social'), { target: { value: 'Nueva Spa' } })
    fireEvent.click(screen.getByRole('button', { name: /Crear empresa/ }))
    await waitFor(() => expect(carriersApi.create).toHaveBeenCalledWith({ tax_id: '76217085-K', business_name: 'Nueva Spa' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created))
  })

  it('shows an inline error when creation fails, without calling onCreated', async () => {
    vi.mocked(carriersApi.create).mockRejectedValue(new Error('Tax ID duplicado'))
    const onCreated = vi.fn()
    render(<NewCarrierPanel open onClose={vi.fn()} onCreated={onCreated} />)
    fireEvent.change(screen.getByLabelText('Tax ID'), { target: { value: '76217085-K' } })
    fireEvent.change(screen.getByLabelText('Razón social'), { target: { value: 'Nueva Spa' } })
    fireEvent.click(screen.getByRole('button', { name: /Crear empresa/ }))
    expect(await screen.findByText('Tax ID duplicado')).toBeInTheDocument()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('calls onClose when Cancelar is clicked', () => {
    const onClose = vi.fn()
    render(<NewCarrierPanel open onClose={onClose} onCreated={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Cancelar'))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/NewCarrierPanel.test.tsx`
Expected: FAIL — `Cannot find module './NewCarrierPanel'`.

- [ ] **Step 3: Implementar el componente**

```tsx
// monitor-app/frontend/components/dashboard/NewCarrierPanel.tsx
'use client'

import { useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { carriersApi, type CarrierCreateResult } from '@/lib/api/carriers'

interface Props {
  open:                 boolean
  initialBusinessName?: string
  onClose:              () => void
  onCreated:            (carrier: CarrierCreateResult) => void
}

/** Panel de alta de empresa — extraído de app/dashboard/carriers/page.tsx
 *  (Ronda 89) para reusarlo también desde Certificación. El backend siembra
 *  compliance_records en MISSING automáticamente al insertar (ver
 *  routers/carriers.py) — el caller decide qué hacer después de crear:
 *  carriers/page.tsx navega a la ficha nueva, Certificación abre el panel
 *  de documentos de esa empresa sin salir del módulo. */
export function NewCarrierPanel({ open, initialBusinessName = '', onClose, onCreated }: Props) {
  const [form, setForm]         = useState({ tax_id: '', business_name: initialBusinessName })
  const [creating, setCreating] = useState(false)
  const [err, setErr]           = useState<string | null>(null)

  async function handleCreate() {
    if (!form.tax_id || !form.business_name) return
    setCreating(true); setErr(null)
    try {
      const created = await carriersApi.create(form)
      onCreated(created)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al crear la empresa')
    } finally {
      setCreating(false)
    }
  }

  function handleClose() {
    setErr(null)
    onClose()
  }

  if (!open) return null

  return (
    <div className="bg-white border border-border rounded-2xl p-4 max-w-sm space-y-2">
      <p className="text-xs font-bold text-text-primary mb-1">Nueva empresa</p>
      <input
        placeholder="Tax ID"
        aria-label="Tax ID"
        value={form.tax_id}
        onChange={e => setForm(v => ({ ...v, tax_id: e.target.value }))}
        className="w-full text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30"
      />
      <input
        placeholder="Razón social"
        aria-label="Razón social"
        value={form.business_name}
        onChange={e => setForm(v => ({ ...v, business_name: e.target.value }))}
        className="w-full text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30"
      />
      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleCreate}
          disabled={creating || !form.tax_id || !form.business_name}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 disabled:opacity-50"
        >
          {creating ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Crear empresa
        </button>
        <button onClick={handleClose} aria-label="Cancelar" className="p-1.5 text-gray-400 hover:text-gray-600">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run components/dashboard/NewCarrierPanel.test.tsx`
Expected: PASS — 6/6 tests.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/NewCarrierPanel.tsx monitor-app/frontend/components/dashboard/NewCarrierPanel.test.tsx
git commit -m "feat(certificacion): extrae NewCarrierPanel reusable del alta inline de Empresas"
```

---

## Task 2: Usar `NewCarrierPanel` en `carriers/page.tsx`

**Files:**
- Modify: `monitor-app/frontend/app/dashboard/carriers/page.tsx`

**Interfaces:**
- Consumes: `NewCarrierPanel` de Task 1 (`{ open, initialBusinessName, onClose, onCreated }`).

No hay test file para esta página hoy (confirmado, no existe `carriers/page.test.tsx`) — este task se verifica con `tsc`/`build` y una pasada manual/Playwright al final del plan (Task 7), no agrega un test file nuevo (fuera del alcance del spec aprobado).

- [ ] **Step 1: Agregar el import y quitar los que dejan de usarse**

En `monitor-app/frontend/app/dashboard/carriers/page.tsx`, reemplazar:

```tsx
import { Building2, ChevronLeft, ChevronRight, Search, Loader2, ShieldAlert, ShieldCheck, Plus, Check, X } from 'lucide-react'
```

por:

```tsx
import { Building2, ChevronLeft, ChevronRight, Search, Loader2, ShieldAlert, ShieldCheck, Plus } from 'lucide-react'
```

(`Check` y `X` de `lucide-react` solo se usaban dentro del panel inline que se elimina en el Step 3 — confirmado con `grep -n "<Check\|<X " app/dashboard/carriers/page.tsx`, la única otra ocurrencia en el archivo es `Loader2` en la línea de estado de carga de la tabla, que sigue en el import).

Agregar, junto a los demás imports de `@/components/dashboard/...`:

```tsx
import { NewCarrierPanel } from '@/components/dashboard/NewCarrierPanel'
import type { CarrierCreateResult } from '@/lib/api/carriers'
```

- [ ] **Step 2: Reemplazar el estado del formulario inline**

Reemplazar:

```tsx
  const [addCarrierOpen, setAddCarrierOpen] = useState(searchParams.get('create') === '1')
  const [carrierForm, setCarrierForm] = useState({
    tax_id: '',
    business_name: searchParams.get('business_name') ?? '',
  })
  const [creatingCarrier, setCreatingCarrier] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)
```

por:

```tsx
  const [addCarrierOpen, setAddCarrierOpen] = useState(searchParams.get('create') === '1')
```

- [ ] **Step 3: Reemplazar `handleAddCarrier` por `handleCarrierCreated`**

Reemplazar:

```tsx
  /** Alta manual de una empresa (distinta del bulk-load de Mage) — el
   *  backend siembra los compliance_records MISSING automáticamente al
   *  insertar. Redirige a la ficha recién creada: ahí ya existen los flujos
   *  reales de alta de conductores/equipos/contactos/pólizas ("+ Conductor"/
   *  "+ Equipo"/"+ Póliza"), no hace falta duplicarlos acá. */
  async function handleAddCarrier() {
    if (!carrierForm.tax_id || !carrierForm.business_name) return
    setCreatingCarrier(true); setCreateErr(null)
    try {
      const created = await carriersApi.create(carrierForm)
      // Ronda 43 (Hallazgo F): si venimos del flujo guiado de "Sin
      // identificar", reenviar conductor/patente ya reportados por el TMS
      // para pre-cargar "+ Conductor"/"+ Equipo" en la ficha recién creada.
      const handoff = new URLSearchParams()
      const driverName = searchParams.get('driver_name')
      const tractorPlate = searchParams.get('tractor_plate')
      if (driverName)   handoff.set('driver_name', driverName)
      if (tractorPlate) handoff.set('tractor_plate', tractorPlate)
      const qs = handoff.toString()
      router.push(`/dashboard/carriers/${created.id}${qs ? `?${qs}` : ''}`)
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : 'Error al crear la empresa')
    } finally {
      setCreatingCarrier(false)
    }
  }
```

por:

```tsx
  /** Alta manual de una empresa (distinta del bulk-load de Mage) — el
   *  formulario en sí vive en NewCarrierPanel (reusado también desde
   *  Certificación); acá solo se decide qué pasa después de crear: redirige
   *  a la ficha recién creada, donde ya existen los flujos reales de alta
   *  de conductores/equipos/contactos/pólizas ("+ Conductor"/"+ Equipo"/
   *  "+ Póliza"), no hace falta duplicarlos acá. */
  function handleCarrierCreated(created: CarrierCreateResult) {
    // Ronda 43 (Hallazgo F): si venimos del flujo guiado de "Sin
    // identificar", reenviar conductor/patente ya reportados por el TMS
    // para pre-cargar "+ Conductor"/"+ Equipo" en la ficha recién creada.
    const handoff = new URLSearchParams()
    const driverName = searchParams.get('driver_name')
    const tractorPlate = searchParams.get('tractor_plate')
    if (driverName)   handoff.set('driver_name', driverName)
    if (tractorPlate) handoff.set('tractor_plate', tractorPlate)
    const qs = handoff.toString()
    router.push(`/dashboard/carriers/${created.id}${qs ? `?${qs}` : ''}`)
  }
```

- [ ] **Step 4: Reemplazar el JSX del panel inline por `NewCarrierPanel`**

Reemplazar:

```tsx
      {addCarrierOpen && (
        <div className="bg-white border border-border rounded-2xl p-4 max-w-sm space-y-2">
          <p className="text-xs font-bold text-text-primary mb-1">Nueva empresa</p>
          <input
            placeholder="Tax ID"
            value={carrierForm.tax_id}
            onChange={e => setCarrierForm(v => ({ ...v, tax_id: e.target.value }))}
            className="w-full text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <input
            placeholder="Razón social"
            value={carrierForm.business_name}
            onChange={e => setCarrierForm(v => ({ ...v, business_name: e.target.value }))}
            className="w-full text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          {createErr && <p className="text-xs text-red-500">{createErr}</p>}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleAddCarrier}
              disabled={creatingCarrier || !carrierForm.tax_id || !carrierForm.business_name}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 disabled:opacity-50"
            >
              {creatingCarrier ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Crear y abrir ficha
            </button>
            <button onClick={() => { setAddCarrierOpen(false); setCreateErr(null) }} className="p-1.5 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          </div>
        </div>
      )}
```

por:

```tsx
      <NewCarrierPanel
        open={addCarrierOpen}
        initialBusinessName={searchParams.get('business_name') ?? ''}
        onClose={() => setAddCarrierOpen(false)}
        onCreated={handleCarrierCreated}
      />
```

- [ ] **Step 5: Verificar que compila**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/app/dashboard/carriers/page.tsx
git commit -m "refactor(carriers): usa NewCarrierPanel extraído en vez del formulario inline"
```

---

## Task 3: Crear `CertificationCompanyPanel.tsx`

**Files:**
- Create: `monitor-app/frontend/components/dashboard/CertificationCompanyPanel.tsx`
- Test: `monitor-app/frontend/components/dashboard/CertificationCompanyPanel.test.tsx`

**Interfaces:**
- Consumes: `complianceApi.listPending({ carrierId, limit }) => Promise<PendingComplianceListResponse>` y `complianceApi.uploadFile(id, file)` (`lib/api/compliance.ts`, ya existen). `BulkDocumentUploadModal` (`{ open, carrierId, carrierName, carrierTaxId, pendingSlots, onClose, onSaved }`, ya existe, sin cambios).
- Produces: `export function CertificationCompanyPanel({ carrierId, onClose }: Props)` donde `Props = { carrierId: string | null; onClose: () => void }`. Usado por Task 6.

- [ ] **Step 1: Escribir el test que falla**

```tsx
// monitor-app/frontend/components/dashboard/CertificationCompanyPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CertificationCompanyPanel } from './CertificationCompanyPanel'
import { complianceApi } from '@/lib/api/compliance'
import type { PendingComplianceRow } from '@/lib/types'

vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listPending: vi.fn(), uploadFile: vi.fn(), bulkUploadFile: vi.fn() },
}))

function makeRow(overrides: Partial<PendingComplianceRow> = {}): PendingComplianceRow {
  return {
    id: 'r1', carrier_id: 'c1', carrier_name: 'Agrocapilla Ltda', carrier_tax_id: '76217085-K',
    carrier_operation_types: ['Tractoreo'], certification_type: 'BASICA', category: 'EMPRESA',
    entity_type: 'CARRIER', entity_id: 'c1', subject_name: null,
    requirement_code: 'POLIZA', document_name: 'Póliza de Seguro Vigente',
    status: 'MISSING', expiration_date: null,
    ...overrides,
  }
}

function renderPanel(carrierId: string | null, onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CertificationCompanyPanel carrierId={carrierId} onClose={onClose} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(complianceApi.listPending).mockReset().mockResolvedValue({ total: 1, rows: [makeRow()] })
  vi.mocked(complianceApi.uploadFile).mockReset()
})

describe('CertificationCompanyPanel', () => {
  it('renders nothing when carrierId is null', () => {
    renderPanel(null)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the company name, tax id and pending documents', async () => {
    renderPanel('c1')
    expect(await screen.findByText('Agrocapilla Ltda')).toBeInTheDocument()
    expect(screen.getByText('76217085-K')).toBeInTheDocument()
    expect(screen.getByText('Póliza de Seguro Vigente')).toBeInTheDocument()
  })

  it('fetches all pending rows for that carrier via listPending', async () => {
    renderPanel('c1')
    await screen.findByText('Póliza de Seguro Vigente')
    expect(complianceApi.listPending).toHaveBeenCalledWith({ carrierId: 'c1', limit: 200 })
  })

  it('uploads a file via the per-row control', async () => {
    renderPanel('c1')
    await screen.findByText('Póliza de Seguro Vigente')
    const file = new File(['x'], 'poliza.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Subir Póliza de Seguro Vigente'), { target: { files: [file] } })
    await waitFor(() => expect(complianceApi.uploadFile).toHaveBeenCalledWith('r1', file))
  })

  it('shows "Sin documentos pendientes" when there are none', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 0, rows: [] })
    renderPanel('c1')
    expect(await screen.findByText('Sin documentos pendientes')).toBeInTheDocument()
  })

  it('opens the bulk upload modal scoped to this carrier', async () => {
    renderPanel('c1')
    await screen.findByText('Póliza de Seguro Vigente')
    fireEvent.click(screen.getByRole('button', { name: 'Subir masivo' }))
    expect(await screen.findByText('Empresa Agrocapilla Ltda — 76217085-K')).toBeInTheDocument()
  })

  it('disables "Subir masivo" when there are no pending rows', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 0, rows: [] })
    renderPanel('c1')
    await screen.findByText('Sin documentos pendientes')
    expect(screen.getByRole('button', { name: 'Subir masivo' })).toBeDisabled()
  })

  it('links to the full carrier ficha', async () => {
    renderPanel('c1')
    await screen.findByText('Póliza de Seguro Vigente')
    expect(screen.getByRole('link', { name: /Ver ficha completa/ })).toHaveAttribute('href', '/dashboard/carriers/c1')
  })

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    renderPanel('c1', onClose)
    await screen.findByText('Póliza de Seguro Vigente')
    fireEvent.click(screen.getByLabelText('Cerrar'))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run components/dashboard/CertificationCompanyPanel.test.tsx`
Expected: FAIL — `Cannot find module './CertificationCompanyPanel'`.

- [ ] **Step 3: Implementar el componente**

```tsx
// monitor-app/frontend/components/dashboard/CertificationCompanyPanel.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Upload, Loader2, ArrowRight } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { BulkDocumentUploadModal } from './BulkDocumentUploadModal'

interface Props {
  carrierId: string | null
  onClose:   () => void
}

/** Panel de documentos de una empresa — se abre al clickear una empresa en
 *  la sábana de Certificación (Ronda 89). Mismo patrón de dialog que
 *  TransporterSlideOver (Empresas), pero angosto en propósito: solo
 *  pendientes de compliance + acciones de carga — el resumen de
 *  contactos/seguros sigue siendo exclusivo del slide-over de Empresas. */
export function CertificationCompanyPanel({ carrierId, onClose }: Props) {
  const open = !!carrierId
  const panelRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const [bulkOpen, setBulkOpen] = useState(false)

  const query = useQuery({
    queryKey: ['compliance-pending-carrier-panel', carrierId],
    queryFn: () => complianceApi.listPending({ carrierId: carrierId!, limit: 200 }),
    enabled: !!carrierId,
  })

  useEffect(() => {
    if (!open) return
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
  }, [open, onClose])

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['compliance-pending-carrier-panel', carrierId] })
    queryClient.invalidateQueries({ queryKey: ['compliance-pending'] })
  }

  async function handleUploadSingle(recordId: string, file: File) {
    await complianceApi.uploadFile(recordId, file)
    invalidate()
  }

  function handleBulkSaved() {
    setBulkOpen(false)
    invalidate()
  }

  if (!open) return null

  const rows = query.data?.rows ?? []
  const carrierName = rows[0]?.carrier_name ?? ''
  const carrierTaxId = rows[0]?.carrier_tax_id ?? ''

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Documentos pendientes de ${carrierName || 'la empresa'}`}
          tabIndex={-1}
          className="relative bg-white rounded-2xl shadow-2xl w-[92vw] max-w-lg max-h-[85vh] overflow-hidden flex flex-col focus:outline-none animate-modal-in"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <div className="min-w-0">
              <p className="text-sm font-bold text-text-primary truncate">
                {query.isPending ? 'Cargando…' : (carrierName || 'Empresa')}
              </p>
              {carrierTaxId && <p className="text-[11px] text-gray-400 font-mono">{carrierTaxId}</p>}
            </div>
            <button onClick={onClose} aria-label="Cerrar" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors shrink-0">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 p-5 space-y-3">
            {query.isPending && (
              <p className="text-xs text-gray-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Cargando…</p>
            )}
            {query.error && (
              <p className="text-xs text-red-500">
                {query.error instanceof Error ? query.error.message : 'Error al cargar los documentos pendientes'}
              </p>
            )}
            {!query.isPending && !query.error && rows.length === 0 && (
              <p className="text-xs text-gray-400 italic">Sin documentos pendientes</p>
            )}
            {!query.isPending && !query.error && rows.map(r => (
              <div key={r.id} className="flex items-center gap-2.5 rounded-lg bg-gray-50 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-text-primary truncate">{r.document_name}</p>
                  <p className="text-[10px] text-gray-400">{r.subject_name ?? r.category}</p>
                </div>
                <label className="flex items-center gap-1 text-[11px] font-semibold text-accent border border-dashed border-accent/40 rounded-md px-2 py-1 hover:bg-accent/5 transition-colors cursor-pointer shrink-0">
                  <Upload size={11} /> Subir
                  <input
                    type="file"
                    className="hidden"
                    aria-label={`Subir ${r.document_name}`}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadSingle(r.id, f) }}
                  />
                </label>
              </div>
            ))}
          </div>

          <div className="shrink-0 border-t border-border px-5 py-4 space-y-2">
            <button
              type="button"
              onClick={() => setBulkOpen(true)}
              disabled={rows.length === 0}
              className="w-full flex items-center justify-center gap-2 bg-accent text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-40 transition-colors"
            >
              Subir masivo
            </button>
            <Link
              href={`/dashboard/carriers/${carrierId}`}
              className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-gray-600 hover:text-accent transition-colors py-1"
            >
              Ver ficha completa <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </div>

      {bulkOpen && (
        <BulkDocumentUploadModal
          open
          carrierId={carrierId!}
          carrierName={carrierName}
          carrierTaxId={carrierTaxId}
          pendingSlots={rows}
          onClose={() => setBulkOpen(false)}
          onSaved={handleBulkSaved}
        />
      )}
    </>
  )
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run components/dashboard/CertificationCompanyPanel.test.tsx`
Expected: PASS — 9/9 tests.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/CertificationCompanyPanel.tsx monitor-app/frontend/components/dashboard/CertificationCompanyPanel.test.tsx
git commit -m "feat(certificacion): panel de documentos por empresa (CertificationCompanyPanel)"
```

---

## Task 4: Nombre de empresa clickeable en `PendingDocumentsTable`

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/PendingDocumentsTable.tsx`
- Modify: `monitor-app/frontend/components/dashboard/PendingDocumentsTable.test.tsx`

**Interfaces:**
- Produces: nuevo prop `onOpenCompanyPanel: (carrierId: string) => void` en `PendingDocumentsTable`. Consumido por Task 6.

- [ ] **Step 1: Escribir el test que falla (agregar el caso nuevo + el prop a todos los renders existentes)**

Reemplazar el contenido completo de `monitor-app/frontend/components/dashboard/PendingDocumentsTable.test.tsx` por:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PendingDocumentsTable } from './PendingDocumentsTable'
import type { PendingComplianceRow } from '@/lib/types'

function makeRow(overrides: Partial<PendingComplianceRow> = {}): PendingComplianceRow {
  return {
    id: 'r1', carrier_id: 'c1', carrier_name: 'Transportes Sur Spa', carrier_tax_id: '76.111.111-1',
    carrier_operation_types: ['Tractoreo'], certification_type: 'BASICA', category: 'CHOFER',
    entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Perez',
    requirement_code: 'LICENCIA_CONDUCIR', document_name: 'Licencia conducir',
    status: 'MISSING', expiration_date: null,
    ...overrides,
  }
}

const BASE_PROPS = {
  onToggle: vi.fn(), onToggleAll: vi.fn(), onUploadSingle: vi.fn(),
  onOpenBulkUpload: vi.fn(), onOpenCompanyPanel: vi.fn(),
}

describe('PendingDocumentsTable', () => {
  it('renders a placeholder when there are no pending rows', () => {
    render(<PendingDocumentsTable rows={[]} selected={new Set()} {...BASE_PROPS} />)
    expect(screen.getByText('Sin documentos pendientes')).toBeInTheDocument()
  })

  it('renders EETT, categoría, sub categoría, tipo de documento and the operation type chip', () => {
    render(<PendingDocumentsTable rows={[makeRow()]} selected={new Set()} {...BASE_PROPS} />)
    expect(screen.getByText('Transportes Sur Spa')).toBeInTheDocument()
    expect(screen.getByText('Tractoreo')).toBeInTheDocument()
    expect(screen.getByText('CHOFER')).toBeInTheDocument()
    expect(screen.getByText('Juan Perez')).toBeInTheDocument()
    expect(screen.getByText('Licencia conducir')).toBeInTheDocument()
  })

  it('does not show the bulk action bar when nothing is selected', () => {
    render(<PendingDocumentsTable rows={[makeRow()]} selected={new Set()} {...BASE_PROPS} />)
    expect(screen.queryByText('Subir masivo')).not.toBeInTheDocument()
  })

  it('enables "Subir masivo" only when the whole selection is a single carrier', () => {
    const rows = [makeRow({ id: 'r1', carrier_id: 'c1' }), makeRow({ id: 'r2', carrier_id: 'c1' })]
    render(<PendingDocumentsTable rows={rows} selected={new Set(['r1', 'r2'])} {...BASE_PROPS} />)
    expect(screen.getByRole('button', { name: 'Subir masivo' })).toBeEnabled()
  })

  it('disables "Subir masivo" and warns when the selection spans multiple carriers', () => {
    const rows = [makeRow({ id: 'r1', carrier_id: 'c1' }), makeRow({ id: 'r2', carrier_id: 'c2', carrier_name: 'Otra Empresa' })]
    render(<PendingDocumentsTable rows={rows} selected={new Set(['r1', 'r2'])} {...BASE_PROPS} />)
    expect(screen.getByRole('button', { name: 'Subir masivo' })).toBeDisabled()
    expect(screen.getByText('La carga masiva solo puede ser de una empresa a la vez')).toBeInTheDocument()
  })

  it('calls onToggle when a row checkbox is clicked', () => {
    const onToggle = vi.fn()
    render(<PendingDocumentsTable rows={[makeRow()]} selected={new Set()} {...BASE_PROPS} onToggle={onToggle} />)
    fireEvent.click(screen.getByLabelText('Seleccionar Licencia conducir de Juan Perez'))
    expect(onToggle).toHaveBeenCalledWith('r1')
  })

  it('calls onToggleAll when the header checkbox is clicked', () => {
    const onToggleAll = vi.fn()
    render(<PendingDocumentsTable rows={[makeRow()]} selected={new Set()} {...BASE_PROPS} onToggleAll={onToggleAll} />)
    fireEvent.click(screen.getByLabelText('Seleccionar todo'))
    expect(onToggleAll).toHaveBeenCalled()
  })

  it('calls onUploadSingle with the record id and the chosen file', () => {
    const onUploadSingle = vi.fn()
    render(<PendingDocumentsTable rows={[makeRow()]} selected={new Set()} {...BASE_PROPS} onUploadSingle={onUploadSingle} />)
    const file = new File(['x'], 'licencia.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Archivo para Licencia conducir'), { target: { files: [file] } })
    expect(onUploadSingle).toHaveBeenCalledWith('r1', file)
  })

  it('calls onOpenBulkUpload when "Subir masivo" is clicked and enabled', () => {
    const onOpenBulkUpload = vi.fn()
    render(<PendingDocumentsTable rows={[makeRow()]} selected={new Set(['r1'])} {...BASE_PROPS} onOpenBulkUpload={onOpenBulkUpload} />)
    fireEvent.click(screen.getByRole('button', { name: 'Subir masivo' }))
    expect(onOpenBulkUpload).toHaveBeenCalled()
  })

  it('calls onOpenCompanyPanel with the carrier id when the company name is clicked', () => {
    const onOpenCompanyPanel = vi.fn()
    render(<PendingDocumentsTable rows={[makeRow()]} selected={new Set()} {...BASE_PROPS} onOpenCompanyPanel={onOpenCompanyPanel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Transportes Sur Spa' }))
    expect(onOpenCompanyPanel).toHaveBeenCalledWith('c1')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run components/dashboard/PendingDocumentsTable.test.tsx`
Expected: FAIL — `onOpenCompanyPanel` no existe en `Props`, y el nombre de empresa no es un `button` (el test nuevo no encuentra el rol).

- [ ] **Step 3: Agregar el prop y hacer clickeable el nombre de empresa**

En `monitor-app/frontend/components/dashboard/PendingDocumentsTable.tsx`, en la interfaz `Props`, agregar después de `onOpenBulkUpload`:

```tsx
  onOpenBulkUpload:  () => void
  /** Abre el panel de documentos de esa empresa (Ronda 89) — clic en el
   *  nombre de la fila, coexiste con el checkbox de selección múltiple. */
  onOpenCompanyPanel: (carrierId: string) => void
}
```

En la firma de la función, agregar el prop nuevo:

```tsx
export function PendingDocumentsTable({ rows, selected, onToggle, onToggleAll, onUploadSingle, onOpenBulkUpload, onOpenCompanyPanel }: Props) {
```

Reemplazar:

```tsx
                <td className="px-3 py-2">
                  <p className="font-semibold text-text-primary whitespace-nowrap">{r.carrier_name}</p>
                  {r.carrier_operation_types.length > 0 && (
```

por:

```tsx
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onOpenCompanyPanel(r.carrier_id)}
                    className="font-semibold text-text-primary hover:text-accent hover:underline whitespace-nowrap transition-colors"
                  >
                    {r.carrier_name}
                  </button>
                  {r.carrier_operation_types.length > 0 && (
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run components/dashboard/PendingDocumentsTable.test.tsx`
Expected: PASS — 10/10 tests.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/PendingDocumentsTable.tsx monitor-app/frontend/components/dashboard/PendingDocumentsTable.test.tsx
git commit -m "feat(certificacion): nombre de empresa clickeable en la sábana, abre el panel por empresa"
```

---

## Task 5: Filtro "Empresa" en `certification/page.tsx`

**Files:**
- Modify: `monitor-app/frontend/app/dashboard/certification/page.tsx`
- Modify: `monitor-app/frontend/app/dashboard/certification/page.test.tsx`

**Interfaces:**
- Consumes: `CarrierSearchPicker` (`{ query, onQueryChange, onPick, placeholder?, size? }`, ya existe, sin cambios) y `CarrierSearchResult = { id: string; business_name: string; tax_id: string }` (exportado por `CarrierSearchPicker.tsx`).

- [ ] **Step 1: Escribir los tests que fallan**

En `monitor-app/frontend/app/dashboard/certification/page.test.tsx`, agregar el mock de `carriersApi` junto a los mocks existentes (al inicio del archivo, después del mock de `next/navigation`):

```tsx
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { list: vi.fn(), create: vi.fn() },
}))
```

Agregar el import correspondiente junto a los demás imports:

```tsx
import { carriersApi } from '@/lib/api/carriers'
```

En el `beforeEach`, agregar:

```tsx
  vi.mocked(carriersApi.list).mockReset().mockResolvedValue({ data: [{ id: 'c2', business_name: 'Otra Spa', tax_id: '77.222.222-2' }], count: 1, page: 1, limit: 10 })
```

Agregar estos dos tests nuevos al final del `describe('CertificationPage', ...)`, antes del cierre `})`:

```tsx
  it('picking a company from the Empresa filter re-queries listPending with its carrierId', async () => {
    renderPage()
    await screen.findByText('Transportes Sur Spa')
    fireEvent.change(screen.getByLabelText('Buscar empresa transportista'), { target: { value: 'Otra' } })
    fireEvent.click(await screen.findByText('Otra Spa'))
    await waitFor(() => expect(complianceApi.listPending).toHaveBeenLastCalledWith(
      expect.objectContaining({ carrierId: 'c2' }),
    ))
  })

  it('after picking a company, shows a removable chip instead of the picker', async () => {
    renderPage()
    await screen.findByText('Transportes Sur Spa')
    fireEvent.change(screen.getByLabelText('Buscar empresa transportista'), { target: { value: 'Otra' } })
    fireEvent.click(await screen.findByText('Otra Spa'))
    expect(await screen.findByLabelText('Quitar filtro de empresa')).toBeInTheDocument()
    expect(screen.queryByLabelText('Buscar empresa transportista')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run app/dashboard/certification/page.test.tsx`
Expected: FAIL — no existe ningún campo con label "Buscar empresa transportista" en la página todavía.

- [ ] **Step 3: Agregar el picker de empresa a la página**

En `monitor-app/frontend/app/dashboard/certification/page.tsx`, agregar el import junto a los demás:

```tsx
import { CarrierSearchPicker, type CarrierSearchResult } from '@/components/dashboard/CarrierSearchPicker'
```

Agregar estado nuevo junto a `carrierFilter` (dentro de `CertificationPageInner`):

```tsx
  const [carrierFilter, setCarrierFilter] = useState<string | null>(carrierIdParam)
  const [carrierQuery, setCarrierQuery]   = useState('')
```

Agregar el handler, junto a las demás funciones (por ejemplo después de `handleOpenBulkUpload`):

```tsx
  function handleCarrierPicked(c: CarrierSearchResult) {
    setCarrierFilter(c.id)
    setCarrierQuery(c.business_name)
  }
```

Reemplazar el bloque del input de búsqueda + chip:

```tsx
            <input
              value={q} onChange={e => setQ(e.target.value)}
              placeholder="Buscar por empresa, conductor o patente…"
              aria-label="Buscar" className={INPUT + ' w-64'}
            />
            {carrierFilter && (
              <span className="flex items-center gap-1 text-[11px] font-semibold bg-accent/10 text-accent rounded-full pl-2.5 pr-1.5 py-1">
                {filteredCarrierName ?? 'Empresa'}
                <button
                  type="button"
                  onClick={() => setCarrierFilter(null)}
                  aria-label="Quitar filtro de empresa"
                  className="hover:bg-accent/20 rounded-full p-0.5 transition-colors"
                >
                  <X size={11} />
                </button>
              </span>
            )}
```

por:

```tsx
            <input
              value={q} onChange={e => setQ(e.target.value)}
              placeholder="Buscar por conductor o patente…"
              aria-label="Buscar" className={INPUT + ' w-64'}
            />
            {!carrierFilter ? (
              <div className="w-56 shrink-0">
                <CarrierSearchPicker
                  query={carrierQuery}
                  onQueryChange={setCarrierQuery}
                  onPick={handleCarrierPicked}
                  placeholder="Buscar empresa…"
                  size="sm"
                />
              </div>
            ) : (
              <span className="flex items-center gap-1 text-[11px] font-semibold bg-accent/10 text-accent rounded-full pl-2.5 pr-1.5 py-1">
                {filteredCarrierName ?? 'Empresa'}
                <button
                  type="button"
                  onClick={() => { setCarrierFilter(null); setCarrierQuery('') }}
                  aria-label="Quitar filtro de empresa"
                  className="hover:bg-accent/20 rounded-full p-0.5 transition-colors"
                >
                  <X size={11} />
                </button>
              </span>
            )}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run app/dashboard/certification/page.test.tsx`
Expected: PASS — 10/10 tests (8 existentes + 2 nuevos).

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/app/dashboard/certification/page.tsx monitor-app/frontend/app/dashboard/certification/page.test.tsx
git commit -m "feat(certificacion): filtro Empresa con typeahead (CarrierSearchPicker)"
```

---

## Task 6: "+ Nueva empresa" y panel por empresa en `certification/page.tsx`

**Files:**
- Modify: `monitor-app/frontend/app/dashboard/certification/page.tsx`
- Modify: `monitor-app/frontend/app/dashboard/certification/page.test.tsx`

**Interfaces:**
- Consumes: `NewCarrierPanel` (Task 1/2), `CertificationCompanyPanel` (Task 3), `onOpenCompanyPanel` de `PendingDocumentsTable` (Task 4).

- [ ] **Step 1: Escribir los tests que fallan**

En `monitor-app/frontend/app/dashboard/certification/page.test.tsx`, agregar `create: vi.fn()` ya está en el mock de `carriersApi` del Task 5 (confirmar que quedó incluido). Agregar estos tests al final del `describe`:

```tsx
  it('clicking a company name in the table opens its document panel', async () => {
    renderPage()
    await screen.findByText('Transportes Sur Spa')
    fireEvent.click(screen.getByRole('button', { name: 'Transportes Sur Spa' }))
    expect(await screen.findByRole('dialog', { name: /Documentos pendientes de Transportes Sur Spa/ })).toBeInTheDocument()
  })

  it('"+ Nueva empresa" opens the create panel, and creating one opens its document panel', async () => {
    const created = { id: 'c9', tax_id: '76217085-K', country_code: 'CL', business_name: 'Nueva Spa', operational_status: 'ACTIVE' as const, created_at: null }
    vi.mocked(carriersApi.create).mockResolvedValue(created)
    renderPage()
    await screen.findByText('Transportes Sur Spa')
    fireEvent.click(screen.getByRole('button', { name: /Nueva empresa/ }))
    fireEvent.change(screen.getByLabelText('Tax ID'), { target: { value: '76217085-K' } })
    fireEvent.change(screen.getByLabelText('Razón social'), { target: { value: 'Nueva Spa' } })
    fireEvent.click(screen.getByRole('button', { name: /Crear empresa/ }))
    await waitFor(() => expect(carriersApi.create).toHaveBeenCalled())
    expect(await screen.findByRole('dialog', { name: /Documentos pendientes de/ })).toBeInTheDocument()
  })
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run app/dashboard/certification/page.test.tsx`
Expected: FAIL — no existe el botón "Transportes Sur Spa" como elemento clickeable con panel asociado, ni el botón "+ Nueva empresa".

- [ ] **Step 3: Integrar ambos paneles en la página**

En `monitor-app/frontend/app/dashboard/certification/page.tsx`, actualizar el import de `lucide-react` agregando `Plus`:

```tsx
import { Download, Loader2, Plus, X } from 'lucide-react'
```

Agregar imports:

```tsx
import { CertificationCompanyPanel } from '@/components/dashboard/CertificationCompanyPanel'
import { NewCarrierPanel } from '@/components/dashboard/NewCarrierPanel'
import type { CarrierCreateResult } from '@/lib/api/carriers'
```

Agregar estado nuevo junto a `bulkCarrier`:

```tsx
  const [bulkCarrier, setBulkCarrier] = useState<{ id: string; name: string; taxId: string } | null>(null)
  const [panelCarrierId, setPanelCarrierId] = useState<string | null>(null)
  const [newCarrierOpen, setNewCarrierOpen] = useState(false)
```

Agregar el handler de alta, junto a `handleBulkSaved`:

```tsx
  function handleCarrierCreated(created: CarrierCreateResult) {
    setNewCarrierOpen(false)
    invalidate()
    setPanelCarrierId(created.id)
  }
```

Reemplazar el bloque de botones de la derecha de la barra de filtros:

```tsx
            <button
              onClick={() => exportCsv(rows)}
              disabled={rows.length === 0}
              className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent/80 disabled:opacity-40 transition-colors"
            >
              <Download size={13} />
              Exportar
            </button>
```

por:

```tsx
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setNewCarrierOpen(true)}
                className="flex items-center gap-1.5 text-xs font-semibold text-accent border border-accent/30 rounded-lg px-2.5 py-1.5 hover:bg-accent/5 transition-colors"
              >
                <Plus size={13} /> Nueva empresa
              </button>
              <button
                onClick={() => exportCsv(rows)}
                disabled={rows.length === 0}
                className="flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent/80 disabled:opacity-40 transition-colors"
              >
                <Download size={13} />
                Exportar
              </button>
            </div>
```

Justo después del cierre del `div` de la barra de filtros (`</div>` que cierra `className="bg-white border border-border rounded-2xl px-3.5 py-2.5 flex items-center gap-2 flex-wrap"`) y antes del bloque `{pendingQuery.isPending && (...)}`, agregar:

```tsx
          <NewCarrierPanel
            open={newCarrierOpen}
            onClose={() => setNewCarrierOpen(false)}
            onCreated={handleCarrierCreated}
          />
```

Pasar el prop nuevo a `PendingDocumentsTable`:

```tsx
            <PendingDocumentsTable
              rows={rows}
              selected={selected}
              onToggle={toggle}
              onToggleAll={toggleAll}
              onUploadSingle={handleUploadSingle}
              onOpenBulkUpload={handleOpenBulkUpload}
              onOpenCompanyPanel={setPanelCarrierId}
            />
```

Y montar `CertificationCompanyPanel` junto al `BulkDocumentUploadModal` existente, al final del `return`:

```tsx
      {bulkCarrier && (
        <BulkDocumentUploadModal
          open
          carrierId={bulkCarrier.id}
          carrierName={bulkCarrier.name}
          carrierTaxId={bulkCarrier.taxId}
          pendingSlots={bulkSlotsQuery.data?.rows ?? []}
          onClose={() => setBulkCarrier(null)}
          onSaved={handleBulkSaved}
        />
      )}

      <CertificationCompanyPanel carrierId={panelCarrierId} onClose={() => setPanelCarrierId(null)} />
    </div>
  )
}
```

(el `<CertificationCompanyPanel .../>` nuevo va justo antes del `</div>` de cierre del componente — se renderiza siempre, y su propio `if (!open) return null` interno controla la visibilidad, igual que hace `BulkDocumentUploadModal` con su prop `open`).

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run app/dashboard/certification/page.test.tsx`
Expected: PASS — 12/12 tests (10 del Task 5 + 2 nuevos).

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/app/dashboard/certification/page.tsx monitor-app/frontend/app/dashboard/certification/page.test.tsx
git commit -m "feat(certificacion): boton + Nueva empresa y panel por empresa integrados en la sabana"
```

---

## Task 7: Verificación final, push, deploy, AGENTLOG

**Files:** ninguno nuevo — solo verificación y despliegue.

- [ ] **Step 1: Verificación completa de frontend**

Run:
```bash
cd monitor-app/frontend
npx tsc --noEmit
npx vitest run
npm run build
```
Expected: `tsc` sin errores; vitest en verde (los tests nuevos de las Tasks 1-6 + los ~664 existentes — si aparece una falla aislada en un archivo no tocado por este plan, volver a correr ese archivo solo antes de asumir que es una regresión real, ver Ronda 87/88 en AGENTLOG para el patrón de flakiness ya conocido bajo carga completa de la suite); `npm run build` exitoso, sin ruta nueva rota.

- [ ] **Step 2: Push a `dev`**

```bash
git push origin dev
```

- [ ] **Step 3: Verificar el deploy**

```bash
gh run list --branch dev --limit 3
gh run watch <run-id-de-Deploy-Frontend> --exit-status
```
Expected: `Deploy Frontend` verde.

- [ ] **Step 4: Verificación manual en vivo (Playwright)**

Contra `https://webcarga-frontend-dev-zcdyyci7ta-uc.a.run.app`:
1. Ir a `/dashboard/certification` — clickear el nombre de una empresa en una fila real → se abre el panel con sus pendientes reales.
2. Botón "Subir masivo" del panel → abre el modal ya conocido, scopeado a esa empresa.
3. "Ver ficha completa" → navega a `/dashboard/carriers/{id}` real.
4. Botón "+ Nueva empresa" → crear una empresa de prueba con datos claramente de test (ej. `tax_id` ficticio) → confirmar que se abre su panel de documentos vacío. **No dejar basura real en producción** — si el ambiente de staging comparte datos con producción, usar un tax_id obviamente de prueba y estar dispuesto a limpiarlo después si el usuario lo pide, o confirmar con el usuario antes de este paso si hay dudas sobre el ambiente.
5. Filtro "Empresa" (picker) → tipear y elegir una empresa real → la tabla se filtra, aparece el chip, "Quitar filtro" la limpia.

- [ ] **Step 5: Actualizar AGENTLOG.md**

Agregar una sección "Ronda 89" documentando lo implementado (panel por empresa, alta desde Certificación, filtro Empresa), verificación, y push/deploy — mismo formato que las rondas anteriores del archivo. Actualizar el checklist "Próximo paso exacto" quitando el ítem correspondiente de la Ronda 87 que quedaba pendiente ("diseñar la pantalla por empresa").

```bash
git add AGENTLOG.md
git commit -m "docs: AGENTLOG — Certificación, panel por empresa + alta (Ronda 89)"
git push origin dev
```

- [ ] **Step 6: Actualizar memoria**

Actualizar `/Users/usuario/.claude/projects/-Users-usuario-Desktop-projects-webcarga/memory/project_certificacion_por_empresa_ronda89.md` marcando la decisión como implementada (no solo diseñada) y actualizar la línea correspondiente en `MEMORY.md`.
