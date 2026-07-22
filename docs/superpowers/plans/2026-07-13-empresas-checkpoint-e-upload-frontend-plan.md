# Checkpoint E — Frontend del upload EETT: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the frontend (upload modal + historial list + diff/approval detail page) for the Checkpoint D backend (`centralizer_parser.py`/`centralizer_diff.py`/`routers/centralizer_uploads.py`), plus the small backend extension needed to support asynchronous review (recompute diff on `GET`, show uploader/approver names).

**Architecture:** Small upload modal (dropzone + immediate summary) that hands off to a dedicated, URL-addressable detail page for the full diff review and role-gated approve/reject/apply actions. A shared historial list page is top-level (`/dashboard/uploads`) so the same pattern can host Seguros uploads later (Checkpoint F) without restructuring.

**Tech Stack:** FastAPI + asyncpg (backend, already established), Next.js App Router + TanStack Query + Tailwind + lucide-react (frontend, already established). No new dependencies.

## Global Constraints

- Backend tests run with `monitor-app/backend/api/venv` (`source venv/bin/activate`), never a different venv.
- Frontend verification before considering any task done: `npx tsc --noEmit`, `npx vitest run` — full `npm run build` only at the end of the whole plan (Task 10).
- No emojis anywhere in UI — lucide-react icons only.
- Never use the real production Excel — tests use `monitor-app/backend/api/tests/fixtures/centralizer_sample.xlsx` (synthetic, no PII).
- Follow existing patterns exactly: `TripBulkUpload.tsx` for dropzone/modal shape, `hooks/useCanAdmin.ts`/`hooks/useCanEdit.ts` for role gating, `hooks/useTripNotes.ts` for TanStack Query mutation shape, `lib/api/trips.ts` for API client shape.

---

### Task 1: Backend — extract `_download_and_parse` helper

**Files:**
- Modify: `monitor-app/backend/api/app/routers/centralizer_uploads.py`
- Test: `monitor-app/backend/api/tests/test_centralizer_uploads.py`

**Interfaces:**
- Produces: `_download_and_parse(supabase, storage_path: str) -> ParsedUpload` (sync function) — raises `HTTPException(502, ...)` on Storage download failure, `HTTPException(422, ...)` on parse failure. Used by Task 2's `get_upload`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_centralizer_uploads.py`, near the top after the existing imports (keep `_fixture_bytes()` helper as-is, it's already defined in this file):

```python
def test_download_and_parse_returns_parsed_workbook():
    from app.routers.centralizer_uploads import _download_and_parse
    supabase = MagicMock()
    supabase.storage.from_.return_value.download.return_value = _fixture_bytes()

    parsed = _download_and_parse(supabase, "centralizer-uploads/x.xlsx")

    assert parsed["sheet_summary"] == {"Empresas": 2, "Conductores": 3, "Vehiculos_Equipos": 3}
    supabase.storage.from_.assert_called_with("compliance-docs")


def test_download_and_parse_storage_error_raises_502():
    from fastapi import HTTPException
    from app.routers.centralizer_uploads import _download_and_parse
    supabase = MagicMock()
    supabase.storage.from_.return_value.download.side_effect = Exception("boom")

    with pytest.raises(HTTPException) as exc:
        _download_and_parse(supabase, "x.xlsx")
    assert exc.value.status_code == 502


def test_download_and_parse_missing_sheet_raises_422():
    from io import BytesIO
    from openpyxl import Workbook
    from fastapi import HTTPException
    from app.routers.centralizer_uploads import _download_and_parse

    wb = Workbook()
    wb.active.title = "Empresas"  # falta Conductores/Vehiculos_Equipos
    buf = BytesIO()
    wb.save(buf)

    supabase = MagicMock()
    supabase.storage.from_.return_value.download.return_value = buf.getvalue()

    with pytest.raises(HTTPException) as exc:
        _download_and_parse(supabase, "x.xlsx")
    assert exc.value.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_centralizer_uploads.py -k download_and_parse -v`
Expected: FAIL with `ImportError`/`AttributeError: module 'app.routers.centralizer_uploads' has no attribute '_download_and_parse'`

- [ ] **Step 3: Implement `_download_and_parse` and use it in `apply_upload`**

In `app/routers/centralizer_uploads.py`, add this function right after the `_ENTITY_TABLE` constant (before the `# ── Helpers de apply ──` section):

```python
def _download_and_parse(supabase, storage_path: str):
    """Descarga el archivo desde Storage y lo parsea — reusado por `apply`
    (que nunca confía en el diff del preview) y por `GET /{upload_id}` (que
    nunca persiste el diff, lo recalcula en cada lectura)."""
    try:
        raw = supabase.storage.from_(COMPLIANCE_BUCKET).download(storage_path)
    except Exception as e:
        raise HTTPException(502, f"Error descargando el archivo desde Storage: {e}")
    try:
        return parse_centralizer_workbook(raw)
    except ValueError as e:
        raise HTTPException(422, f"Error re-parseando el archivo: {e}")
```

Then in `apply_upload`, replace:

```python
    try:
        raw = supabase.storage.from_(COMPLIANCE_BUCKET).download(row["storage_path"])
    except Exception as e:
        raise HTTPException(502, f"Error descargando el archivo desde Storage: {e}")

    try:
        parsed = parse_centralizer_workbook(raw)
    except ValueError as e:
        raise HTTPException(422, f"Error re-parseando el archivo al aplicar: {e}")
```

with:

```python
    parsed = _download_and_parse(supabase, row["storage_path"])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_centralizer_uploads.py -v`
