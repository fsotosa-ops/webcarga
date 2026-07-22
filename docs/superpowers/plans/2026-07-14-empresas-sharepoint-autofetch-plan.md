# Auto-fetch del Excel EETT desde SharePoint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** el modal de subida del Excel EETT deja de pedir un archivo local — trae el archivo actual directo desde SharePoint vía Graph API, y sigue exactamente el mismo camino de siempre (Storage → parseo → columnas sin resolver → diff → preview/aprobación/apply sin cambios).

**Architecture:** nuevo helper async `fetch_sharepoint_file(site_path, file_path) -> bytes` (client-credentials OAuth + Graph API), reusando el app registration ya usado por el pipeline Mage congelado. `POST /centralizer-uploads` mantiene `file` como parámetro opcional — si se omite, hace el fetch internamente y construye un `UploadFile` real para reusar el resto del pipeline sin duplicar código.

**Tech Stack:** `httpx.AsyncClient` para las llamadas a Graph API (async, no bloquea el event loop — se promueve de dependencia de test a dependencia real).

## Global Constraints

- Backend tests: `monitor-app/backend/api/venv`.
- Frontend: `npx tsc --noEmit` + `npx vitest run` en cada task; `npm run build` al final.
- **Al agregar `httpx` a `pyproject.toml`, editar también el Dockerfile en el mismo commit** — 2 incidentes reales previos (python-multipart, openpyxl) por olvidar esto.
- No aplicar secretos a GCP Secret Manager sin que el usuario ya los haya generado — ese paso es manual, fuera de este plan (ver Task 5).
- No emojis — lucide-react.

---

### Task 1: `httpx` como dependencia real (no solo de test)

**Files:**
- Modify: `monitor-app/backend/api/pyproject.toml`
- Modify: `monitor-app/backend/api/Dockerfile`

**Interfaces:**
- Produces: `httpx` disponible para código de producción (antes solo en `[project.optional-dependencies].dev`).

- [ ] **Step 1: Mover `httpx` a dependencias principales**

En `pyproject.toml`, agregar a `dependencies` (no solo dejar en `dev`):

```toml
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "asyncpg>=0.30",
    "pydantic>=2.7",
    "pydantic-settings>=2.3",
    "supabase==2.10.0",
    "upstash-redis>=1.1.0",
    "python-multipart>=0.0.9",
    "openpyxl>=3.1",
    "httpx>=0.27",
]
```

(Se puede dejar también en `dev` o quitar de ahí — con estar en `dependencies` alcanza; si se deja duplicado no rompe nada.)

- [ ] **Step 2: Agregar al Dockerfile**

```dockerfile
RUN pip install --no-cache-dir \
    "fastapi>=0.115" \
    "uvicorn[standard]>=0.30" \
    "asyncpg>=0.30" \
    "pydantic>=2.7" \
    "pydantic-settings>=2.3" \
    "supabase==2.10.0" \
    "upstash-redis>=1.1.0" \
    "python-multipart>=0.0.9" \
    "openpyxl>=3.1" \
    "httpx>=0.27"
```

- [ ] **Step 3: Verificar que ya está instalado en el venv de desarrollo (viene de `dev`)**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -c "import httpx; print(httpx.__version__)"`
Expected: imprime una versión (ya estaba instalado como dependencia de test)

- [ ] **Step 4: Commit**

```bash
git add monitor-app/backend/api/pyproject.toml monitor-app/backend/api/Dockerfile
git commit -m "chore(api): httpx como dependencia real, no solo de test — necesario para el cliente de Graph API"
```

---

### Task 2: Settings para credenciales de SharePoint/Graph API

**Files:**
- Modify: `monitor-app/backend/api/app/config.py`

**Interfaces:**
- Produces: `Settings.sharepoint_client_id`, `.sharepoint_client_secret`, `.sharepoint_tenant_id` (default `""`).

- [ ] **Step 1: Agregar los campos**

```python
class Settings(BaseSettings):
    database_url: str
    supabase_url: str
    supabase_service_role_key: str
    allowed_origins: list[str] = ["http://localhost:3000"]
    upstash_redis_rest_url: str = ""
    upstash_redis_rest_token: str = ""
    transporters_backend: str = "relational"
    # Graph API (SharePoint) — fetch automático del Excel EETT, ver
    # utils/sharepoint_client.py. Vacío en dev/test no rompe nada — solo
    # falla si efectivamente se intenta hacer el fetch sin credenciales.
    sharepoint_client_id: str = ""
    sharepoint_client_secret: str = ""
    sharepoint_tenant_id: str = ""

    class Config:
        env_file = ".env"
