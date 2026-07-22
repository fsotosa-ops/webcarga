# Diario Fase 2 — Indicadores + Bitácora Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar los 4 puntos crípticos de "Indicadores" por 3 switches con etiqueta completa y texto explícito de override manual, y darle a la Bitácora un ciclo de vida real de incidentes (Abierto/Resuelto) con badge en el hero — cerrando el fix backend que quedó a medio camino en el Plan 1 (la columna `resolved_at` existe pero nunca llega al frontend).

**Architecture:** 3 tareas: un fix backend independiente y chico (exponer `resolved_at` en la lectura de notas), un componente nuevo independiente (`IndicatorSwitches`), y una integración final que conecta ambos en `TripSlideOver`/`TripNotesFeed`.

**Tech Stack:** FastAPI + asyncpg (Task 1), Next.js 16 / React, TanStack Query, Vitest + Testing Library (Tasks 2-3).

## Global Constraints

- `IndicatorDots.tsx` se borra recién en la Task 3, después de rewirear `TripSlideOver.tsx` al componente nuevo — nunca dejar el árbol sin compilar entre pasos.
- `npx tsc --noEmit` y `npm test` (vitest) limpios al final de cada task frontend; `pytest` limpio al final de la Task 1.
- Sin verificación en navegador (SSO real, sin credenciales de test en este entorno).

---

### Task 1: Backend — exponer `resolved_at` en `_NOTE_SELECT`

**Files:**
- Modify: `monitor-app/backend/api/app/routers/trips.py:1581-1587`
- Test: `monitor-app/backend/api/tests/test_trip_notes.py`

**Interfaces:**
- Produces: `GET /trips/{id}/notes` y el fetch interno de una nota individual (`_NOTE_SELECT`) devuelven `resolved_at` en cada fila — el Plan 1 ya creó la columna y el endpoint `PATCH .../notes/{id}/resolve`, este fix es lo único que faltaba para que el dato llegue al frontend.

- [ ] **Step 1: Escribir el test que falla**

En `monitor-app/backend/api/tests/test_trip_notes.py`, agregar junto a `test_list_notes_empty`:

```python
def test_list_notes_includes_resolved_at():
    pool = AsyncMock()
    pool.fetch.return_value = [{**NOTE_ROW, "note_type": "incidente", "resolved_at": None}]
    client = make_client(pool)
    res = client.get(f"/api/v1/trips/{NOTE_ROW['trip_id']}/notes")
    assert res.status_code == 200
    assert res.json()[0]["resolved_at"] is None
    query = pool.fetch.call_args.args[0]
    assert "resolved_at" in query
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_trip_notes.py::test_list_notes_includes_resolved_at -v`
Expected: FAIL en la aserción `"resolved_at" in query` — `_NOTE_SELECT` todavía no la incluye (la primera aserción pasa igual porque el mock del pool ya trae el campo, pero eso no prueba que la query real lo pida).

- [ ] **Step 3: Agregar `n.resolved_at` a `_NOTE_SELECT`**

En `monitor-app/backend/api/app/routers/trips.py`, `_NOTE_SELECT` (línea 1581) pasa de:

```python
_NOTE_SELECT = """
    n.id, n.trip_id, n.author_id,
    COALESCE(p.full_name, p.email) AS author_name,
    n.body, n.note_type, n.pinned, n.created_at
    FROM app.trip_notes n
    LEFT JOIN public.profiles p ON p.id = n.author_id
"""
```

A:

```python
_NOTE_SELECT = """
    n.id, n.trip_id, n.author_id,
    COALESCE(p.full_name, p.email) AS author_name,
    n.body, n.note_type, n.pinned, n.created_at, n.resolved_at
    FROM app.trip_notes n
    LEFT JOIN public.profiles p ON p.id = n.author_id
"""
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_trip_notes.py::test_list_notes_includes_resolved_at -v`
Expected: PASS.

- [ ] **Step 5: Correr la suite completa**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/ -q`
Expected: todos pasan.

- [ ] **Step 6: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/backend/api/app/routers/trips.py monitor-app/backend/api/tests/test_trip_notes.py
git commit -m "fix(diario): _NOTE_SELECT expone resolved_at — el Plan 1 creó la columna pero nunca la leía"
```

---

### Task 2: `IndicatorSwitches` — reemplazo de `IndicatorDots`

**Files:**
- Create: `monitor-app/frontend/components/dashboard/IndicatorSwitches.tsx`
- Create: `monitor-app/frontend/components/dashboard/IndicatorSwitches.test.tsx`