Expected: all PASS (including the 3 new tests and all pre-existing ones — `apply` behavior is unchanged, just refactored)

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/api/app/routers/centralizer_uploads.py monitor-app/backend/api/tests/test_centralizer_uploads.py
git commit -m "refactor(api): extract _download_and_parse helper, reused by apply and upcoming GET diff"
```

---

### Task 2: Backend — recompute diff on `GET /{id}` + display names on list/detail

**Files:**
- Modify: `monitor-app/backend/api/app/routers/centralizer_uploads.py`
- Test: `monitor-app/backend/api/tests/test_centralizer_uploads.py`

**Interfaces:**
- Consumes: `_download_and_parse` (Task 1), `compute_diff` (existing, `app/services/centralizer_diff.py`).
- Produces: `GET /centralizer-uploads/{id}` response now includes `data.diff` (a `DiffResult` or `None` if `status == 'failed'`) and `data.uploaded_by_name`/`data.approved_by_name`/`data.rejected_by_name`. `GET /centralizer-uploads` (list) rows now also include the same 3 `*_name` fields.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_centralizer_uploads.py`:

```python
def _upload_row(**overrides):
    row = {
        "id": UPLOAD_ID, "upload_kind": "centralizer", "file_name": "centralizador.xlsx",
        "storage_path": "centralizer-uploads/x.xlsx", "uploaded_by": USER_ID,
        "uploaded_at": "2026-07-13T00:00:00", "status": "previewed",
        "sheet_summary": {"Empresas": 2, "Conductores": 3, "Vehiculos_Equipos": 3},
        "parse_errors": [], "approved_by": None, "approved_at": None, "applied_at": None,
        "rejected_by": None, "rejected_at": None, "rejection_reason": None,
        "created_at": "2026-07-13T00:00:00",
        "uploaded_by_name": "Ana Pérez", "approved_by_name": None, "rejected_by_name": None,
    }
    row.update(overrides)
    return row


def test_get_upload_previewed_includes_recomputed_diff():
    pool = AsyncMock()
    pool.fetchrow.return_value = _upload_row(status="previewed")
    pool.fetch.side_effect = [[], [], []]  # compute_diff: sin matches existentes (fixture: todo 'new')

    supabase = MagicMock()
    supabase.storage.from_.return_value.download.return_value = _fixture_bytes()

    client = make_client(pool, supabase=supabase)
    res = client.get(f"/api/v1/centralizer-uploads/{UPLOAD_ID}")

    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["uploaded_by_name"] == "Ana Pérez"
    assert len(data["diff"]["transporters"]) == 2
    supabase.storage.from_.assert_called_with("compliance-docs")


def test_get_upload_failed_status_has_no_diff_and_skips_storage():
    pool = AsyncMock()
    pool.fetchrow.return_value = _upload_row(status="failed", storage_path=None)
    supabase = MagicMock()

    client = make_client(pool, supabase=supabase)
    res = client.get(f"/api/v1/centralizer-uploads/{UPLOAD_ID}")

    assert res.status_code == 200
    assert res.json()["data"]["diff"] is None
    supabase.storage.from_.assert_not_called()


def test_get_upload_not_found_returns_404():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)
    res = client.get(f"/api/v1/centralizer-uploads/{UPLOAD_ID}")
    assert res.status_code == 404


def test_list_uploads_includes_display_names():
    pool = AsyncMock()
    pool.fetch.return_value = [_upload_row()]
    pool.fetchval.return_value = 1
    client = make_client(pool)
    res = client.get("/api/v1/centralizer-uploads")
    assert res.status_code == 200
    assert res.json()["data"][0]["uploaded_by_name"] == "Ana Pérez"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_centralizer_uploads.py -k "get_upload or list_uploads_includes" -v`
Expected: FAIL — `test_get_upload_previewed_includes_recomputed_diff` fails because `data["diff"]` key doesn't exist yet (`KeyError`); `test_list_uploads_includes_display_names` fails because `uploaded_by_name` isn't in the response.

- [ ] **Step 3: Implement**

Replace the existing `list_uploads` function in `app/routers/centralizer_uploads.py`:

```python
@router.get("")
async def list_uploads(
    page: int = Query(1, ge=1), limit: int = Query(20, ge=1, le=100),
    pool=Depends(get_pool), _=Depends(get_current_user),
):
    offset = (page - 1) * limit
    rows = await pool.fetch(
        """
        SELECT c.id, c.upload_kind, c.file_name, c.status, c.uploaded_by, c.uploaded_at, c.sheet_summary,
               c.approved_by, c.approved_at, c.applied_at, c.rejected_by, c.rejected_at, c.rejection_reason,
               COALESCE(up.full_name, up.email) AS uploaded_by_name,
               COALESCE(ap.full_name, ap.email) AS approved_by_name,
               COALESCE(rp.full_name, rp.email) AS rejected_by_name
        FROM app.centralizer_uploads c
        LEFT JOIN public.profiles up ON up.id = c.uploaded_by
        LEFT JOIN public.profiles ap ON ap.id = c.approved_by
        LEFT JOIN public.profiles rp ON rp.id = c.rejected_by
        ORDER BY c.uploaded_at DESC
        LIMIT $1 OFFSET $2
        """,
        limit, offset,
    )
    count = await pool.fetchval("SELECT COUNT(*) FROM app.centralizer_uploads")
    return {"data": [dict(r) for r in rows], "count": count, "page": page, "limit": limit}
```

Replace the existing `get_upload` function:

```python
@router.get("/{upload_id}")
async def get_upload(
    upload_id: str,
    pool=Depends(get_pool), supabase=Depends(get_supabase), _=Depends(get_current_user),
):
    row = await pool.fetchrow(
        """
        SELECT c.*,
               COALESCE(up.full_name, up.email) AS uploaded_by_name,
               COALESCE(ap.full_name, ap.email) AS approved_by_name,
               COALESCE(rp.full_name, rp.email) AS rejected_by_name
        FROM app.centralizer_uploads c
        LEFT JOIN public.profiles up ON up.id = c.uploaded_by
        LEFT JOIN public.profiles ap ON ap.id = c.approved_by
        LEFT JOIN public.profiles rp ON rp.id = c.rejected_by
        WHERE c.id = $1
        """,
        upload_id,
    )
    if not row:
        raise HTTPException(404, "Upload no encontrado")

    data = dict(row)
    if data["status"] == "failed":
        data["diff"] = None
    else:
        parsed = _download_and_parse(supabase, data["storage_path"])
        data["diff"] = await compute_diff(pool, parsed)
    return {"data": data}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_centralizer_uploads.py -v`