```

- [ ] **Step 2: Verificar que la app sigue arrancando**

Run: `python -c "from app.config import get_settings; print(get_settings().sharepoint_client_id)"`
Expected: imprime `` (vacío, sin error) — confirma que los defaults no rompen la carga de settings sin `.env` actualizado

- [ ] **Step 3: Commit**

```bash
git add monitor-app/backend/api/app/config.py
git commit -m "feat(api): settings para credenciales Graph API/SharePoint"
```

---

### Task 3: `sharepoint_client.py` — helper de fetch

**Files:**
- Create: `monitor-app/backend/api/app/utils/sharepoint_client.py`
- Test: `monitor-app/backend/api/tests/test_sharepoint_client.py`

**Interfaces:**
- Produces: `async fetch_sharepoint_file(site_path: str, file_path: str) -> bytes` — lanza `HTTPException(502, ...)` con mensaje claro si falla auth, resolución del sitio, o descarga. Consumido por Task 4.

- [ ] **Step 1: Escribir los tests que fallan**

```python
"""Tests de app/utils/sharepoint_client.py — httpx.AsyncClient mockeado,
sin llamadas de red reales."""
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import HTTPException

from app.utils.sharepoint_client import fetch_sharepoint_file


def _mock_response(json_data=None, content=None, status_code=200):
    resp = httpx.Response(
        status_code=status_code,
        json=json_data,
        content=content,
        request=httpx.Request("GET", "https://graph.microsoft.com/"),
    )
    return resp


@pytest.mark.asyncio
async def test_fetch_sharepoint_file_success():
    token_resp = _mock_response(json_data={"access_token": "fake-token"})
    site_resp = _mock_response(json_data={"id": "site-123"})
    download_resp = _mock_response(content=b"contenido del excel")

    with patch("app.utils.sharepoint_client.get_settings") as mock_settings:
        mock_settings.return_value.sharepoint_client_id = "cid"
        mock_settings.return_value.sharepoint_client_secret = "secret"
        mock_settings.return_value.sharepoint_tenant_id = "tid"

        with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=token_resp)), \
             patch("httpx.AsyncClient.get", new=AsyncMock(side_effect=[site_resp, download_resp])):
            result = await fetch_sharepoint_file("sites/webcarga.com", "General/archivo.xlsx")

    assert result == b"contenido del excel"


@pytest.mark.asyncio
async def test_fetch_sharepoint_file_auth_failure_raises_502():
    token_resp = _mock_response(json_data={"error": "invalid_client"}, status_code=401)

    with patch("app.utils.sharepoint_client.get_settings") as mock_settings:
        mock_settings.return_value.sharepoint_client_id = "cid"
        mock_settings.return_value.sharepoint_client_secret = "secret"
        mock_settings.return_value.sharepoint_tenant_id = "tid"

        with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=token_resp)):
            with pytest.raises(HTTPException) as exc:
                await fetch_sharepoint_file("sites/webcarga.com", "General/archivo.xlsx")

    assert exc.value.status_code == 502