**Interfaces:**
- Consumes: `tripsApi.patch`/`tripsApi.resetField` (`lib/api/trips.ts`, ya existentes).
- Produces: `IndicatorSwitches({ trip: Trip, onSaved: (updated: Trip) => void })` — 3 switches (Activo/Trabajando/Asignado, sin "1ra Vuelta"), sin prop `size` (un solo consumidor tras la Task 3). No se conecta a `TripSlideOver` todavía en esta task — eso es la Task 3, para no dejar el árbol sin compilar entre pasos.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `monitor-app/frontend/components/dashboard/IndicatorSwitches.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IndicatorSwitches } from './IndicatorSwitches'
import { tripsApi } from '@/lib/api/trips'
import type { Trip } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { patch: vi.fn(), resetField: vi.fn() },
}))

const baseTrip: Trip = {
  id: 't1', source_system: 'qanalytics', client_name: null, planning_date: null,
  status_reported_at: null, current_status: null, tractor_plate: null, tractor_plate_tms: null, trailer_plate: null,
  driver_name: null, driver_name_tms: null, driver_tax_id: null, driver_phone: null, carrier_name: null, carrier_name_tms: null,
  origin: null, cargo_type: null, stops: [], is_active: false, is_working: false, is_assigned: false,
  is_first_leg: false, manual_status: null, notes: null, comments: null, unassigned_reason_id: null,
  fleet_link_id: null, carrier_id: null, driver_id: null, tractor_asset_id: null, trailer_asset_id: null, manually_edited_fields: [], edited_at: null,
  edited_by: null, created_at: null,
  updated_at: null, source_system_trip_id: null, milestone_status: null, pipeline_updated_at: null,
}

describe('IndicatorSwitches', () => {
  beforeEach(() => {
    vi.mocked(tripsApi.patch).mockReset()
    vi.mocked(tripsApi.resetField).mockReset()
  })

  it('renders Activo/Trabajando/Asignado as switches, without "1ra Vuelta"', () => {
    render(<IndicatorSwitches trip={baseTrip} onSaved={vi.fn()} />)
    expect(screen.getByRole('switch', { name: 'Activo' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Trabajando' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Asignado' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: '1ra Vuelta' })).not.toBeInTheDocument()
    expect(screen.queryByText('1ra Vuelta')).not.toBeInTheDocument()
  })

  it('calls tripsApi.patch with the toggled value immediately on click', () => {
    vi.mocked(tripsApi.patch).mockResolvedValue({ ...baseTrip, is_active: true })
    render(<IndicatorSwitches trip={baseTrip} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Activo' }))
    expect(tripsApi.patch).toHaveBeenCalledWith('t1', { is_active: true })
  })

  it('calls onSaved with the server response on success', async () => {
    const updated = { ...baseTrip, is_active: true }
    vi.mocked(tripsApi.patch).mockResolvedValue(updated)
    const onSaved = vi.fn()
    render(<IndicatorSwitches trip={baseTrip} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Activo' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated))
  })

  it('shows a visible error message and does not call onSaved when the PATCH fails', async () => {
    vi.mocked(tripsApi.patch).mockRejectedValue(new Error('network down'))
    const onSaved = vi.fn()
    render(<IndicatorSwitches trip={baseTrip} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Activo' }))
    await waitFor(() => expect(screen.getByText('network down')).toBeInTheDocument())
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('toggles off a currently-active indicator', () => {
    vi.mocked(tripsApi.patch).mockResolvedValue({ ...baseTrip, is_working: false })
    render(<IndicatorSwitches trip={{ ...baseTrip, is_working: true }} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Trabajando' }))
    expect(tripsApi.patch).toHaveBeenCalledWith('t1', { is_working: false })
  })

  it('shows explicit override attribution text and a revert control when a field is manually edited', () => {
    const trip = { ...baseTrip, manually_edited_fields: ['is_assigned'], edited_by: 'Felipe Sumadots', edited_at: '2026-07-02 10:15:00' }
    render(<IndicatorSwitches trip={trip} onSaved={vi.fn()} />)
    expect(screen.getByText(/Editado manualmente por Felipe Sumadots/)).toBeInTheDocument()
    expect(screen.getByText('Revertir a automático')).toBeInTheDocument()
  })

  it('does not show the override text for a field not in manually_edited_fields', () => {
    const trip = { ...baseTrip, manually_edited_fields: ['is_assigned'], edited_by: 'Felipe Sumadots', edited_at: '2026-07-02 10:15:00' }
    render(<IndicatorSwitches trip={trip} onSaved={vi.fn()} />)
    expect(screen.getAllByText('Revertir a automático').length).toBe(1)
  })

  it('reverting calls tripsApi.resetField and clears the field from manually_edited_fields via onSaved', async () => {
    vi.mocked(tripsApi.resetField).mockResolvedValue({ ok: true, field: 'is_assigned' })
    const onSaved = vi.fn()
    const trip = { ...baseTrip, manually_edited_fields: ['is_assigned'], is_assigned: true }
    render(<IndicatorSwitches trip={trip} onSaved={onSaved} />)
    fireEvent.click(screen.getByText('Revertir a automático'))
    await waitFor(() => expect(tripsApi.resetField).toHaveBeenCalledWith('t1', 'is_assigned'))
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ manually_edited_fields: [] }))
  })

  it('shows a visible error when reverting fails', async () => {
    vi.mocked(tripsApi.resetField).mockRejectedValue(new Error('revert failed'))
    const trip = { ...baseTrip, manually_edited_fields: ['is_assigned'] }
    render(<IndicatorSwitches trip={trip} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByText('Revertir a automático'))
    expect(await screen.findByText('revert failed')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/IndicatorSwitches.test.tsx`
Expected: FAIL — `./IndicatorSwitches` no existe todavía.

- [ ] **Step 3: Implementar `IndicatorSwitches`**