Expected: all PASS

- [ ] **Step 5: Run the full backend suite**

Run: `python -m pytest tests/ -q --deselect tests/test_centralizer_uploads_e2e.py`
Expected: all PASS, no regressions

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api/app/routers/centralizer_uploads.py monitor-app/backend/api/tests/test_centralizer_uploads.py
git commit -m "feat(api): recompute diff on GET /centralizer-uploads/{id}, expose uploader/approver names"
```

---

### Task 3: Frontend — TypeScript types

**Files:**
- Modify: `monitor-app/frontend/lib/types.ts` (append at end of file)

**Interfaces:**
- Produces: `CentralizerFieldDiff`, `CentralizerChangeType`, `CentralizerEntityDiff`, `CentralizerParseError`, `CentralizerDiff`, `CentralizerUploadStatus`, `CentralizerUploadSummary`, `CentralizerUploadDetail` — consumed by every later frontend task.

- [ ] **Step 1: Append the types**

```ts
export type CentralizerFieldDiff = {
  field:    string
  old:      unknown
  new:      unknown
  conflict: boolean
}

export type CentralizerChangeType = 'new' | 'updated' | 'unchanged' | 'conflict'

export type CentralizerEntityDiff = {
  entity_key:      string
  match_method:    'rut' | 'legacy_id' | 'plate' | null
  existing_id:     string | null
  change_type:     CentralizerChangeType
  field_diffs:     CentralizerFieldDiff[]
  conflict_reason: string | null
  parsed_row:      Record<string, unknown>
}

export type CentralizerParseError = {
  sheet:       string
  row?:        number
  identifier?: string
  reason:      string
}

export type CentralizerDiff = {
  transporters: CentralizerEntityDiff[]
  drivers:      CentralizerEntityDiff[]
  vehicles:     CentralizerEntityDiff[]
  parse_errors: CentralizerParseError[]
}

export type CentralizerUploadStatus = 'parsed' | 'previewed' | 'approved' | 'applied' | 'rejected' | 'failed'

export type CentralizerUploadSummary = {
  id:                string
  upload_kind:       'centralizer' | 'insurance'
  file_name:         string
  status:            CentralizerUploadStatus
  uploaded_by:       string
  uploaded_by_name:  string | null
  uploaded_at:       string
  sheet_summary:     Record<string, number> | null
  approved_by:       string | null
  approved_by_name:  string | null
  approved_at:       string | null
  applied_at:        string | null
  rejected_by:       string | null
  rejected_by_name:  string | null
  rejected_at:       string | null
  rejection_reason:  string | null
}

export type CentralizerUploadDetail = CentralizerUploadSummary & {
  parse_errors: CentralizerParseError[]
  diff:         CentralizerDiff | null
}
```

- [ ] **Step 2: Verify no type errors**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: no new errors (existing `lib/types.ts` content untouched, only appended)

- [ ] **Step 3: Commit**

```bash
git add monitor-app/frontend/lib/types.ts
git commit -m "feat(frontend): types for centralizer upload diff/detail"
```

---

### Task 4: Frontend — API client

**Files:**
- Create: `monitor-app/frontend/lib/api/centralizerUploads.ts`

**Interfaces:**
- Consumes: `CentralizerUploadDetail`, `CentralizerUploadSummary`, `CentralizerDiff`, `CentralizerParseError` (Task 3), `apiFetch`/`ApiError` (`lib/api/client.ts`, existing).
- Produces: `centralizerUploadsApi` object with `upload`, `list`, `get`, `approve`, `reject`, `apply` — consumed by Task 5's hooks.

- [ ] **Step 1: Create the file**

```ts
import type { CentralizerUploadDetail, CentralizerUploadSummary, CentralizerDiff, CentralizerParseError } from '@/lib/types'
import { apiFetch } from './client'

export type CentralizerUploadListResponse = {
  data:  CentralizerUploadSummary[]
  count: number
  page:  number
  limit: number
}

export type CentralizerUploadPreview = {
  upload_id:     string
  sheet_summary: Record<string, number>
  parse_errors:  CentralizerParseError[]
  diff:          CentralizerDiff
}