@pytest.mark.asyncio
async def test_fetch_sharepoint_file_missing_credentials_raises_502():
    with patch("app.utils.sharepoint_client.get_settings") as mock_settings:
        mock_settings.return_value.sharepoint_client_id = ""
        mock_settings.return_value.sharepoint_client_secret = ""
        mock_settings.return_value.sharepoint_tenant_id = ""

        with pytest.raises(HTTPException) as exc:
            await fetch_sharepoint_file("sites/webcarga.com", "General/archivo.xlsx")

    assert exc.value.status_code == 502
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_sharepoint_client.py -v`
Expected: FAIL — el módulo `app.utils.sharepoint_client` no existe

- [ ] **Step 3: Implementar**

```python
"""Cliente de Graph API para traer el Excel EETT directo desde SharePoint —
reemplaza la descarga manual (subir un archivo local) por un fetch
automático del archivo canónico. Mismo app registration/flujo que usaba el
pipeline Mage congelado (ver monitor-app/docs/sharepoint_eett.py) — client
credentials (no requiere sesión de usuario), permisos Graph API ya
otorgados sobre el sitio.

Construido genérico (site_path/file_path como parámetros) para que
Checkpoint F (Seguros) lo pueda reusar sin reescribirlo.
"""
from __future__ import annotations

import httpx
from fastapi import HTTPException

from ..config import get_settings

GRAPH_BASE = "https://graph.microsoft.com/v1.0"


async def fetch_sharepoint_file(site_path: str, file_path: str) -> bytes:
    """`site_path`: ej. 'webcarga0.sharepoint.com:/sites/webcarga.com'.
    `file_path`: ruta del archivo dentro del drive del sitio, ej.
    'General/Documentos Reclutamiento EETT/01 -Status General de EETT/Estatus_Cumplimiento_Gobernanza_Dropdowns.xlsx'."""
    settings = get_settings()
    if not (settings.sharepoint_client_id and settings.sharepoint_client_secret and settings.sharepoint_tenant_id):
        raise HTTPException(502, "Credenciales de SharePoint no configuradas (SHAREPOINT_CLIENT_ID/SECRET/TENANT_ID)")

    async with httpx.AsyncClient(timeout=30) as client:
        token_res = await client.post(
            f"https://login.microsoftonline.com/{settings.sharepoint_tenant_id}/oauth2/v2.0/token",
            data={
                "client_id": settings.sharepoint_client_id,
                "client_secret": settings.sharepoint_client_secret,
                "scope": "https://graph.microsoft.com/.default",
                "grant_type": "client_credentials",
            },
        )
        token = token_res.json().get("access_token")
        if not token:
            raise HTTPException(502, f"Error autenticando contra Graph API: {token_res.text}")
        headers = {"Authorization": f"Bearer {token}"}

        site_res = await client.get(f"{GRAPH_BASE}/sites/{site_path}", headers=headers)
        site_id = site_res.json().get("id")
        if not site_id:
            raise HTTPException(502, f"No se pudo resolver el sitio de SharePoint '{site_path}': {site_res.text}")

        download_res = await client.get(
            f"{GRAPH_BASE}/sites/{site_id}/drive/root:/{file_path}:/content", headers=headers,
        )
        if download_res.status_code != 200:
            raise HTTPException(
                502, f"Error descargando '{file_path}' desde SharePoint: {download_res.status_code}",
            )
        return download_res.content
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `python -m pytest tests/test_sharepoint_client.py -v`
Expected: todos PASS

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/api/app/utils/sharepoint_client.py monitor-app/backend/api/tests/test_sharepoint_client.py
git commit -m "feat(api): sharepoint_client.py — fetch del Excel EETT vía Graph API"
```

---

### Task 4: `upload_and_preview` — `file` opcional, fetch desde SharePoint

**Files:**
- Modify: `monitor-app/backend/api/app/routers/centralizer_uploads.py`
- Test: `monitor-app/backend/api/tests/test_centralizer_uploads.py`

**Interfaces:**
- Consumes: `fetch_sharepoint_file` (Task 3).
- Produces: `POST /centralizer-uploads` sin `file` en el body dispara el fetch automático — mismo shape de respuesta que hoy.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `tests/test_centralizer_uploads.py` (cerca de `test_upload_and_preview_parses_and_returns_structured_diff`):

```python
def test_upload_without_file_fetches_from_sharepoint():
    pool = AsyncMock()
    pool.fetch.side_effect = [[], [], [], []]  # _load_extra_mappings, luego compute_diff x3
    pool.fetchval.return_value = UPLOAD_ID

    supabase = MagicMock()
    client = make_client(pool, supabase=supabase)

    with patch(
        "app.routers.centralizer_uploads.fetch_sharepoint_file",
        new=AsyncMock(return_value=_fixture_bytes()),
    ) as mock_fetch:
        res = client.post("/api/v1/centralizer-uploads")

    assert res.status_code == 200, res.text
    data = res.json()
    assert data["sheet_summary"] == {"Empresas": 2, "Conductores": 3, "Vehiculos_Equipos": 3}
    mock_fetch.assert_called_once()
    supabase.storage.from_.assert_called_with("compliance-docs")