Crear `monitor-app/frontend/components/dashboard/IndicatorSwitches.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { Trip } from '@/lib/types'
import { tripsApi, type TripPatch } from '@/lib/api/trips'
import { fmtDT } from '@/lib/utils/datetime'

type IndicatorField = 'is_active' | 'is_working' | 'is_assigned'

const INDICATORS: { field: IndicatorField; label: string }[] = [
  { field: 'is_active',   label: 'Activo' },
  { field: 'is_working',  label: 'Trabajando' },
  { field: 'is_assigned', label: 'Asignado' },
]

interface Props {
  trip:    Trip
  onSaved: (updated: Trip) => void
}

export function IndicatorSwitches({ trip, onSaved }: Props) {
  const [pending, setPending]       = useState<Partial<Record<IndicatorField, boolean>>>({})
  const [optimistic, setOptimistic] = useState<Partial<Record<IndicatorField, boolean>>>({})
  const [reverting, setReverting]   = useState<Partial<Record<IndicatorField, boolean>>>({})
  const [error, setError]           = useState<string | null>(null)

  async function toggle(field: IndicatorField) {
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

  async function revert(field: IndicatorField) {
    setReverting(r => ({ ...r, [field]: true }))
    setError(null)
    try {
      // DELETE /trips/{id}/overrides/{field} devuelve solo {ok, field} — no
      // recalcula manually_edited_fields del lado del servidor, así que el
      // filtro local es la única forma de reflejarlo sin esperar un refetch.
      await tripsApi.resetField(trip.id, field)
      onSaved({
        ...trip,
        manually_edited_fields: (trip.manually_edited_fields ?? []).filter(f => f !== field),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al revertir')
    } finally {
      setReverting(r => { const n = { ...r }; delete n[field]; return n })
    }
  }

  return (
    <div className="space-y-2.5">
      {INDICATORS.map(ind => {
        const active = optimistic[ind.field] ?? trip[ind.field]
        const frozen = trip.manually_edited_fields?.includes(ind.field) ?? false
        return (
          <div key={ind.field}>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-700">{ind.label}</span>
              <button
                type="button"
                role="switch"
                aria-checked={active}
                aria-label={ind.label}
                disabled={!!pending[ind.field]}
                onClick={() => toggle(ind.field)}
                className={`relative w-8 h-4 rounded-full transition-colors disabled:opacity-50 ${
                  active ? 'bg-accent' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
                    active ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            {frozen && (
              <p className="text-[10px] text-gray-400 mt-1">
                Editado manualmente {trip.edited_by ? `por ${trip.edited_by} ` : ''}el {fmtDT(trip.edited_at)} ·{' '}
                <button
                  type="button"
                  disabled={!!reverting[ind.field]}
                  onClick={() => revert(ind.field)}
                  className="text-accent hover:text-accent/80 underline disabled:opacity-50"
                >
                  Revertir a automático
                </button>
              </p>
            )}
          </div>
        )
      })}
      {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/IndicatorSwitches.test.tsx`
Expected: 9 passed.

- [ ] **Step 5: `tsc` limpio**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/frontend/components/dashboard/IndicatorSwitches.tsx monitor-app/frontend/components/dashboard/IndicatorSwitches.test.tsx
git commit -m "feat(diario): IndicatorSwitches — Activo/Trabajando/Asignado como switches con etiqueta, 1ra Vuelta retirado"
```

---

### Task 3: Integración — `TripNotesFeed` con incidentes + `TripSlideOver` rewireado

**Files:**
- Modify: `monitor-app/frontend/lib/types.ts` (`TripNote` gana `resolved_at`)
- Modify: `monitor-app/frontend/lib/api/trips.ts` (`tripsApi.resolveNote`)
- Modify: `monitor-app/frontend/hooks/useTripNotes.ts` (`useResolveTripNote`)
- Modify: `monitor-app/frontend/components/dashboard/TripNotesFeed.tsx`
- Modify: `monitor-app/frontend/components/dashboard/TripSlideOver.tsx`
- Delete: `monitor-app/frontend/components/dashboard/IndicatorDots.tsx`
- Delete: `monitor-app/frontend/components/dashboard/IndicatorDots.test.tsx`
- Modify: `monitor-app/frontend/components/dashboard/TripSlideOver.test.tsx` (reescritura completa)

**Interfaces:**
- Consumes: `IndicatorSwitches` (Task 2), `_NOTE_SELECT` con `resolved_at` (Task 1).
- Produces: `TripSlideOver` sigue exponiendo la misma interfaz pública — sin cambios para `page.tsx`.

- [ ] **Step 1: `TripNote` gana `resolved_at`**

En `monitor-app/frontend/lib/types.ts`, `TripNote` pasa de:

```typescript
export type TripNote = {
  id:          string
  trip_id:     string
  author_id:   string
  author_name: string | null
  body:        string
  note_type:   TripNoteType
  pinned:      boolean
  created_at:  string
  attachments: TripNoteAttachment[]
}
```

A:

```typescript
export type TripNote = {
  id:          string
  trip_id:     string
  author_id:   string
  author_name: string | null
  body:        string
  note_type:   TripNoteType
  pinned:      boolean
  created_at:  string
  attachments: TripNoteAttachment[]
  /** Solo tiene significado para note_type='incidente' — null = abierto,
   *  con timestamp = resuelto (Fase 2, Plan 5). */
  resolved_at: string | null
}
```

- [ ] **Step 2: `tripsApi.resolveNote`**

En `monitor-app/frontend/lib/api/trips.ts`, `pinNote` (línea 148) pasa de:

```typescript
  pinNote: (id: string, noteId: string, pinned: boolean) =>
    apiFetch<{ ok: boolean; pinned: boolean }>(`/api/v1/trips/${id}/notes/${noteId}/pin`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned }),
    }),
}
```

A:

```typescript
  pinNote: (id: string, noteId: string, pinned: boolean) =>
    apiFetch<{ ok: boolean; pinned: boolean }>(`/api/v1/trips/${id}/notes/${noteId}/pin`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned }),
    }),

  resolveNote: (id: string, noteId: string, resolved: boolean) =>
    apiFetch<{ ok: boolean; resolved: boolean }>(`/api/v1/trips/${id}/notes/${noteId}/resolve`, {
      method: 'PATCH',
      body: JSON.stringify({ resolved }),
    }),
}
```

- [ ] **Step 3: `useResolveTripNote`**

En `monitor-app/frontend/hooks/useTripNotes.ts`, agregar al final del archivo (mismo patrón exacto que `usePinTripNote`):

```typescript
export function useResolveTripNote(tripId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ noteId, resolved }: { noteId: string; resolved: boolean }) =>
      tripsApi.resolveNote(tripId!, noteId, resolved),
    // Optimista con rollback — mismo criterio que usePinTripNote (acción
    // binaria de baja fricción, no amerita esperar el round-trip).
    onMutate: async ({ noteId, resolved }) => {
      await queryClient.cancelQueries({ queryKey: ['trip-notes', tripId] })
      const prev = queryClient.getQueryData<TripNote[]>(['trip-notes', tripId])
      queryClient.setQueryData<TripNote[]>(['trip-notes', tripId], old =>
        old?.map(n => (n.id === noteId ? { ...n, resolved_at: resolved ? new Date().toISOString() : null } : n)))
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['trip-notes', tripId], ctx.prev)
    },
  })
}
```

- [ ] **Step 4: Reescribir `TripNotesFeed.tsx` completo**

Reemplazar `monitor-app/frontend/components/dashboard/TripNotesFeed.tsx` completo:

```tsx
'use client'

import { useRef, useState } from 'react'
import {
  Loader2, Send, Paperclip, X, Pin, PinOff,
  Phone, MessageCircle, AlertTriangle, StickyNote, Activity,
  FileText, ImageIcon, FolderOpen, ListOrdered,
} from 'lucide-react'
import type { Trip, TripNote, TripNoteAttachment, TripNoteType } from '@/lib/types'
import { useTripNotes, useAddTripNote, usePinTripNote, useResolveTripNote } from '@/hooks/useTripNotes'
import { formatRelativeTime, fmtDT } from '@/lib/utils/datetime'

const NOTE_TYPES: { id: Exclude<TripNoteType, 'sistema'>; label: string; Icon: typeof Phone; cls: string }[] = [
  { id: 'observacion', label: 'Observación', Icon: StickyNote,    cls: 'text-slate-600 bg-slate-100'  },
  { id: 'llamada',     label: 'Llamada',     Icon: Phone,         cls: 'text-blue-600 bg-blue-50'     },
  { id: 'whatsapp',    label: 'WhatsApp',    Icon: MessageCircle, cls: 'text-green-600 bg-green-50'   },
  { id: 'incidente',   label: 'Incidente',   Icon: AlertTriangle, cls: 'text-red-600 bg-red-50'       },
]

// Espejo de ALLOWED_ATTACHMENT_MIMES del backend (routers/trips.py)
const ACCEPTED_FILES = '.pdf,image/png,image/jpeg,image/webp,image/heic,image/heif,.doc,.docx,.xls,.xlsx'
const MAX_FILE_BYTES = 10 * 1024 * 1024

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function typeMeta(t: TripNoteType) {
  return NOTE_TYPES.find(x => x.id === t) ?? NOTE_TYPES[0]
}

function AttachmentCard({ att }: { att: TripNoteAttachment }) {
  // HEIC/HEIF no renderizan en <img> fuera de Safari — se muestran como archivo
  const isImage = att.mime_type.startsWith('image/') && !/hei[cf]/.test(att.mime_type)
  const inner = isImage && att.url ? (
    <img src={att.url} alt={att.file_name} className="w-full h-20 object-cover rounded-t-md" />
  ) : null
  return (
    <a
      href={att.url ?? undefined}
      target="_blank"
      rel="noreferrer"
      className={`block border border-border/70 rounded-md overflow-hidden bg-white hover:border-accent/40 hover:shadow-sm transition-all ${att.url ? '' : 'opacity-50 pointer-events-none'}`}
      title={att.file_name}
    >
      {inner}
      <span className="flex items-center gap-1.5 px-2 py-1.5">
        {isImage
          ? <ImageIcon size={11} className="text-gray-400 shrink-0" />
          : <FileText size={11} className="text-red-400 shrink-0" />}
        <span className="text-[10px] text-slate-600 truncate">{att.file_name}</span>
        <span className="text-[9px] text-gray-300 shrink-0 ml-auto">{fmtBytes(att.size_bytes)}</span>
      </span>
    </a>
  )
}

function NoteCard({
  note, onPin, pinPending, onResolve, resolvePending,
}: {
  note: TripNote
  onPin: (n: TripNote) => void
  pinPending: boolean
  onResolve: (n: TripNote) => void
  resolvePending: boolean
}) {
  const meta = typeMeta(note.note_type)
  const isIncident = note.note_type === 'incidente'
  const resolved = !!note.resolved_at
  return (
    <div className={`group bg-white border rounded-lg px-3 py-2 shadow-sm ${note.pinned ? 'border-amber-300 bg-amber-50/40' : 'border-border/60'}`}>
      <p className="flex items-center gap-1.5 mb-1 flex-wrap">
        <span className={`inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded ${meta.cls}`}>
          <meta.Icon size={9} />
          {meta.label}
        </span>
        {isIncident && (
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
            resolved ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
          }`}>
            {resolved ? 'Resuelto' : 'Abierto'}
          </span>
        )}
        <span className="text-[10px] font-semibold text-slate-600 truncate">
          {note.author_name ?? 'Usuario'}
        </span>
        <span className="text-[9px] text-gray-300 whitespace-nowrap" title={fmtDT(note.created_at)}>
          {formatRelativeTime(note.created_at)}
        </span>
        {isIncident && (
          <button
            type="button"
            onClick={() => onResolve(note)}
            disabled={resolvePending}
            className="text-[9px] font-semibold text-accent hover:text-accent/80 disabled:opacity-50"
          >
            {resolved ? 'Reabrir' : 'Marcar resuelto'}
          </button>
        )}
        <button
          type="button"
          onClick={() => onPin(note)}
          disabled={pinPending}
          title={note.pinned ? 'Quitar destacado' : 'Destacar nota'}
          className={`ml-auto shrink-0 transition-all disabled:opacity-40 ${
            note.pinned ? 'text-amber-500 hover:text-amber-600' : 'text-gray-200 opacity-0 group-hover:opacity-100 hover:text-amber-500'
          }`}
        >
          {note.pinned ? <PinOff size={12} /> : <Pin size={12} />}
        </button>
      </p>
      {note.body && <p className="text-xs text-slate-700 whitespace-pre-wrap">{note.body}</p>}
      {note.attachments.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5 mt-1.5">
          {note.attachments.map(att => <AttachmentCard key={att.id} att={att} />)}
        </div>
      )}
    </div>
  )
}