export const centralizerUploadsApi = {
  upload: (file: File) => {
    const form = new FormData()
    form.set('file', file)
    return apiFetch<CentralizerUploadPreview>('/api/v1/centralizer-uploads', {
      method: 'POST',
      body: form,
    })
  },

  list: (params?: { page?: number; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params?.page)  qs.set('page',  String(params.page))
    if (params?.limit) qs.set('limit', String(params.limit))
    const q = qs.toString()
    return apiFetch<CentralizerUploadListResponse>(`/api/v1/centralizer-uploads${q ? `?${q}` : ''}`)
  },

  get: (id: string) =>
    apiFetch<{ data: CentralizerUploadDetail }>(`/api/v1/centralizer-uploads/${id}`),

  approve: (id: string) =>
    apiFetch<{ ok: boolean; status: string }>(`/api/v1/centralizer-uploads/${id}/approve`, { method: 'POST' }),

  reject: (id: string, reason?: string) =>
    apiFetch<{ ok: boolean; status: string }>(`/api/v1/centralizer-uploads/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  apply: (id: string) =>
    apiFetch<{ ok: boolean; status: string; matched_transporters: number }>(
      `/api/v1/centralizer-uploads/${id}/apply`, { method: 'POST' },
    ),
}
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add monitor-app/frontend/lib/api/centralizerUploads.ts
git commit -m "feat(frontend): API client for centralizer uploads"
```

---

### Task 5: Frontend — TanStack Query hooks

**Files:**
- Create: `monitor-app/frontend/hooks/useCentralizerUploads.ts`

**Interfaces:**
- Consumes: `centralizerUploadsApi` (Task 4).
- Produces: `useCentralizerUploads(params)`, `useCentralizerUpload(id)`, `useApproveCentralizerUpload(id)`, `useRejectCentralizerUpload(id)`, `useApplyCentralizerUpload(id)` — consumed by Task 8 (list page) and Task 9 (detail page).

- [ ] **Step 1: Create the file**

```ts
'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { centralizerUploadsApi } from '@/lib/api/centralizerUploads'

export function useCentralizerUploads(params?: { page?: number; limit?: number }) {
  return useQuery({
    queryKey: ['centralizer-uploads', params],
    queryFn: () => centralizerUploadsApi.list(params),
  })
}

export function useCentralizerUpload(id: string) {
  return useQuery({
    queryKey: ['centralizer-upload', id],
    queryFn: () => centralizerUploadsApi.get(id),
    enabled: !!id,
  })
}

export function useApproveCentralizerUpload(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => centralizerUploadsApi.approve(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['centralizer-upload', id] }),
  })
}

export function useRejectCentralizerUpload(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reason?: string) => centralizerUploadsApi.reject(id, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['centralizer-upload', id] }),
  })
}

export function useApplyCentralizerUpload(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => centralizerUploadsApi.apply(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['centralizer-upload', id] }),
  })
}
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add monitor-app/frontend/hooks/useCentralizerUploads.ts
git commit -m "feat(frontend): TanStack Query hooks for centralizer uploads"
```

---

### Task 6: Frontend — `CentralizerUploadModal`

**Files:**
- Create: `monitor-app/frontend/components/dashboard/CentralizerUploadModal.tsx`
- Test: `monitor-app/frontend/components/dashboard/CentralizerUploadModal.test.tsx`

**Interfaces:**
- Consumes: `centralizerUploadsApi.upload` (Task 4), `ApiError` (`lib/api/client.ts`, existing).
- Produces: `CentralizerUploadModal({ open, onClose })` — consumed by Task 8 (list page).

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CentralizerUploadModal } from './CentralizerUploadModal'
import { centralizerUploadsApi } from '@/lib/api/centralizerUploads'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('@/lib/api/centralizerUploads', () => ({
  centralizerUploadsApi: { upload: vi.fn() },
}))

function uploadFile(name = 'centralizador.xlsx') {
  const file = new File(['contenido'], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  fireEvent.change(screen.getByLabelText('Archivo Excel'), { target: { files: [file] } })
}

beforeEach(() => {
  vi.mocked(centralizerUploadsApi.upload).mockReset()
  pushMock.mockReset()
})

describe('CentralizerUploadModal', () => {
  it('rejects non-.xlsx files before calling the API', () => {
    render(<CentralizerUploadModal open onClose={vi.fn()} />)
    const file = new File(['x'], 'centralizador.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText('Archivo Excel'), { target: { files: [file] } })
    expect(screen.getByText(/no es un Excel/)).toBeInTheDocument()
    expect(centralizerUploadsApi.upload).not.toHaveBeenCalled()
  })

  it('shows sheet summary and parse error count after a successful upload', async () => {
    vi.mocked(centralizerUploadsApi.upload).mockResolvedValue({
      upload_id: 'aaaaaaaa-0000-0000-0000-000000000001',
      sheet_summary: { Empresas: 2, Conductores: 3, Vehiculos_Equipos: 3 },
      parse_errors: [{ sheet: 'Conductores', row: 5, reason: 'RUT vacío' }],
      diff: { transporters: [], drivers: [], vehicles: [], parse_errors: [] },
    })
    render(<CentralizerUploadModal open onClose={vi.fn()} />)
    uploadFile()
    await waitFor(() => expect(screen.getByText('Empresas: 2')).toBeInTheDocument())
    expect(screen.getByText(/1 fila con error de parseo/)).toBeInTheDocument()
  })

  it('navigates to the upload detail page and closes on "Ver diff completo"', async () => {
    const onClose = vi.fn()
    vi.mocked(centralizerUploadsApi.upload).mockResolvedValue({
      upload_id: 'aaaaaaaa-0000-0000-0000-000000000001',
      sheet_summary: { Empresas: 1, Conductores: 0, Vehiculos_Equipos: 0 },
      parse_errors: [],
      diff: { transporters: [], drivers: [], vehicles: [], parse_errors: [] },
    })
    render(<CentralizerUploadModal open onClose={onClose} />)
    uploadFile()
    await waitFor(() => expect(screen.getByText('Ver diff completo')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Ver diff completo'))
    expect(pushMock).toHaveBeenCalledWith('/dashboard/uploads/aaaaaaaa-0000-0000-0000-000000000001')
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/CentralizerUploadModal.test.tsx`
Expected: FAIL — module `./CentralizerUploadModal` doesn't exist yet

- [ ] **Step 3: Implement the component**

```tsx
'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, Upload, Loader2, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { centralizerUploadsApi, type CentralizerUploadPreview } from '@/lib/api/centralizerUploads'
import { ApiError } from '@/lib/api/client'

interface Props {
  open:    boolean
  onClose: () => void
}

type Step = 'upload' | 'summary'

export function CentralizerUploadModal({ open, onClose }: Props) {
  const router = useRouter()
  const [step, setStep]             = useState<Step>('upload')
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading]   = useState(false)
  const [fileErr, setFileErr]       = useState<string | null>(null)
  const [result, setResult]         = useState<CentralizerUploadPreview | null>(null)
  const fileRef  = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const reset = useCallback(() => {
    setStep('upload'); setResult(null); setUploading(false)
    setIsDragging(false); setFileErr(null)
  }, [])

  const handleClose = useCallback(() => { reset(); onClose() }, [reset, onClose])

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [open, handleClose])

  async function processFile(file: File) {
    setFileErr(null)
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setFileErr(`"${file.name}" no es un Excel (.xlsx)`)
      return
    }
    setUploading(true)
    try {
      const res = await centralizerUploadsApi.upload(file)
      setResult(res)
      setStep('summary')
    } catch (e) {
      const detail = e instanceof ApiError ? e.detail : null
      const message = detail && typeof detail === 'object' && 'message' in detail
        ? String((detail as { message: unknown }).message)
        : e instanceof Error ? e.message : 'Error al subir el archivo'
      setFileErr(message)
    } finally {
      setUploading(false)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }

  function goToDetail() {
    if (!result) return
    router.push(`/dashboard/uploads/${result.upload_id}`)
    handleClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-backdrop-in">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Subir Excel EETT"
        tabIndex={-1}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] focus:outline-none animate-modal-in"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-bold text-base text-slate-800">Subir Excel EETT</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {step === 'upload'  && 'Sube el archivo con las hojas Empresas, Conductores y Vehiculos_Equipos'}
              {step === 'summary' && 'Archivo subido — revisa el resumen'}
            </p>
          </div>
          <button onClick={handleClose} aria-label="Cerrar" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-6">
          {step === 'upload' && (
            <div className="space-y-4">
              <div
                role="button"
                tabIndex={0}
                aria-label="Subir archivo Excel"
                onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
                onClick={() => !uploading && fileRef.current?.click()}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() } }}
                className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                  isDragging ? 'border-accent bg-accent/5 scale-[1.01]' : 'border-gray-200 hover:border-accent/50 hover:bg-gray-50/60'
                }`}
              >
                {uploading
                  ? <Loader2 size={32} className="mx-auto mb-3 animate-spin text-accent" />
                  : <Upload size={32} className={`mx-auto mb-3 ${isDragging ? 'text-accent' : 'text-gray-300'}`} />}
                <p className="text-sm font-semibold text-gray-600">
                  {uploading ? 'Subiendo y calculando diff...' : 'Arrastra tu Excel aquí'}
                </p>
                {!uploading && <p className="text-xs text-gray-400 mt-1">o haz clic para seleccionar</p>}
              </div>
              <input
                ref={fileRef} type="file" accept=".xlsx" className="hidden"
                onChange={onFileChange} aria-label="Archivo Excel" disabled={uploading}
              />

              {fileErr && (
                <p className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <XCircle size={13} className="shrink-0 mt-0.5" />
                  {fileErr}
                </p>
              )}
            </div>
          )}

          {step === 'summary' && result && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                <CheckCircle2 size={16} className="shrink-0" />
                <p className="text-sm font-semibold">Archivo procesado</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(result.sheet_summary).map(([sheet, count]) => (
                  <span key={sheet} className="text-xs px-2.5 py-1 rounded-full bg-gray-50 border border-gray-200 text-gray-600">
                    {sheet}: {count}
                  </span>
                ))}
              </div>
              {result.parse_errors.length > 0 && (
                <p className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  {result.parse_errors.length} fila{result.parse_errors.length !== 1 ? 's' : ''} con error de parseo — se puede ver el detalle en la página del upload
                </p>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border px-6 py-4 flex items-center gap-3">
          {step === 'upload' && (
            <button onClick={handleClose} className="px-4 py-2 text-sm text-gray-500 border border-border rounded-lg hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
          )}
          {step === 'summary' && (
            <button onClick={goToDetail} className="flex-1 bg-accent text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-accent/90 transition-colors">
              Ver diff completo
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run components/dashboard/CentralizerUploadModal.test.tsx`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/CentralizerUploadModal.tsx monitor-app/frontend/components/dashboard/CentralizerUploadModal.test.tsx
git commit -m "feat(frontend): CentralizerUploadModal (dropzone + immediate summary)"
```

---

### Task 7: Frontend — `UploadDiffView` (diff body renderer)

**Files:**
- Create: `monitor-app/frontend/components/dashboard/UploadDiffView.tsx`
- Test: `monitor-app/frontend/components/dashboard/UploadDiffView.test.tsx`

**Interfaces:**
- Consumes: `CentralizerDiff`, `CentralizerEntityDiff`, `CentralizerChangeType` (Task 3).
- Produces: `UploadDiffView({ diff })` — consumed by Task 9 (detail page).

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { UploadDiffView } from './UploadDiffView'
import type { CentralizerDiff } from '@/lib/types'

const diff: CentralizerDiff = {
  transporters: [
    {
      entity_key: '11111111', match_method: null, existing_id: null, change_type: 'new',
      field_diffs: [], conflict_reason: null, parsed_row: { business_name: 'Transportes Nueva SPA' },
    },
    {
      entity_key: '22222222', match_method: 'rut', existing_id: 't-1', change_type: 'updated',
      field_diffs: [{ field: 'business_name', old: 'Nombre Viejo', new: 'Nombre Nuevo', conflict: false }],
      conflict_reason: null, parsed_row: { business_name: 'Nombre Nuevo' },
    },
    {
      entity_key: '33333333', match_method: 'rut', existing_id: 't-2', change_type: 'conflict',
      field_diffs: [{ field: 'business_name', old: 'A', new: 'B', conflict: true }],
      conflict_reason: 'manually_edited_field', parsed_row: { business_name: 'B' },
    },
    {
      entity_key: '44444444', match_method: 'rut', existing_id: 't-3', change_type: 'unchanged',
      field_diffs: [], conflict_reason: null, parsed_row: { business_name: 'Sin Cambios SPA' },
    },
  ],
  drivers: [], vehicles: [],
  parse_errors: [{ sheet: 'Conductores', row: 5, reason: 'RUT vacío' }],
}

describe('UploadDiffView', () => {
  it('shows the summary chips with correct counts', () => {
    render(<UploadDiffView diff={diff} />)
    expect(screen.getByText('Nuevas 1')).toBeInTheDocument()
    expect(screen.getByText('Modificadas 1')).toBeInTheDocument()
    expect(screen.getByText('Conflictos 1')).toBeInTheDocument()
    expect(screen.getByText('Sin cambios 1')).toBeInTheDocument()
    expect(screen.getByText('Errores 1')).toBeInTheDocument()
  })

  it('defaults to the Nuevas tab and shows only new rows', () => {
    render(<UploadDiffView diff={diff} />)
    expect(screen.getByText('Transportes Nueva SPA')).toBeInTheDocument()
    expect(screen.queryByText('Nombre Nuevo')).not.toBeInTheDocument()
  })

  it('switches to Conflictos and expands a card to show the conflicting field', () => {
    render(<UploadDiffView diff={diff} />)
    fireEvent.click(screen.getByText('Conflictos'))
    expect(screen.getByText('B')).toBeInTheDocument() // entityLabel usa parsed_row.business_name
    fireEvent.click(screen.getByText('B'))
    expect(screen.getByText(/A → B/)).toBeInTheDocument()
    expect(screen.getByText(/conflicto — no se aplica/)).toBeInTheDocument()
  })

  it('shows parse errors in the Errores tab', () => {
    render(<UploadDiffView diff={diff} />)
    fireEvent.click(screen.getByText('Errores'))
    expect(screen.getByText(/RUT vacío/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run components/dashboard/UploadDiffView.test.tsx`
Expected: FAIL — module doesn't exist yet

- [ ] **Step 3: Implement the component**

```tsx
'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { CentralizerDiff, CentralizerEntityDiff, CentralizerChangeType } from '@/lib/types'

const ENTITY_LABELS = { transporters: 'Empresas', drivers: 'Conductores', vehicles: 'Vehículos' } as const
type EntityKind = keyof typeof ENTITY_LABELS

const BUCKET_TABS: { id: CentralizerChangeType; label: string }[] = [
  { id: 'new',      label: 'Nuevas' },
  { id: 'updated',  label: 'Modificadas' },
  { id: 'conflict', label: 'Conflictos' },
]

function entityLabel(row: CentralizerEntityDiff, kind: EntityKind): string {
  if (kind === 'transporters') return String(row.parsed_row.business_name ?? row.entity_key)
  if (kind === 'drivers')      return String(row.parsed_row.full_name ?? row.entity_key)
  return String(row.parsed_row.plate ?? row.entity_key)
}

function DiffCard({ row, kind }: { row: CentralizerEntityDiff; kind: EntityKind }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="border border-border rounded-xl p-3 mb-2">
      <button onClick={() => setExpanded(e => !e)} className="w-full flex items-center justify-between text-left">
        <span className="text-sm font-semibold text-slate-800">{entityLabel(row, kind)}</span>
        <span className="flex items-center gap-2 text-xs text-gray-400">
          {row.field_diffs.length} campo{row.field_diffs.length !== 1 ? 's' : ''}
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
          {row.field_diffs.map((fd, i) => (
            <p key={i} className={`text-xs ${fd.conflict ? 'text-red-600' : 'text-gray-600'}`}>
              <span className="font-mono">{fd.field}</span>: {String(fd.old ?? '—')} → {String(fd.new ?? '—')}
              {fd.conflict && ' (conflicto — no se aplica)'}
            </p>
          ))}
          {row.conflict_reason && (
            <p className="text-xs text-red-600 font-semibold">Motivo: {row.conflict_reason}</p>
          )}
        </div>
      )}
    </div>
  )
}

export function UploadDiffView({ diff }: { diff: CentralizerDiff }) {
  const [tab, setTab] = useState<CentralizerChangeType | 'errors'>('new')

  const buckets = useMemo(() => {
    const result: Record<CentralizerChangeType, Partial<Record<EntityKind, CentralizerEntityDiff[]>>> = {
      new: {}, updated: {}, unchanged: {}, conflict: {},
    }
    for (const kind of ['transporters', 'drivers', 'vehicles'] as EntityKind[]) {
      for (const row of diff[kind]) {
        result[row.change_type][kind] ??= []
        result[row.change_type][kind]!.push(row)
      }
    }
    return result
  }, [diff])

  const counts = {
    new:       Object.values(buckets.new).flat().length,
    updated:   Object.values(buckets.updated).flat().length,
    conflict:  Object.values(buckets.conflict).flat().length,
    unchanged: Object.values(buckets.unchanged).flat().length,
    errors:    diff.parse_errors.length,
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        <span className="text-xs px-3 py-1.5 rounded-full bg-green-50 border border-green-100 text-green-700 font-semibold">Nuevas {counts.new}</span>
        <span className="text-xs px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 font-semibold">Modificadas {counts.updated}</span>
        <span className="text-xs px-3 py-1.5 rounded-full bg-red-50 border border-red-100 text-red-700 font-semibold">Conflictos {counts.conflict}</span>
        <span className="text-xs px-3 py-1.5 rounded-full bg-gray-50 border border-gray-200 text-gray-400">Sin cambios {counts.unchanged}</span>
        <span className="text-xs px-3 py-1.5 rounded-full bg-gray-50 border border-gray-200 text-gray-400">Errores {counts.errors}</span>
      </div>

      <div className="flex border-b border-border mb-4">
        {[...BUCKET_TABS, { id: 'errors' as const, label: 'Errores' }].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold transition-colors ${
              tab === t.id ? 'text-accent border-b-2 border-accent' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'errors' ? (
        <div className="space-y-1.5">
          {diff.parse_errors.length === 0 && <p className="text-sm text-gray-400">Sin errores de parseo.</p>}
          {diff.parse_errors.map((pe, i) => (
            <div key={i} className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              <p className="text-xs text-amber-700">
                <span className="font-semibold">{pe.sheet}</span>
                {pe.identifier && ` · ${pe.identifier}`}
                {pe.row && ` · fila ${pe.row}`} — {pe.reason}
              </p>
            </div>
          ))}
        </div>
      ) : (
        (['transporters', 'drivers', 'vehicles'] as EntityKind[]).map(kind => {
          const rows = buckets[tab][kind] ?? []
          if (rows.length === 0) return null
          return (
            <div key={kind} className="mb-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">
                {ENTITY_LABELS[kind]} ({rows.length})
              </p>
              {rows.map(row => <DiffCard key={row.entity_key} row={row} kind={kind} />)}
            </div>
          )
        })
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run components/dashboard/UploadDiffView.test.tsx`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/UploadDiffView.tsx monitor-app/frontend/components/dashboard/UploadDiffView.test.tsx
git commit -m "feat(frontend): UploadDiffView — bucket tabs, entity grouping, expandable field diff"
```

---

### Task 8: Frontend — historial list page + nav entry

**Files:**
- Create: `monitor-app/frontend/app/dashboard/uploads/page.tsx`
- Modify: `monitor-app/frontend/components/dashboard/Sidebar.tsx`

**Interfaces:**
- Consumes: `useCentralizerUploads` (Task 5), `useCanEdit` (`hooks/useCanEdit.ts`, existing), `CentralizerUploadModal` (Task 6), `CentralizerUploadStatus` (Task 3).

- [ ] **Step 1: Add the nav entry**

In `components/dashboard/Sidebar.tsx`, add `Upload` to the lucide-react import list:

```ts
import {
  Truck, Building2, Users, LogOut, Upload,
  ChevronLeft, ChevronRight, Shield, ShieldCheck, Settings,
} from 'lucide-react'
```

Add a row to `NAV_ITEMS`:

```ts
const NAV_ITEMS = [
  { href: '/dashboard/diario',         label: 'Diario',   icon: Truck },
  { href: '/dashboard/transportistas', label: 'Empresas', icon: Building2 },
  { href: '/dashboard/seguros',        label: 'Seguros',  icon: ShieldCheck },
  { href: '/dashboard/uploads',        label: 'Uploads',  icon: Upload },
]
```

- [ ] **Step 2: Create the list page**

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Upload as UploadIcon, Loader2 } from 'lucide-react'
import { useCentralizerUploads } from '@/hooks/useCentralizerUploads'
import { useCanEdit } from '@/hooks/useCanEdit'
import { CentralizerUploadModal } from '@/components/dashboard/CentralizerUploadModal'
import type { CentralizerUploadStatus } from '@/lib/types'

const STATUS_LABELS: Record<CentralizerUploadStatus, string> = {
  parsed: 'Procesando', previewed: 'Pendiente de revisión', approved: 'Aprobado, pendiente de aplicar',
  applied: 'Aplicado', rejected: 'Rechazado', failed: 'Falló el parseo',
}

const STATUS_STYLES: Record<CentralizerUploadStatus, string> = {
  parsed: 'bg-gray-50 text-gray-500 border-gray-200',
  previewed: 'bg-amber-50 text-amber-700 border-amber-100',
  approved: 'bg-blue-50 text-blue-700 border-blue-100',
  applied: 'bg-green-50 text-green-700 border-green-100',
  rejected: 'bg-red-50 text-red-700 border-red-100',
  failed: 'bg-red-50 text-red-700 border-red-100',
}

export default function UploadsPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const canEdit = useCanEdit()
  const { data, isLoading } = useCentralizerUploads({ limit: 50 })
  const uploads = data?.data ?? []

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-bold text-slate-800">Historial de Uploads</h1>
        {canEdit && (
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 bg-accent text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-accent/90 transition-colors"
          >
            <UploadIcon size={14} />
            Subir Excel EETT
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
      ) : uploads.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-12">Todavía no se ha subido ningún archivo.</p>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800 text-[10px] font-bold text-slate-300 uppercase tracking-wide">
                <th className="px-4 py-2 text-left">Archivo</th>
                <th className="px-4 py-2 text-left">Subido por</th>
                <th className="px-4 py-2 text-left">Fecha</th>
                <th className="px-4 py-2 text-left">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {uploads.map(u => (
                <tr key={u.id}>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/uploads/${u.id}`} className="text-accent font-semibold hover:underline">
                      {u.file_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.uploaded_by_name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{new Date(u.uploaded_at).toLocaleString('es-CL')}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${STATUS_STYLES[u.status]}`}>
                      {STATUS_LABELS[u.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CentralizerUploadModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}
```

- [ ] **Step 3: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 4: Commit**

```bash
git add monitor-app/frontend/app/dashboard/uploads/page.tsx monitor-app/frontend/components/dashboard/Sidebar.tsx
git commit -m "feat(frontend): uploads historial list page + nav entry"
```

---

### Task 9: Frontend — detail/diff/approval page

**Files:**
- Create: `monitor-app/frontend/app/dashboard/uploads/[id]/page.tsx`

**Interfaces:**
- Consumes: `useCentralizerUpload`, `useApproveCentralizerUpload`, `useRejectCentralizerUpload`, `useApplyCentralizerUpload` (Task 5), `useCanAdmin` (`hooks/useCanAdmin.ts`, existing), `UploadDiffView` (Task 7).

- [ ] **Step 1: Create the page**

```tsx
'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, XCircle } from 'lucide-react'
import {
  useCentralizerUpload, useApproveCentralizerUpload,
  useRejectCentralizerUpload, useApplyCentralizerUpload,
} from '@/hooks/useCentralizerUploads'
import { useCanAdmin } from '@/hooks/useCanAdmin'
import { UploadDiffView } from '@/components/dashboard/UploadDiffView'

export default function UploadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const canAdmin = useCanAdmin()
  const { data, isLoading, error } = useCentralizerUpload(id)
  const approve = useApproveCentralizerUpload(id)
  const reject  = useRejectCentralizerUpload(id)
  const apply   = useApplyCentralizerUpload(id)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason]       = useState('')

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
  if (error || !data) return <p className="p-6 text-sm text-red-600">No se pudo cargar el upload.</p>

  const upload = data.data
  const busy = approve.isPending || reject.isPending || apply.isPending

  async function confirmReject() {
    await reject.mutateAsync(reason || undefined)
    setRejecting(false); setReason('')
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link href="/dashboard/uploads" className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 mb-4">
        <ArrowLeft size={13} /> Volver al historial
      </Link>

      <div className="mb-6">
        <h1 className="text-lg font-bold text-slate-800">{upload.file_name}</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Subido por {upload.uploaded_by_name ?? '—'} · {new Date(upload.uploaded_at).toLocaleString('es-CL')} · estado: {upload.status}
        </p>
        {upload.rejection_reason && (
          <p className="text-xs text-red-600 mt-1">Motivo de rechazo: {upload.rejection_reason}</p>
        )}
      </div>

      {upload.status === 'failed' ? (
        <p className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
          <XCircle size={16} className="shrink-0 mt-0.5" />
          {upload.parse_errors[0]?.reason ?? 'Error al parsear el archivo.'}
        </p>
      ) : upload.diff ? (
        <UploadDiffView diff={upload.diff} />
      ) : null}

      {canAdmin && (upload.status === 'previewed' || upload.status === 'approved') && (
        <div className="sticky bottom-0 mt-6 border-t border-border bg-white py-4 flex flex-col gap-3 shadow-[0_-4px_12px_rgba(0,0,0,0.04)] rounded-t-xl">
          {rejecting ? (
            <div className="flex items-center gap-3">
              <input
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Motivo del rechazo (opcional)"
                className="flex-1 text-sm border border-border rounded-lg px-3 py-2"
              />
              <button onClick={() => setRejecting(false)} className="px-4 py-2 text-sm text-gray-500 border border-border rounded-lg hover:bg-gray-50">
                Cancelar
              </button>
              <button
                onClick={confirmReject}
                disabled={busy}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-40"
              >
                Confirmar rechazo
              </button>
            </div>
          ) : (
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setRejecting(true)}
                disabled={busy}
                className="px-4 py-2 text-sm font-semibold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-40"
              >
                Rechazar
              </button>
              {upload.status === 'previewed' && (
                <button
                  onClick={() => approve.mutate()}
                  disabled={busy}
                  className="px-4 py-2 text-sm font-semibold text-white bg-accent rounded-lg hover:bg-accent/90 disabled:opacity-40"
                >
                  {approve.isPending ? 'Aprobando...' : 'Aprobar'}
                </button>
              )}
              {upload.status === 'approved' && (
                <button
                  onClick={() => apply.mutate()}
                  disabled={busy}
                  className="px-4 py-2 text-sm font-semibold text-white bg-accent rounded-lg hover:bg-accent/90 disabled:opacity-40"
                >
                  {apply.isPending ? 'Aplicando...' : 'Aplicar'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add monitor-app/frontend/app/dashboard/uploads/\[id\]/page.tsx
git commit -m "feat(frontend): upload detail page — diff view + role-gated approve/reject/apply"
```

---

### Task 10: Full verification (backend + frontend + manual smoke)

**Files:** none (verification only)

- [ ] **Step 1: Full backend suite**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/ -q --deselect tests/test_centralizer_uploads_e2e.py`
Expected: all PASS

- [ ] **Step 2: Full frontend checks**

Run: `cd monitor-app/frontend && npx tsc --noEmit && npx vitest run && npm run build`
Expected: no type errors, all Vitest tests PASS, build succeeds

- [ ] **Step 3: Manual Playwright smoke test (same convention as prior checkpoints)**

Using the Playwright MCP against a local dev server (`npm run dev` + backend `uvicorn` pointed at a dev Supabase project), with `tests/fixtures/centralizer_sample.xlsx` (never the real production file):
1. Navigate to `/dashboard/uploads`, click "Subir Excel EETT", upload the fixture, confirm the summary shows `Empresas: 2, Conductores: 3, Vehiculos_Equipos: 3` and no parse errors.
2. Click "Ver diff completo" — confirm navigation to `/dashboard/uploads/[id]`, chips show `Nuevas 2` (or similar, depending on whether the sample RUTs already exist in the target dev DB), tabs switch correctly, a card expands to show field diffs.
3. As admin, click "Aprobar" — confirm the sticky bar swaps to show "Aplicar" and the page refetches (status badge updates).
4. Click "Aplicar" — confirm success, sticky bar disappears (no actions left), diff now shows the same rows as `unchanged`.
5. Confirm zero console errors throughout, and revert any test data created in the dev DB afterward (delete the synthetic RUTs from `centralizer_sample.xlsx` if this was run against a real dev Supabase project).

- [ ] **Step 4: Update AGENTLOG.md**

Per `CLAUDE.md`'s rule, add a new dated section to `AGENTLOG.md` summarizing Checkpoint E (what was built, decisions from the brainstorm, verification results, next step being Checkpoint F).

## Self-Review Notes

- **Spec coverage**: modal (Task 6), historial list (Task 8), detail/diff/approval page (Task 9), diff-on-GET + names backend change (Tasks 1-2), types/client/hooks (Tasks 3-5), YAGNI exclusions from the spec (no insurance diff body, no pagination infra) — respected, not built.
- **Type consistency checked**: `CentralizerUploadDetail`/`CentralizerDiff`/`CentralizerEntityDiff` (Task 3) used identically in Tasks 4, 5, 6, 7, 9. `centralizerUploadsApi` method names (`upload`/`list`/`get`/`approve`/`reject`/`apply`, Task 4) match what hooks (Task 5) call. Hook names (`useCentralizerUpload`/`useApproveCentralizerUpload`/etc., Task 5) match what Tasks 8/9 import.
- **No placeholders**: every step has complete, runnable code.