```

(`patch` ya está importado en el archivo — usado por otros tests existentes.)

- [ ] **Step 2: Correr y verificar que falla**

Run: `python -m pytest tests/test_centralizer_uploads.py -k without_file -v`
Expected: FAIL — hoy `file` es requerido, un POST sin archivo devuelve 422 de FastAPI (validación del form)

- [ ] **Step 3: Implementar**

Agregar imports en `centralizer_uploads.py`:

```python
import io

from starlette.datastructures import Headers

from ..utils.sharepoint_client import fetch_sharepoint_file
```

Agregar constantes junto a `_SHEET_ENTITY_TYPE`:

```python
SHAREPOINT_EETT_SITE = "webcarga0.sharepoint.com:/sites/webcarga.com"
SHAREPOINT_EETT_PATH = (
    "General/Documentos Reclutamiento EETT/01 -Status General de EETT/"
    "Estatus_Cumplimiento_Gobernanza_Dropdowns.xlsx"
)
```

Modificar la firma y el inicio de `upload_and_preview`:

```python
@router.post("")
async def upload_and_preview(
    file: UploadFile = File(None),
    pool=Depends(get_pool), supabase=Depends(get_supabase), user=Depends(require_editor),
):
    if file is None:
        raw = await fetch_sharepoint_file(SHAREPOINT_EETT_SITE, SHAREPOINT_EETT_PATH)
        file = UploadFile(
            file=io.BytesIO(raw),
            filename="Estatus_Cumplimiento_Gobernanza_Dropdowns.xlsx",
            headers=Headers({"content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),
        )
    else:
        raw = await file.read()
        await file.seek(0)
    stored = await upload_document_version(supabase, key_prefix="centralizer-uploads", file=file)
```

(El resto de la función, desde `extra_mappings = await _load_extra_mappings(pool)` en adelante, no cambia.)

- [ ] **Step 4: Correr y verificar que pasa**

Run: `python -m pytest tests/test_centralizer_uploads.py -v`
Expected: todos PASS (incluye el test nuevo y todos los existentes — el camino con `file` provisto no cambia)

- [ ] **Step 5: Suite completa**

Run: `python -m pytest tests/ -q --deselect tests/test_centralizer_uploads_e2e.py`
Expected: todos PASS

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api/app/routers/centralizer_uploads.py monitor-app/backend/api/tests/test_centralizer_uploads.py
git commit -m "feat(api): POST /centralizer-uploads sin archivo trae el Excel EETT desde SharePoint"
```

---

### Task 5: Frontend — modal simplificado a un solo botón de fetch

**Files:**
- Modify: `monitor-app/frontend/lib/api/centralizerUploads.ts`
- Modify: `monitor-app/frontend/components/dashboard/CentralizerUploadModal.tsx`
- Modify: `monitor-app/frontend/components/dashboard/CentralizerUploadModal.test.tsx`

**Interfaces:**
- Produces: `centralizerUploadsApi.upload()` (sin argumento) — consumido por `CentralizerUploadModal`.

- [ ] **Step 1: Cambiar el API client**

En `lib/api/centralizerUploads.ts`, reemplazar el método `upload`:

```ts
  upload: () =>
    apiFetch<CentralizerUploadPreview>('/api/v1/centralizer-uploads', { method: 'POST' }),
```

- [ ] **Step 2: Reescribir el modal**

Reemplazar completamente `components/dashboard/CentralizerUploadModal.tsx`:

```tsx
'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { X, Cloud, Loader2, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { centralizerUploadsApi, type CentralizerUploadParsedResult } from '@/lib/api/centralizerUploads'
import { ApiError } from '@/lib/api/client'

interface Props {
  open:    boolean
  onClose: () => void
}

type Step = 'fetch' | 'summary'

export function CentralizerUploadModal({ open, onClose }: Props) {
  const router = useRouter()
  const [step, setStep]         = useState<Step>('fetch')
  const [fetching, setFetching] = useState(false)
  const [fetchErr, setFetchErr] = useState<string | null>(null)
  const [result, setResult]     = useState<CentralizerUploadParsedResult | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const reset = useCallback(() => {
    setStep('fetch'); setResult(null); setFetching(false); setFetchErr(null)
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

  async function handleFetch() {
    setFetchErr(null)
    setFetching(true)
    try {
      const res = await centralizerUploadsApi.upload()
      if ('status' in res) {
        // Sin diff todavía — un admin tiene que resolver las columnas
        // nuevas primero, eso vive en la página de detalle, no acá.
        router.push(`/dashboard/uploads/${res.upload_id}`)
        handleClose()
        return
      }
      setResult(res)
      setStep('summary')
    } catch (e) {
      const detail = e instanceof ApiError ? e.detail : null
      const message = detail && typeof detail === 'object' && 'message' in detail
        ? String((detail as { message: unknown }).message)
        : e instanceof Error ? e.message : 'Error al traer el archivo desde SharePoint'
      setFetchErr(message)
    } finally {
      setFetching(false)
    }
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
        aria-label="Traer Excel EETT desde SharePoint"
        tabIndex={-1}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] focus:outline-none animate-modal-in"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-bold text-base text-slate-800">Excel EETT desde SharePoint</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {step === 'fetch'   && 'Trae el archivo actual de Empresas/Conductores/Vehículos'}
              {step === 'summary' && 'Archivo procesado — revisa el resumen'}
            </p>
          </div>
          <button onClick={handleClose} aria-label="Cerrar" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-6">
          {step === 'fetch' && (
            <div className="space-y-4">
              <div className="border-2 border-dashed rounded-2xl p-10 text-center border-gray-200">
                {fetching
                  ? <Loader2 size={32} className="mx-auto mb-3 animate-spin text-accent" />
                  : <Cloud size={32} className="mx-auto mb-3 text-gray-300" />}
                <p className="text-sm font-semibold text-gray-600">
                  {fetching ? 'Trayendo archivo y calculando diff...' : 'Excel EETT en SharePoint'}
                </p>
                {!fetching && <p className="text-xs text-gray-400 mt-1">Empresas / Conductores / Vehiculos_Equipos</p>}
              </div>

              {fetchErr && (
                <p className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <XCircle size={13} className="shrink-0 mt-0.5" />
                  {fetchErr}
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
          {step === 'fetch' && (
            <>
              <button onClick={handleClose} className="px-4 py-2 text-sm text-gray-500 border border-border rounded-lg hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
              <button
                onClick={handleFetch}
                disabled={fetching}
                className="flex-1 flex items-center justify-center gap-2 bg-accent text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-40 transition-colors"
              >
                {fetching ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />}
                Traer archivo actual
              </button>
            </>
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

- [ ] **Step 3: Reescribir los tests del modal**

Reemplazar completamente `components/dashboard/CentralizerUploadModal.test.tsx`:

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

beforeEach(() => {
  vi.mocked(centralizerUploadsApi.upload).mockReset()
  pushMock.mockReset()
})

describe('CentralizerUploadModal', () => {
  it('shows sheet summary and parse error count after a successful fetch', async () => {
    vi.mocked(centralizerUploadsApi.upload).mockResolvedValue({
      upload_id: 'aaaaaaaa-0000-0000-0000-000000000001',
      sheet_summary: { Empresas: 2, Conductores: 3, Vehiculos_Equipos: 3 },
      parse_errors: [{ sheet: 'Conductores', row: 5, reason: 'RUT vacío' }],
      diff: { transporters: [], drivers: [], vehicles: [], parse_errors: [] },
    })
    render(<CentralizerUploadModal open onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Traer archivo actual'))
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
    fireEvent.click(screen.getByText('Traer archivo actual'))
    await waitFor(() => expect(screen.getByText('Ver diff completo')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Ver diff completo'))
    expect(pushMock).toHaveBeenCalledWith('/dashboard/uploads/aaaaaaaa-0000-0000-0000-000000000001')
    expect(onClose).toHaveBeenCalled()
  })

  it('navigates straight to the detail page when the upload needs column mapping', async () => {
    const onClose = vi.fn()
    vi.mocked(centralizerUploadsApi.upload).mockResolvedValue({
      upload_id: 'bbbbbbbb-0000-0000-0000-000000000002',
      status: 'pending_mapping',
      unresolved_columns: [{ sheet: 'Empresas', header: 'Cuenta Banco Empresa' }],
    })
    render(<CentralizerUploadModal open onClose={onClose} />)
    fireEvent.click(screen.getByText('Traer archivo actual'))
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard/uploads/bbbbbbbb-0000-0000-0000-000000000002'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows an error if the SharePoint fetch fails', async () => {
    vi.mocked(centralizerUploadsApi.upload).mockRejectedValue(new Error('Error descargando desde SharePoint'))
    render(<CentralizerUploadModal open onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Traer archivo actual'))
    await waitFor(() => expect(screen.getByText(/Error descargando desde SharePoint/)).toBeInTheDocument())
  })
})
```

- [ ] **Step 4: Correr tests y verificar que pasan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/CentralizerUploadModal.test.tsx`
Expected: todos PASS (4 tests)

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/lib/api/centralizerUploads.ts monitor-app/frontend/components/dashboard/CentralizerUploadModal.tsx monitor-app/frontend/components/dashboard/CentralizerUploadModal.test.tsx
git commit -m "feat(frontend): CentralizerUploadModal trae el archivo directo desde SharePoint, sin subida local"
```

---

### Task 6: Verificación completa + AGENTLOG

- [ ] **Step 1: Backend completo**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/ -q --deselect tests/test_centralizer_uploads_e2e.py`
Expected: todos PASS

- [ ] **Step 2: Frontend completo**

Run: `cd monitor-app/frontend && npx tsc --noEmit && npx vitest run && npm run build`
Expected: sin errores de tipo, todos los tests PASS, build exitoso

- [ ] **Step 3: Recordatorio de pasos manuales (no ejecutables por mí)**

Reportar al usuario, no ejecutar:
1. Cargar `SHAREPOINT_CLIENT_ID`/`SHAREPOINT_CLIENT_SECRET`/`SHAREPOINT_TENANT_ID` a GCP Secret Manager (mismos valores que ya usa el pipeline Mage, ver `monitor-app/docs/sharepoint_eett.py`) y wirearlos al servicio Cloud Run del backend, mismo patrón que los secrets de Upstash.
2. Recomendado (no bloqueante): rotar el secret en Azure AD dado que estuvo expuesto en texto plano.
3. Sin esas variables seteadas, el endpoint devuelve 502 "Credenciales de SharePoint no configuradas" — comportamiento esperado, no un bug.

- [ ] **Step 4: Actualizar AGENTLOG.md**

Agregar sección describiendo el fetch automático, decisiones del brainstorm (solo automatiza fetch no aprobación, reemplaza upload local, credenciales del pipeline viejo reusadas), y los pasos manuales pendientes de Secret Manager.

## Self-Review Notes

- **Spec coverage**: fetch automático (Task 3-4), reemplazo completo del upload local en el modal (Task 5), reuso de credenciales vía Secret Manager (Task 2 + nota manual en Task 6), helper genérico reusable por Checkpoint F (Task 3 toma site_path/file_path como parámetros, no hardcodea el archivo de Empresas dentro del propio helper).
- **Dependencia nueva (`httpx`) con Dockerfile actualizado en el mismo commit** — Task 1, siguiendo la lección ya aprendida 2 veces antes.
- **Type consistency**: `CentralizerUploadParsedResult`/`CentralizerUploadPendingMappingResult` (ya existentes desde la sesión anterior) se siguen usando igual — `centralizerUploadsApi.upload()` solo pierde el parámetro `file`, no cambia su tipo de retorno.
- **No placeholders**: cada step tiene código completo y ejecutable.