interface Props {
  trip: Trip
}

export function TripNotesFeed({ trip }: Props) {
  const [draft, setDraft]           = useState('')
  const [draftType, setDraftType]   = useState<Exclude<TripNoteType, 'sistema'>>('observacion')
  const [draftFiles, setDraftFiles] = useState<File[]>([])
  const [fileErr, setFileErr]       = useState<string | null>(null)
  const [filter, setFilter]         = useState<TripNoteType | null>(null)
  const [view, setView]             = useState<'feed' | 'documentos'>('feed')
  const fileInputRef                = useRef<HTMLInputElement>(null)

  const notesQuery  = useTripNotes(trip.id)
  const addNote     = useAddTripNote(trip.id)
  const pinNote     = usePinTripNote(trip.id)
  const resolveNote = useResolveTripNote(trip.id)

  const notes    = notesQuery.data ?? []
  const pinned   = notes.filter(n => n.pinned)
  const unpinned = notes.filter(n => !n.pinned)
  const visible  = filter ? unpinned.filter(n => n.note_type === filter) : unpinned
  const allAttachments = notes.flatMap(n =>
    n.attachments.map(att => ({ att, author: n.author_name, created_at: n.created_at })))

  function handlePickFiles(list: FileList | null) {
    if (!list) return
    setFileErr(null)
    const incoming = Array.from(list)
    const tooBig = incoming.find(f => f.size > MAX_FILE_BYTES)
    if (tooBig) { setFileErr(`${tooBig.name} supera 10MB`); return }
    setDraftFiles(prev => [...prev, ...incoming])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleSubmit() {
    const body = draft.trim()
    if ((!body && draftFiles.length === 0) || addNote.isPending) return
    addNote.mutate(
      { body, note_type: draftType, files: draftFiles },
      { onSuccess: () => { setDraft(''); setDraftFiles([]); setDraftType('observacion') } },
    )
  }

  function handlePin(note: TripNote) {
    pinNote.mutate({ noteId: note.id, pinned: !note.pinned })
  }

  function handleResolve(note: TripNote) {
    resolveNote.mutate({ noteId: note.id, resolved: !note.resolved_at })
  }

  return (
    <div className="space-y-3">
      {/* Toggle Feed | Documentos — solo cuando hay adjuntos (si no, es ruido) */}
      {allAttachments.length > 0 && (
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5 w-fit">
          {([
            { id: 'feed',       label: 'Feed',       Icon: ListOrdered },
            { id: 'documentos', label: 'Documentos', Icon: FolderOpen  },
          ] as const).map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setView(t.id)}
              className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md transition-colors ${
                view === t.id ? 'bg-white text-slate-700 shadow-sm' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <t.Icon size={10} />
              {t.label}
              {t.id === 'documentos' && (
                <span className="text-[9px] text-gray-400">({allAttachments.length})</span>
              )}
            </button>
          ))}
        </div>
      )}

      {view === 'documentos' ? (
        /* ── Vista Documentos: todos los adjuntos del viaje ── */
        <div className="space-y-1.5">
          {allAttachments.length === 0 && (
            <p className="text-[10px] text-gray-300 italic">Sin documentos adjuntos</p>
          )}
          {allAttachments.map(({ att, author, created_at }) => (
            <a
              key={att.id}
              href={att.url ?? undefined}
              target="_blank"
              rel="noreferrer"
              className={`flex items-center gap-2 border border-border/70 rounded-lg bg-white px-3 py-2 hover:border-accent/40 hover:shadow-sm transition-all ${att.url ? '' : 'opacity-50 pointer-events-none'}`}
            >
              {att.mime_type.startsWith('image/')
                ? <ImageIcon size={14} className="text-gray-400 shrink-0" />
                : <FileText size={14} className="text-red-400 shrink-0" />}
              <span className="min-w-0">
                <span className="block text-xs text-slate-700 truncate">{att.file_name}</span>
                <span className="block text-[9px] text-gray-400">
                  {author ?? 'Usuario'} · {formatRelativeTime(created_at)} · {fmtBytes(att.size_bytes)}
                </span>
              </span>
            </a>
          ))}
        </div>
      ) : (
        <>
          {/* Filtro por tipo */}
          {notes.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {NOTE_TYPES.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setFilter(prev => (prev === t.id ? null : t.id))}
                  className={`flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border transition-all ${
                    filter === t.id ? `${t.cls} border-current` : 'text-gray-400 border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <t.Icon size={9} />
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {/* Feed — ya no vive en un sidebar angosto (Fase 2, Plan 4), sin
              tope de altura interno (Plan 5: se quitó max-h-80/overflow-y-auto). */}
          <div className="space-y-2">
            {/* Destacadas arriba */}
            {pinned.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-1 text-[9px] font-bold text-amber-600 uppercase tracking-wide">
                  <Pin size={9} /> Destacadas
                </p>
                {pinned.map(n => (
                  <NoteCard key={n.id} note={n} onPin={handlePin} pinPending={pinNote.isPending} onResolve={handleResolve} resolvePending={resolveNote.isPending} />
                ))}
              </div>
            )}

            {notesQuery.isPending && (
              /* Skeleton pulsante en vez de texto de carga */
              <div className="space-y-2" aria-label="Cargando bitácora">
                {[0, 1].map(i => (
                  <div key={i} className="bg-white border border-border/60 rounded-lg px-3 py-2 animate-pulse">
                    <div className="h-2.5 w-28 bg-gray-100 rounded mb-2" />
                    <div className="h-2.5 w-full bg-gray-100 rounded" />
                  </div>
                ))}
              </div>
            )}
            {notesQuery.error && (
              <p className="text-[10px] text-red-500">
                {notesQuery.error instanceof Error ? notesQuery.error.message : 'Error cargando la bitácora'}
              </p>
            )}
            {!notesQuery.isPending && notes.length === 0 && (
              <p className="text-[10px] text-gray-300 italic">Sin novedades registradas</p>
            )}

            {visible.map(note =>
              note.note_type === 'sistema' ? (
                /* Evento del sistema: línea compacta, sin card */
                <p key={note.id} className="flex items-center gap-1.5 text-[10px] text-gray-400 px-1">
                  <Activity size={9} className="shrink-0" />
                  <span className="truncate">
                    <span className="font-medium text-gray-500">{note.author_name ?? 'Sistema'}</span>{' '}
                    {note.body.charAt(0).toLowerCase() + note.body.slice(1)}
                  </span>
                  <span className="text-gray-300 whitespace-nowrap shrink-0 ml-auto" title={fmtDT(note.created_at)}>
                    {formatRelativeTime(note.created_at)}
                  </span>
                </p>
              ) : (
                <NoteCard key={note.id} note={note} onPin={handlePin} pinPending={pinNote.isPending} onResolve={handleResolve} resolvePending={resolveNote.isPending} />
              ),
            )}
            {pinNote.error && (
              <p className="text-[10px] text-red-500">
                {pinNote.error instanceof Error ? pinNote.error.message : 'Error al destacar'}
              </p>
            )}
            {resolveNote.error && (
              <p className="text-[10px] text-red-500">
                {resolveNote.error instanceof Error ? resolveNote.error.message : 'Error al actualizar el incidente'}
              </p>
            )}
          </div>

          {/* Composer */}
          <div className="space-y-1.5">
            {/* Selector de tipo — solo el activo muestra su label (menos ruido) */}
            <div className="flex items-center gap-1">
              {NOTE_TYPES.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setDraftType(t.id)}
                  title={t.label}
                  aria-pressed={draftType === t.id}
                  className={`flex items-center gap-1 text-[9px] font-semibold px-1.5 py-1 rounded-md border transition-all ${
                    draftType === t.id ? `${t.cls} border-current` : 'text-gray-400 border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <t.Icon size={10} />
                  {draftType === t.id && <span>{t.label}</span>}
                </button>
              ))}
            </div>

            <div className="relative">
              <textarea
                rows={2}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSubmit() }
                }}
                placeholder="Registrar novedad… (⌘↵ para enviar)"
                className="w-full text-sm border border-border rounded-lg px-3 py-2 pr-9 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Adjuntar archivo (PDF, imagen, Word o Excel, máx 10MB)"
                className="absolute right-2 top-2 text-gray-300 hover:text-accent transition-colors"
              >
                <Paperclip size={14} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED_FILES}
                onChange={e => handlePickFiles(e.target.files)}
                className="hidden"
                aria-label="Adjuntar archivos"
              />
            </div>

            {/* Archivos seleccionados */}
            {draftFiles.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {draftFiles.map((f, i) => (
                  <span key={`${f.name}-${i}`} className="flex items-center gap-1 text-[9px] bg-gray-100 text-slate-600 px-1.5 py-0.5 rounded-full">
                    {f.type.startsWith('image/') ? <ImageIcon size={9} /> : <FileText size={9} />}
                    <span className="max-w-[120px] truncate">{f.name}</span>
                    <span className="text-gray-400">{fmtBytes(f.size)}</span>
                    <button
                      type="button"
                      onClick={() => setDraftFiles(prev => prev.filter((_, j) => j !== i))}
                      className="hover:text-red-500"
                      aria-label={`Quitar ${f.name}`}
                    >
                      <X size={9} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {fileErr && <p className="text-[10px] text-red-500">{fileErr}</p>}
            {addNote.error && (
              <p className="text-[10px] text-red-500">
                {addNote.error instanceof Error ? addNote.error.message : 'Error al guardar la nota'}
              </p>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={addNote.isPending || (!draft.trim() && draftFiles.length === 0)}
              className="w-full flex items-center justify-center gap-1.5 bg-accent text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-accent/90 disabled:opacity-50 transition-colors"
            >
              {addNote.isPending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              Agregar nota
            </button>
          </div>
        </>
      )}
    </div>
  )
}
```

(Nota: `Archive` de `lucide-react` y las variables `legacyText`/`trip.notes`/`trip.comments` desaparecen del archivo — eran exclusivas del bloque legacy retirado.)

- [ ] **Step 5: Rewirear `TripSlideOver.tsx` a `IndicatorSwitches` + badge de incidentes en el hero**

En `monitor-app/frontend/components/dashboard/TripSlideOver.tsx`, el import pasa de:

```tsx
import { StopTimeline } from './StopTimeline'
import { IndicatorDots } from './IndicatorDots'
import { TripNotesFeed } from './TripNotesFeed'
```

A:

```tsx
import { StopTimeline } from './StopTimeline'
import { IndicatorSwitches } from './IndicatorSwitches'
import { TripNotesFeed } from './TripNotesFeed'
import { useTripNotes } from '@/hooks/useTripNotes'
```

La sección "Indicadores" pasa de:

```tsx
            {/* Indicadores — el rediseño a switches con etiqueta es el
                Plan 5; acá sigue siendo IndicatorDots sin cambios. */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Indicadores</p>
              <IndicatorDots trip={trip} onSaved={onSaved} size="md" />
            </div>
```

A:

```tsx
            {/* Indicadores — switches con etiqueta completa (Fase 2, Plan 5) */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Indicadores</p>
              <IndicatorSwitches trip={trip} onSaved={onSaved} />
            </div>
```

Inmediatamente después de la línea `const stops = trip.stops ?? []` (que ya existe, dentro del bloque de valores derivados justo antes del `return`), agregar el cálculo de incidentes abiertos — pero como es un hook, `useTripNotes` debe llamarse **antes** del `if (!trip) return null` (junto a los demás `useState`/`useEffect`, no después). En `monitor-app/frontend/components/dashboard/TripSlideOver.tsx`, el bloque de estado pasa de:

```tsx
  const [fleetDraft, setFleetDraft]             = useState<FleetAssignValue>(EMPTY_FLEET_ASSIGN_VALUE)
  const [assigningFleet, setAssigningFleet]     = useState(false)
  const [fleetErr, setFleetErr]                 = useState<string | null>(null)
  const panelRef                                = useRef<HTMLDivElement>(null)
```

A:

```tsx
  const [fleetDraft, setFleetDraft]             = useState<FleetAssignValue>(EMPTY_FLEET_ASSIGN_VALUE)
  const [assigningFleet, setAssigningFleet]     = useState(false)
  const [fleetErr, setFleetErr]                 = useState<string | null>(null)
  const panelRef                                = useRef<HTMLDivElement>(null)
  // Badge de incidentes abiertos en el hero (Fase 2, Plan 5) — mismo hook
  // que ya usa TripNotesFeed internamente; TanStack Query dedupea por
  // queryKey (['trip-notes', tripId]), así que esto no dispara una segunda
  // request, comparte la misma cache/carga.
  const notesQuery = useTripNotes(trip?.id ?? null)
```

Y el bloque de valores derivados de la hero (después de `const stops = trip.stops ?? []`) pasa de:

```tsx
  const stops            = trip.stops ?? []
  const destinationStops = stops.filter(s => s.stop_type !== 'ORIGIN')
```

A:

```tsx
  const stops            = trip.stops ?? []
  const destinationStops = stops.filter(s => s.stop_type !== 'ORIGIN')
  const openIncidents    = (notesQuery.data ?? []).filter(n => n.note_type === 'incidente' && !n.resolved_at).length
```

Y en el hero, la fila "gestión por excepción" pasa de:

```tsx
          <div className="flex items-center gap-2.5 flex-wrap text-[11px] text-gray-500">
            {destinationStops.length > 0 && (
              <span>{doneCount}/{destinationStops.length} paradas</span>
            )}
            {compliance === 'warn' && (
              <span className="font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full text-[10px]">OFF TIME</span>
            )}
```

A:

```tsx
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
```

- [ ] **Step 6: Borrar `IndicatorDots`**

```bash
rm monitor-app/frontend/components/dashboard/IndicatorDots.tsx
rm monitor-app/frontend/components/dashboard/IndicatorDots.test.tsx
```

- [ ] **Step 7: Reescribir `TripSlideOver.test.tsx` completo**

Reemplazar `monitor-app/frontend/components/dashboard/TripSlideOver.test.tsx` completo:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
    resolveNote: vi.fn(),
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
  vi.mocked(tripsApi.resolveNote).mockReset()
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
    expect(within(screen.getByTestId('hero')).queryByText('ON TIME')).not.toBeInTheDocument()
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

  it('shows "N incidente(s) abierto(s)" badge in the hero when there are open incident notes', async () => {
    vi.mocked(tripsApi.listNotes).mockResolvedValue([
      { id: 'n1', trip_id: 't1', author_id: 'u1', author_name: 'Op', body: 'x', note_type: 'incidente', pinned: false, created_at: '2026-07-05 12:00:00', attachments: [], resolved_at: null },
      { id: 'n2', trip_id: 't1', author_id: 'u1', author_name: 'Op', body: 'y', note_type: 'incidente', pinned: false, created_at: '2026-07-05 12:00:00', attachments: [], resolved_at: '2026-07-05 13:00:00' },
    ])
    renderSlideOver(baseTrip)
    expect(await within(screen.getByTestId('hero')).findByText('1 incidente abierto')).toBeInTheDocument()
  })

  it('does not show the incidents badge when all incidents are resolved', async () => {
    vi.mocked(tripsApi.listNotes).mockResolvedValue([
      { id: 'n1', trip_id: 't1', author_id: 'u1', author_name: 'Op', body: 'x', note_type: 'incidente', pinned: false, created_at: '2026-07-05 12:00:00', attachments: [], resolved_at: '2026-07-05 13:00:00' },
    ])
    renderSlideOver(baseTrip)
    await waitFor(() => expect(tripsApi.listNotes).toHaveBeenCalled())
    expect(within(screen.getByTestId('hero')).queryByText(/incidente/i)).not.toBeInTheDocument()
  })
})

describe('TripSlideOver — header (IDs unificados + link a TMS)', () => {
  it('copies the external id via its own button', () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    renderSlideOver(baseTrip)
    fireEvent.click(screen.getByTitle('Copiar ID externo'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('2000711')
  })

  it('shows the internal uuid in the header with its own copy button', () => {
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
  })

  it('the TMS chip is not a link for a manual trip', () => {
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
      driver_id: 'd1', driver_name: 'Ana Torres', driver_rut: '11.111.111-1', driver_phone: '+56911112222',
      carrier_id: 'c1', carrier_name: 'Transportes Sur Spa', tractor_asset_id: 'a1', tractor_plate: 'ABCD12',
    }])
    vi.mocked(tripsApi.assignFleetLink).mockResolvedValue({ ...baseTrip, carrier_id: 'c1', carrier_name: 'Transportes Sur Spa' })
    renderSlideOver(baseTrip)

    fireEvent.change(screen.getByLabelText('Buscar conductor'), { target: { value: 'Ana' } })
    fireEvent.click(await screen.findByText('Ana Torres'))
    fireEvent.click(screen.getByText('Vincular'))

    await waitFor(() =>
      expect(tripsApi.assignFleetLink).toHaveBeenCalledWith('t1', {
        carrier_id: 'c1', driver_id: 'd1', tractor_asset_id: 'a1',
        driver_name: 'Ana Torres', tractor_plate: 'ABCD12',
      }))
  })

  it('shows the linked carrier as a compact card and unlinks via removeFleetLink', async () => {
    vi.mocked(tripsApi.removeFleetLink).mockResolvedValue({ ok: true })
    renderSlideOver({ ...baseTrip, carrier_id: 'c1', carrier_name: 'Transportes Sur Spa' })
    expect(screen.getByText('Transportes Sur Spa')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Desvincular'))
    await waitFor(() => expect(tripsApi.removeFleetLink).toHaveBeenCalledWith('t1'))
  })

  it('shows a reconciliation banner including carrier divergence, and reverts via "Usar dato del TMS"', async () => {
    vi.mocked(tripsApi.removeFleetLink).mockResolvedValue({ ok: true })
    renderSlideOver({
      ...baseTrip,
      fleet_link_id: 'fl1', carrier_id: 'c1', carrier_name: 'Transportes Sur Spa',
      carrier_name_tms: 'Transportes ACME SPA',
    })
    expect(screen.getByText(/TMS reporta empresa/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Usar dato del TMS'))
    await waitFor(() => expect(tripsApi.removeFleetLink).toHaveBeenCalledWith('t1'))
  })
})

describe('TripSlideOver — override de estado', () => {
  it('shows an inline "set manual override" affordance', () => {
    renderSlideOver(baseTrip)
    expect(screen.getByText(/Establecer estado operativo/)).toBeInTheDocument()
  })

  it('reverting the override calls tripsApi.resetField with manual_status', async () => {
    vi.mocked(tripsApi.resetField).mockResolvedValue({ ok: true, field: 'manual_status' })
    renderSlideOver({ ...baseTrip, manual_status: 'en_seguimiento' })
    fireEvent.click(screen.getByTitle('Revertir a valor del TMS'))
    await waitFor(() => expect(tripsApi.resetField).toHaveBeenCalledWith('t1', 'manual_status'))
  })
})

describe('TripSlideOver — indicadores (switches, Fase 2 Plan 5)', () => {
  it('renders Activo/Trabajando/Asignado as switches, without "1ra Vuelta"', () => {
    renderSlideOver(baseTrip)
    expect(screen.getByRole('switch', { name: 'Activo' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Trabajando' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Asignado' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: '1ra Vuelta' })).not.toBeInTheDocument()
  })

  it('toggles a switch via tripsApi.patch', async () => {
    vi.mocked(tripsApi.patch).mockResolvedValue({ ...baseTrip, is_active: true })
    renderSlideOver(baseTrip)
    fireEvent.click(screen.getByRole('switch', { name: 'Activo' }))
    await waitFor(() => expect(tripsApi.patch).toHaveBeenCalledWith('t1', { is_active: true }))
  })

  it('shows explicit override attribution text and a revert control when a field is manually edited', () => {
    renderSlideOver({ ...baseTrip, manually_edited_fields: ['is_assigned'], edited_by: 'Felipe Sumadots', edited_at: '2026-07-02 10:15:00' })
    expect(screen.getByText(/Editado manualmente por Felipe Sumadots/)).toBeInTheDocument()
    expect(screen.getByText('Revertir a automático')).toBeInTheDocument()
  })
})

describe('TripSlideOver — Bitácora (feed con historial)', () => {
  const note: TripNote = {
    id: 'n1', trip_id: 't1', author_id: 'u1', author_name: 'Operador Uno',
    body: 'Conductor confirmó por teléfono', note_type: 'llamada', pinned: false,
    created_at: '2026-07-05 12:00:00', attachments: [], resolved_at: null,
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

  it('no longer shows a legacy notes/comments block (retirado, Fase 2 Plan 5)', async () => {
    renderSlideOver({ ...baseTrip, notes: 'obs vieja', comments: 'comentario viejo' })
    await waitFor(() => expect(tripsApi.listNotes).toHaveBeenCalled())
    expect(screen.queryByText(/Nota anterior/)).not.toBeInTheDocument()
    expect(screen.queryByText('obs vieja')).not.toBeInTheDocument()
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

  it('shows an "Abierto" chip and "Marcar resuelto" action for an unresolved incident note', async () => {
    vi.mocked(tripsApi.listNotes).mockResolvedValue([
      { ...note, id: 'n1', note_type: 'incidente', body: 'sobreestadía', resolved_at: null },
    ])
    renderSlideOver(baseTrip)
    expect(await screen.findByText('Abierto')).toBeInTheDocument()
    expect(screen.getByText('Marcar resuelto')).toBeInTheDocument()
  })

  it('marking an incident resolved calls tripsApi.resolveNote', async () => {
    vi.mocked(tripsApi.listNotes).mockResolvedValue([
      { ...note, id: 'n1', note_type: 'incidente', body: 'sobreestadía', resolved_at: null },
    ])
    vi.mocked(tripsApi.resolveNote).mockResolvedValue({ ok: true, resolved: true })
    renderSlideOver(baseTrip)
    await screen.findByText('sobreestadía')
    fireEvent.click(screen.getByText('Marcar resuelto'))
    await waitFor(() => expect(tripsApi.resolveNote).toHaveBeenCalledWith('t1', 'n1', true))
  })

  it('shows a "Resuelto" chip and "Reabrir" action for a resolved incident note', async () => {
    vi.mocked(tripsApi.listNotes).mockResolvedValue([
      { ...note, id: 'n1', note_type: 'incidente', body: 'sobreestadía', resolved_at: '2026-07-06 09:00:00' },
    ])
    renderSlideOver(baseTrip)
    expect(await screen.findByText('Resuelto')).toBeInTheDocument()
    expect(screen.getByText('Reabrir')).toBeInTheDocument()
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

describe('TripSlideOver — Ubicación de origen (solo operation_type)', () => {
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

- [ ] **Step 8: Correr los tests y confirmar que pasan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/TripSlideOver.test.tsx`
Expected: todos pasan.

- [ ] **Step 9: `tsc` limpio y suite completa**

Run: `cd monitor-app/frontend && npx tsc --noEmit && npm test`
Expected: sin errores de tipos (confirma cero referencias colgantes a `IndicatorDots`); toda la suite de vitest pasa sin regresiones.

- [ ] **Step 10: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/frontend/lib/types.ts monitor-app/frontend/lib/api/trips.ts monitor-app/frontend/hooks/useTripNotes.ts monitor-app/frontend/components/dashboard/TripNotesFeed.tsx monitor-app/frontend/components/dashboard/TripSlideOver.tsx monitor-app/frontend/components/dashboard/TripSlideOver.test.tsx
git rm monitor-app/frontend/components/dashboard/IndicatorDots.tsx monitor-app/frontend/components/dashboard/IndicatorDots.test.tsx
git commit -m "feat(diario): Bitácora con ciclo de vida de incidentes + Indicadores rewireado a IndicatorSwitches, texto legacy retirado"
```

---

## Self-Review

**1. Cobertura del spec**: cubre "Indicadores rediseñado" completo (switches con etiqueta, "1ra Vuelta" retirado, texto explícito de override con revertir) y "Bitácora — más espacio + incidentes con ciclo de vida real" completo (texto legacy retirado, `max-h-80` retirado, chip Abierto/Resuelto + acción, badge de incidentes abiertos en el hero). El fix de `_NOTE_SELECT` no estaba en el spec original — es un gap real encontrado en la investigación de este plan, documentado como tal.
**2. Placeholders**: ninguno — cada paso tiene código completo (componentes/hooks/tests enteros donde corresponde, diffs precisos con contexto exacto donde el archivo ya es grande).
**3. Consistencia de tipos**: `TripNote.resolved_at` (Task 3, Step 1) se usa igual en `useResolveTripNote` (Step 3), `TripNotesFeed` (Step 4) y `TripSlideOver` (Step 5); `tripsApi.resolveNote` tiene la misma firma en su definición (Step 2) y en todos sus usos.
**4. Alcance**: no toca `TripTable.tsx` (Plan 6) ni `FilterPopover` (Plan 7). El único archivo backend tocado es el mismo `_NOTE_SELECT` que el Plan 1 ya había extendido — consistente, no reabre otras partes de ese router.
**5. Orden entre tasks**: Task 1 (backend) y Task 2 (`IndicatorSwitches`) son independientes entre sí — se pueden ejecutar en cualquier orden. Task 3 depende de ambas (usa el componente de la Task 2 y necesita que `resolved_at` ya viaje desde el backend de la Task 1 para que sus tests de integración tengan sentido real, aunque los tests de la Task 3 mockean el pool/API directamente así que técnicamente pasarían igual sin la Task 1 — la dependencia real es de *producto*, no de compilación: sin la Task 1, el badge de incidentes y el chip Abierto/Resuelto nunca tendrían dato real en producción).
**6. Riesgo real evitado**: la Task 3 borra `IndicatorDots.tsx`/test recién en su Step 6, después de haber rewireado `TripSlideOver.tsx` en el Step 5 — nunca queda el árbol sin compilar entre pasos (mismo cuidado que el Plan 1 aplicó con `is_manual_stop`/`_insert_trip_stops`).
