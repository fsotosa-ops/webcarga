# Certificación: bandeja de trabajo + módulo unificado

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar los dos modales apilados de la clasificación por una bandeja de trabajo con selección múltiple, montada en su lugar definitivo (`/dashboard/compliance`), y devolverle a la ficha de empresa la capacidad de cargar documentos.

**Architecture:** La bandeja es una pantalla de tres paneles sin modales — lista con casillas a la izquierda, vista previa al centro, formulario de clasificación a la derecha — donde el formulario aplica a **todo lo seleccionado**: con un archivo marcado clasifica ese, con quince aplica a los quince. El backend suma dos capacidades: clasificación en lote y mover archivos sin clasificar entre empresas. La ficha de empresa se descompone antes de recibir la carga, porque con 971 líneas no aguanta más superficie.

**Tech Stack:** Next.js 14 App Router, React Query, Tailwind, lucide-react (frontend); FastAPI + asyncpg (backend); vitest + pytest.

**Spec:**
- `monitor-app/docs/user-stories/20260814/01-hu-carga-y-clasificacion-por-empresa.md` (§ Diseño de interfaz)
- `monitor-app/docs/user-stories/20260814/04-hu-modulo-unificado.md`
- `monitor-app/docs/user-stories/20260814/03-hu-reasignar-documento.md` (§ cuarta variante)
- Épica: `monitor-app/docs/user-stories/20260814/00-epica-certificacion-unificada.md`
- Mockups: artifact "Clasificar 2.000 documentos"

## Global Constraints

- **Rama**: trabajar en `dev`. No commitear a `main`.
- **venv del backend**: `monitor-app/backend/api/venv` — NO `.venv` ni anaconda.
- **Nomenclatura decidida**: el módulo se llama **Certificación**; la ruta es **`/dashboard/compliance`**. Etiqueta en español, ruta en inglés.
- **`/dashboard/certification?carrier_id=…` es un contrato en uso desde la Ronda 88** — lo emiten los links de salida de la ficha de empresa, del panel de conductor y del de vehículo. Necesita redirección permanente que **preserve el query string**.
- **Sin emojis**: sólo `lucide-react`.
- **Reglas de `ui-ux-pro-max` que este plan implementa**: *Bulk Actions* (selección múltiple, no acciones por fila), *Keyboard Navigation* (severidad alta), *Loading States* (skeleton o spinner sobre 300 ms), *Empty States* (mensaje útil, nunca pantalla en blanco).
- **`trg_refresh_view_on_compliance`** hace `REFRESH MATERIALIZED VIEW CONCURRENTLY` **por statement**: una clasificación de N documentos NO puede ser un bucle de N statements.
- **Bug de draft sin resincronizar** (visto 4 veces en este frontend): todo control que entra en modo edición resetea su estado desde el prop.
- **Verificar SQL nuevo contra la base real** vía MCP de Supabase antes de confiar en tests con `AsyncMock`.
- **Click-through sobre producción**: elegir con una consulta una empresa **sin documentos cargados** antes de probar. Ya se pisó un documento real por elegir a ojo del desplegable.

---

## File Structure

**Backend** (`monitor-app/backend/api/`)

| Archivo | Responsabilidad |
|---|---|
| `app/routers/document_ingest.py` | MODIFICAR: `POST /items/classify-batch` y `POST /items/move` |
| `app/schemas/document_ingest.py` | MODIFICAR: `ClassifyBatchBody`, `MoveItemsBody` |
| `tests/test_document_ingest.py` | MODIFICAR |

**Migración**

| Archivo | Responsabilidad |
|---|---|
| `migrations/20260815100000_ingest_items_carrier_override.sql` | CREAR: `carrier_id` propio en `document_ingest_items` |

**Frontend** (`monitor-app/frontend/`)

| Archivo | Responsabilidad |
|---|---|
| `app/dashboard/compliance/page.tsx` | CREAR (git mv desde `certification/`): la bandeja |
| `app/dashboard/certification/page.tsx` | REEMPLAZAR por un `redirect()` |
| `components/compliance/TriageWorkbench.tsx` | CREAR: los tres paneles |
| `components/compliance/TriageFileList.tsx` | CREAR: lista con casillas y teclado |
| `components/compliance/TriagePreview.tsx` | CREAR: vista previa o resumen de selección |
| `components/compliance/TriageClassifyForm.tsx` | CREAR: formulario que aplica a N |
| `components/dashboard/carriers/CarrierDocumentsTab.tsx` | CREAR: tab extraído de la ficha |
| `app/dashboard/carriers/[id]/page.tsx` | MODIFICAR: descomponer y devolver la carga |
| `lib/api/documentIngest.ts` | MODIFICAR: `classifyBatch`, `moveItems` |

**Skills**

| Archivo | Responsabilidad |
|---|---|
| `.claude/skills/mockups/SKILL.md` | MODIFICAR: adaptar de suma-scout a webcarga |
| `.claude/skills/qa-testing/SKILL.md` | MODIFICAR: idem |

---

## Task 1: Ruta nueva con redirección de la vieja

Cambio mecánico y sin lógica nueva, pero va primero: define dónde vive todo lo demás.

**Files:**
- Move: `app/dashboard/certification/` → `app/dashboard/compliance/`
- Create: `app/dashboard/certification/page.tsx` (sólo redirect)
- Modify: `components/dashboard/Sidebar.tsx`, `TransporterDocumentsPanel.tsx`, `DriverDetailPanel.tsx`, `VehicleDetailPanel.tsx` y sus 3 tests

**Interfaces:**
- Produces: la ruta `/dashboard/compliance`; `/dashboard/certification` redirige preservando el query string.

- [ ] **Step 1: Escribir el test de la redirección**

Crear `app/dashboard/certification/page.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

const redirectMock = vi.fn()
vi.mock('next/navigation', () => ({ redirect: (u: string) => redirectMock(u) }))

import CertificationRedirect from './page'

describe('redirección de la ruta vieja', () => {
  it('preserva el carrier_id al redirigir', () => {
    render(<CertificationRedirect searchParams={{ carrier_id: 'c1' }} />)
    expect(redirectMock).toHaveBeenCalledWith('/dashboard/compliance?carrier_id=c1')
  })

  it('redirige sin query cuando no hay parámetros', () => {
    redirectMock.mockClear()
    render(<CertificationRedirect searchParams={{}} />)
    expect(redirectMock).toHaveBeenCalledWith('/dashboard/compliance')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
cd monitor-app/frontend && npx vitest run app/dashboard/certification/page.test.tsx
```

Esperado: FAIL — el `page.tsx` actual es la pantalla completa, no un redirect.

- [ ] **Step 3: Mover el directorio y crear el redirect**

```bash
cd monitor-app/frontend
git mv app/dashboard/certification app/dashboard/compliance
mkdir -p app/dashboard/certification
```

`app/dashboard/certification/page.tsx`:

```tsx
import { redirect } from 'next/navigation'

/** Ruta anterior del módulo Certificación.
 *
 *  Se conserva como redirección permanente: `?carrier_id=` es un contrato en
 *  uso desde la Ronda 88 — lo emiten los links de salida de la ficha de
 *  empresa, del panel de conductor y del de vehículo, y puede estar guardado
 *  en marcadores del equipo. */
export default function CertificationRedirect({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(searchParams ?? {})) {
    if (typeof v === 'string') qs.set(k, v)
  }
  const suffix = qs.toString() ? `?${qs}` : ''
  redirect(`/dashboard/compliance${suffix}`)
}
```

En `components/dashboard/Sidebar.tsx`, cambiar el `href` del ítem (la etiqueta "Certificación" **no cambia**):

```tsx
  { href: '/dashboard/compliance',  label: 'Certificación', icon: BadgeCheck },
```

En `TransporterDocumentsPanel.tsx`, `DriverDetailPanel.tsx` y `VehicleDetailPanel.tsx`, reemplazar en el link de salida:

```
/dashboard/certification?carrier_id=${carrierId}
→ /dashboard/compliance?carrier_id=${carrierId}
```

Y la misma cadena en sus tres archivos `.test.tsx`.

- [ ] **Step 4: Verificar**

```bash
cd monitor-app/frontend && npx vitest run && npx tsc --noEmit && npm run build
```

Esperado: todo verde, y `/dashboard/compliance` presente en el manifest del build.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend
git commit -m "refactor(compliance): mueve el modulo a /dashboard/compliance

La etiqueta sigue siendo Certificacion; la ruta pasa a ingles, coherente con
el dominio real (compliance_records / compliance_requirements).

La ruta vieja queda como redireccion permanente preservando el query string:
?carrier_id= es un contrato en uso desde la Ronda 88.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: El archivo puede pertenecer a otra empresa que su lote

Resuelve la cuarta variante de "mover" de la HU-03: soltar 40 archivos en la empresa equivocada.

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260815100000_ingest_items_carrier_override.sql`

**Interfaces:**
- Produces: `document_ingest_items.carrier_id` (nullable). NULL = hereda del lote.

- [ ] **Step 1: Escribir la migración**

```sql
-- Un archivo de la bandeja puede terminar perteneciendo a otra empresa que la
-- del lote en que se subió: es el error más probable del uso real — soltar
-- cuarenta archivos en la empresa equivocada y darse cuenta al verlos.
--
-- NULL significa "hereda la del lote", que es el caso normal. Sólo se escribe
-- cuando alguien mueve el archivo.
ALTER TABLE public.document_ingest_items
    ADD COLUMN carrier_id UUID REFERENCES public.carriers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.document_ingest_items.carrier_id IS
    'Empresa del archivo cuando difiere de la del lote. NULL = hereda de document_ingest_batches.carrier_id.';

CREATE INDEX idx_ingest_items_carrier ON public.document_ingest_items (carrier_id)
    WHERE carrier_id IS NOT NULL;
```

- [ ] **Step 2: Verificar la sintaxis contra la base sin dejarla aplicada**

Con el MCP de Supabase (`viclzoftiudkepqnhekv`):

```sql
BEGIN;
ALTER TABLE public.document_ingest_items
    ADD COLUMN carrier_id UUID REFERENCES public.carriers(id) ON DELETE SET NULL;
CREATE INDEX idx_ingest_items_carrier ON public.document_ingest_items (carrier_id)
    WHERE carrier_id IS NOT NULL;
SELECT 'ok' AS resultado;
ROLLBACK;
```

Esperado: `ok`, sin errores. Después confirmar que **no** quedó aplicada:

```sql
SELECT count(*) FROM information_schema.columns
WHERE table_schema='public' AND table_name='document_ingest_items' AND column_name='carrier_id';
```

Esperado: `0`.

- [ ] **Step 3: Aplicar la migración**

Aplicarla con `apply_migration` (nombre: `ingest_items_carrier_override`). Es aditiva y no toca datos: la tabla está vacía en producción.

- [ ] **Step 4: Verificar el resultado**

```sql
SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_schema='public' AND table_name='document_ingest_items' AND column_name='carrier_id';
```

Esperado: una fila, `is_nullable = YES`.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260815100000_ingest_items_carrier_override.sql
git commit -m "feat(ingesta): el archivo puede pertenecer a otra empresa que su lote

Cubre la cuarta variante de mover documentos (HU-03): soltar archivos en la
empresa equivocada y darse cuenta al verlos. NULL = hereda del lote.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Clasificar en lote y mover en lote

**Files:**
- Modify: `app/routers/document_ingest.py`, `app/schemas/document_ingest.py`
- Test: `tests/test_document_ingest.py`

**Interfaces:**
- Consumes: `_apply_stored_document(conn, record_id, *, storage_path, file_name, mime_type, size_bytes, expiration_date, actor, entity_type, entity_id, old_status)` de `app/routers/compliance.py`.
- Produces:
  - `POST /api/v1/document-ingest/items/classify-batch` body `{item_ids: [str], entity_type, entity_id, requirement_id, expiration_date?}` → `{applied: [str], errors: [{item_id, error}]}`
  - `POST /api/v1/document-ingest/items/move` body `{item_ids: [str], carrier_id: str}` → `{moved: int}`

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `tests/test_document_ingest.py`:

```python
def test_classify_batch_applies_to_every_selected_item():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetch.return_value = [
        {"id": "i1", "storage_path": "s/1.png", "file_name": "1.png",
         "mime_type": "image/png", "size_bytes": 9, "match_status": "UNMATCHED"},
        {"id": "i2", "storage_path": "s/2.png", "file_name": "2.png",
         "mime_type": "image/png", "size_bytes": 9, "match_status": "UNMATCHED"},
    ]
    conn.fetchrow.side_effect = [
        _record_row(),                                  # el compliance_record destino
        {"metadata": {}, "expiration_date": None},      # estado previo, item 1
        {"metadata": {}, "expiration_date": None},      # estado previo, item 2
    ]
    conn.fetchval.return_value = False
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/classify-batch",
        json={"item_ids": ["i1", "i2"], "entity_type": "ASSET",
              "entity_id": "a1", "requirement_id": "req-1"},
    )

    assert res.status_code == 200
    assert res.json()["applied"] == ["i1", "i2"]


def test_classify_batch_rejects_an_empty_selection():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/classify-batch",
        json={"item_ids": [], "entity_type": "ASSET",
              "entity_id": "a1", "requirement_id": "req-1"},
    )

    assert res.status_code == 422


def test_classify_batch_404_when_the_entity_lacks_that_requirement():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetch.return_value = [
        {"id": "i1", "storage_path": "s/1.png", "file_name": "1.png",
         "mime_type": "image/png", "size_bytes": 9, "match_status": "UNMATCHED"},
    ]
    conn.fetchrow.return_value = None
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/classify-batch",
        json={"item_ids": ["i1"], "entity_type": "ASSET",
              "entity_id": "a1", "requirement_id": "no-existe"},
    )

    assert res.status_code == 404


def test_move_items_reassigns_the_carrier_in_one_statement():
    """Un solo UPDATE, no un bucle: mover 40 archivos son 40 refreshes si no."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.execute.return_value = "UPDATE 3"
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/move",
        json={"item_ids": ["i1", "i2", "i3"], "carrier_id": "c2"},
    )

    assert res.status_code == 200
    assert res.json()["moved"] == 3
    assert conn.execute.call_count == 1
    assert "carrier_id" in conn.execute.call_args.args[0]


def test_move_items_rejects_an_empty_selection():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.post("/api/v1/document-ingest/items/move",
                      json={"item_ids": [], "carrier_id": "c2"})

    assert res.status_code == 422
```

- [ ] **Step 2: Correr y verificar que fallan**

```bash
cd monitor-app/backend/api && venv/bin/pytest tests/test_document_ingest.py -v
```

Esperado: los 5 nuevos en FAIL con 404 (las rutas no existen).

- [ ] **Step 3: Implementar**

En `app/schemas/document_ingest.py`:

```python
class ClassifyBatchBody(BaseModel):
    item_ids: list[str]
    entity_type: EntityType
    entity_id: str
    requirement_id: str
    expiration_date: Optional[date] = None


class MoveItemsBody(BaseModel):
    item_ids: list[str]
    carrier_id: str
```

En `app/routers/document_ingest.py`:

```python
@router.post("/items/classify-batch")
async def classify_batch(
    body: ClassifyBatchBody,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    """Aplica el mismo requisito a N archivos de la bandeja.

    Es la operación que hace que clasificar 2.000 documentos sea viable: con un
    archivo seleccionado equivale a clasificar de a uno, con quince aplica a los
    quince sin que la persona repita la elección.
    """
    if not body.item_ids:
        raise HTTPException(422, "Se requiere al menos un documento")

    applied: list[str] = []
    errors: list[dict] = []

    async with pool.acquire() as conn:
        async with conn.transaction():
            items = await conn.fetch(
                "SELECT id::text, storage_path, file_name, mime_type, size_bytes, match_status "
                "FROM public.document_ingest_items WHERE id = ANY($1::uuid[])",
                body.item_ids,
            )
            if not items:
                raise HTTPException(404, "Ningún documento encontrado en la bandeja")

            record = await conn.fetchrow(
                """
                SELECT id::text, entity_id::text, entity_type, status, expiration_date
                FROM public.compliance_records
                WHERE entity_id = $1 AND requirement_id = $2 AND is_current = true
                """,
                body.entity_id, body.requirement_id,
            )
            if not record:
                raise HTTPException(
                    404,
                    "Esa entidad no tiene ese requisito. Verificá la categoría y el tipo de documento.",
                )

            if body.expiration_date is None:
                needs_date = await conn.fetchval(
                    "SELECT COALESCE(has_expiration, false) "
                    "FROM public.compliance_requirements WHERE id = $1",
                    body.requirement_id,
                )
                if needs_date:
                    raise HTTPException(422, "Este documento requiere fecha de vencimiento")

            for item in items:
                if item["match_status"] == "DISCARDED":
                    errors.append({"item_id": item["id"], "error": "Fue eliminado de la bandeja"})
                    continue
                await _apply_stored_document(
                    conn, record["id"],
                    storage_path=item["storage_path"], file_name=item["file_name"],
                    mime_type=item["mime_type"], size_bytes=item["size_bytes"],
                    expiration_date=body.expiration_date, actor=user["sub"],
                    entity_type=record["entity_type"], entity_id=record["entity_id"],
                    old_status=record["status"],
                )
                applied.append(item["id"])

            if applied:
                await conn.execute(
                    """
                    UPDATE public.document_ingest_items SET
                        match_status = 'COMMITTED',
                        entity_type = $2, entity_id = $3, requirement_id = $4,
                        compliance_record_id = $5, expiration_date = $6, updated_at = NOW()
                    WHERE id = ANY($1::uuid[])
                    """,
                    applied, body.entity_type, body.entity_id, body.requirement_id,
                    record["id"], body.expiration_date,
                )

    return {"applied": applied, "errors": errors}


@router.post("/items/move")
async def move_items(
    body: MoveItemsBody,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    """Reasigna archivos sin clasificar a otra empresa.

    Un solo UPDATE a propósito: mover cuarenta archivos en un bucle serían
    cuarenta statements.
    """
    if not body.item_ids:
        raise HTTPException(422, "Se requiere al menos un documento")

    async with pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE public.document_ingest_items SET carrier_id = $2, updated_at = NOW() "
            "WHERE id = ANY($1::uuid[])",
            body.item_ids, body.carrier_id,
        )
    return {"moved": int(str(result).rsplit(" ", 1)[-1])}
```

Agregar al import de schemas: `ClassifyBatchBody, MoveItemsBody`.

**Importante**: el `GET /{carrier_id}/items` de la Task anterior debe pasar a respetar el override. Cambiar su `WHERE`:

```sql
WHERE COALESCE(i.carrier_id, b.carrier_id) = $1 AND i.match_status = 'UNMATCHED'
```

- [ ] **Step 4: Verificar**

```bash
cd monitor-app/backend/api && venv/bin/pytest tests/ -v
```

Esperado: toda la suite verde (524 previos + 5 nuevos).

- [ ] **Step 5: Verificar el SQL del listado contra la base real**

```sql
SELECT i.id::text, i.file_name
FROM public.document_ingest_items i
JOIN public.document_ingest_batches b ON b.id = i.batch_id
WHERE COALESCE(i.carrier_id, b.carrier_id) = '00000000-0000-0000-0000-000000000000'
  AND i.match_status = 'UNMATCHED';
```

Esperado: 0 filas y **sin error de sintaxis** — es lo que se está comprobando.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api
git commit -m "feat(ingesta): clasificacion y movimiento en lote

classify-batch aplica el mismo requisito a N archivos; move reasigna N
archivos a otra empresa en un solo UPDATE (un bucle serian N refreshes de
la vista materializada).

El listado de la bandeja pasa a respetar el override de empresa.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Cliente HTTP de las operaciones en lote

**Files:**
- Modify: `monitor-app/frontend/lib/api/documentIngest.ts`

**Interfaces:**
- Produces:
```ts
documentIngestApi.classifyBatch(body: ClassifyBatchBody): Promise<{ applied: string[]; errors: {item_id: string; error: string}[] }>
documentIngestApi.moveItems(itemIds: string[], carrierId: string): Promise<{ moved: number }>
```

- [ ] **Step 1: Escribir el cliente**

Agregar a `lib/api/documentIngest.ts`:

```ts
export type ClassifyBatchBody = {
  item_ids:         string[]
  entity_type:      'CARRIER' | 'DRIVER' | 'ASSET'
  entity_id:        string
  requirement_id:   string
  expiration_date?: string
}

export type ClassifyBatchResult = {
  applied: string[]
  errors:  { item_id: string; error: string }[]
}
```

y al objeto `documentIngestApi`:

```ts
  classifyBatch: (body: ClassifyBatchBody) =>
    apiFetch<ClassifyBatchResult>('/api/v1/document-ingest/items/classify-batch', {
      method: 'POST', body: JSON.stringify(body),
    }),

  moveItems: (itemIds: string[], carrierId: string) =>
    apiFetch<{ moved: number }>('/api/v1/document-ingest/items/move', {
      method: 'POST', body: JSON.stringify({ item_ids: itemIds, carrier_id: carrierId }),
    }),
```

- [ ] **Step 2: Verificar tipos**

```bash
cd monitor-app/frontend && npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Step 3: Commit**

```bash
git add monitor-app/frontend/lib/api/documentIngest.ts
git commit -m "feat(compliance): cliente de clasificacion y movimiento en lote

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Lista de archivos con casillas y teclado

> **HECHA, y luego SUPERADA por la revisión del 2026-08-14.** `TriageFileList`
> se retira en la Task 14, que la reemplaza por `TriageFileTable` (tabla con
> columnas y selección por rango). Se deja acá como registro de lo construido.

El panel izquierdo de la bandeja. Se construye aislado porque concentra toda la interacción de teclado.

**Files:**
- Create: `components/compliance/TriageFileList.tsx`
- Create: `components/compliance/TriageFileList.test.tsx`

**Interfaces:**
- Produces:
```ts
export function TriageFileList(props: {
  items:      TrayItem[]
  focusedId:  string | null
  selectedIds: Set<string>
  onFocus:    (id: string) => void
  onToggle:   (id: string) => void
  onToggleAll: () => void
  onDiscard:  (id: string) => void
}): JSX.Element
```

- [ ] **Step 1: Escribir el test que falla**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TriageFileList } from './TriageFileList'

const ITEMS = [
  { id: 'i1', file_name: 'IMG_9001.png', mime_type: 'image/png', size_bytes: 10,
    storage_path: 's/1', match_status: 'UNMATCHED' as const, preview_url: 'https://x/1' },
  { id: 'i2', file_name: 'IMG_9002.png', mime_type: 'image/png', size_bytes: 10,
    storage_path: 's/2', match_status: 'UNMATCHED' as const, preview_url: 'https://x/2' },
]

function setup(over: Record<string, unknown> = {}) {
  const props = {
    items: ITEMS, focusedId: 'i1', selectedIds: new Set<string>(),
    onFocus: vi.fn(), onToggle: vi.fn(), onToggleAll: vi.fn(), onDiscard: vi.fn(),
    ...over,
  }
  render(<TriageFileList {...(props as never)} />)
  return props
}

describe('TriageFileList', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lista los archivos con su casilla', () => {
    setup()
    expect(screen.getByText('IMG_9001.png')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(3) // 2 filas + "todos"
  })

  it('marca un archivo al hacer clic en su casilla', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('checkbox', { name: /IMG_9001/i }))
    expect(p.onToggle).toHaveBeenCalledWith('i1')
  })

  it('marca todos de una vez', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('checkbox', { name: /todos/i }))
    expect(p.onToggleAll).toHaveBeenCalled()
  })

  it('mueve el foco con las flechas', () => {
    const p = setup()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
    expect(p.onFocus).toHaveBeenCalledWith('i2')
  })

  it('marca con la barra espaciadora', () => {
    const p = setup()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: ' ' })
    expect(p.onToggle).toHaveBeenCalledWith('i1')
  })

  it('descarta con Delete', () => {
    const p = setup()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Delete' })
    expect(p.onDiscard).toHaveBeenCalledWith('i1')
  })

  it('avisa cuando no queda nada por clasificar', () => {
    setup({ items: [] })
    expect(screen.getByText(/no hay documentos sin clasificar/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/TriageFileList.test.tsx
```

Esperado: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

```tsx
'use client'

import { FileQuestion, Trash2 } from 'lucide-react'
import type { TrayItem } from '@/lib/types'

interface Props {
  items:       TrayItem[]
  focusedId:   string | null
  selectedIds: Set<string>
  onFocus:     (id: string) => void
  onToggle:    (id: string) => void
  onToggleAll: () => void
  onDiscard:   (id: string) => void
}

/** Panel izquierdo de la bandeja: los archivos que esperan clasificación.
 *
 *  Concentra toda la interacción de teclado — flechas para moverse, espacio
 *  para marcar, Delete para descartar — porque vaciar una bandeja de dos mil
 *  documentos con el mouse no es viable. */
export function TriageFileList({
  items, focusedId, selectedIds, onFocus, onToggle, onToggleAll, onDiscard,
}: Props) {
  function handleKey(e: React.KeyboardEvent) {
    if (!items.length) return
    const i = items.findIndex(it => it.id === focusedId)
    const cur = i < 0 ? 0 : i

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      onFocus(items[Math.min(cur + 1, items.length - 1)].id)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      onFocus(items[Math.max(cur - 1, 0)].id)
    } else if (e.key === ' ') {
      e.preventDefault()
      onToggle(items[cur].id)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onDiscard(items[cur].id)
    }
  }

  if (!items.length) {
    return (
      <div className="p-4 text-center">
        <FileQuestion size={20} className="mx-auto text-gray-300 mb-2" />
        <p className="text-xs text-gray-400">No hay documentos sin clasificar</p>
        <p className="text-[11px] text-gray-400 mt-1">
          Arrastrá archivos para empezar.
        </p>
      </div>
    )
  }

  const allSelected = items.every(it => selectedIds.has(it.id))

  return (
    <div
      role="listbox"
      tabIndex={0}
      aria-label="Documentos sin clasificar"
      onKeyDown={handleKey}
      className="focus:outline-none focus:ring-2 focus:ring-accent/40 rounded-lg"
    >
      <label className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-semibold text-gray-500 border-b border-border">
        <input
          type="checkbox"
          aria-label="Seleccionar todos"
          checked={allSelected}
          onChange={onToggleAll}
        />
        Todos ({items.length})
      </label>

      {items.map(item => {
        const focused = item.id === focusedId
        const checked = selectedIds.has(item.id)
        return (
          <div
            key={item.id}
            role="option"
            aria-selected={checked}
            onClick={() => onFocus(item.id)}
            className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors ${
              focused ? 'bg-accent/10' : 'hover:bg-gray-50'
            }`}
          >
            <input
              type="checkbox"
              aria-label={`Seleccionar ${item.file_name}`}
              checked={checked}
              onChange={() => onToggle(item.id)}
              onClick={e => e.stopPropagation()}
            />
            <span className="text-[11px] truncate flex-1 font-mono">{item.file_name}</span>
            <button
              type="button"
              aria-label={`Descartar ${item.file_name}`}
              onClick={e => { e.stopPropagation(); onDiscard(item.id) }}
              className="p-0.5 text-gray-400 hover:text-red-500 transition-colors"
            >
              <Trash2 size={11} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Verificar**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/TriageFileList.test.tsx
```

Esperado: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/compliance/
git commit -m "feat(compliance): lista de la bandeja con casillas y teclado

Flechas para moverse, espacio para marcar, Delete para descartar. Vaciar dos
mil documentos con el mouse no es viable, y ui-ux-pro-max marca Keyboard
Navigation con severidad alta.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Vista previa y formulario que aplica a la selección

**Files:**
- Create: `components/compliance/TriagePreview.tsx`, `TriagePreview.test.tsx`
- Create: `components/compliance/TriageClassifyForm.tsx`, `TriageClassifyForm.test.tsx`

**Interfaces:**
- Consumes: `complianceApi.listRequirements`, `documentIngestApi.classifyBatch`.
- Produces:
```ts
export function TriagePreview(props: { items: TrayItem[] }): JSX.Element
export function TriageClassifyForm(props: {
  targetIds: string[]
  subjects: { entity_type: 'CARRIER'|'DRIVER'|'ASSET'; entity_id: string; label: string }[]
  onApplied: (appliedIds: string[]) => void
}): JSX.Element
```

- [ ] **Step 1: Escribir los tests que fallan**

`TriagePreview.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { TriagePreview } from './TriagePreview'

const mk = (id: string, mime = 'image/png') => ({
  id, file_name: `${id}.png`, mime_type: mime, size_bytes: 10,
  storage_path: `s/${id}`, match_status: 'UNMATCHED' as const,
  preview_url: `https://x/${id}`,
})

describe('TriagePreview', () => {
  it('muestra la imagen cuando hay un solo archivo', () => {
    render(<TriagePreview items={[mk('i1')]} />)
    expect(screen.getByRole('img', { name: /i1/ })).toHaveAttribute('src', 'https://x/i1')
  })

  it('resume la selección cuando hay varios', () => {
    render(<TriagePreview items={[mk('i1'), mk('i2'), mk('i3')]} />)
    expect(screen.getByText(/3 documentos seleccionados/i)).toBeInTheDocument()
  })

  it('usa un visor embebido para lo que no es imagen', () => {
    render(<TriagePreview items={[mk('i1', 'application/pdf')]} />)
    expect(screen.getByTitle('i1.png')).toBeInTheDocument()
  })

  it('invita a elegir algo cuando no hay nada', () => {
    render(<TriagePreview items={[]} />)
    expect(screen.getByText(/elegí un documento/i)).toBeInTheDocument()
  })
})
```

`TriageClassifyForm.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TriageClassifyForm } from './TriageClassifyForm'

vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: { classifyBatch: vi.fn() },
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listRequirements: vi.fn() },
}))
import { documentIngestApi } from '@/lib/api/documentIngest'
import { complianceApi } from '@/lib/api/compliance'

const REQ = {
  id: 'req-1', target_entity: 'ASSET' as const, requirement_code: 'PADRON',
  name: 'Padrón', requirement_level: 'LEGAL_MANDATORY' as const, has_expiration: false,
}
const REQ_FECHA = { ...REQ, id: 'req-2', name: 'SOAP', has_expiration: true }
const SUBJECTS = [{ entity_type: 'ASSET' as const, entity_id: 'a1', label: 'HKXW55' }]

function setup(targetIds = ['i1', 'i2'], onApplied = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <TriageClassifyForm targetIds={targetIds} subjects={SUBJECTS} onApplied={onApplied} />
    </QueryClientProvider>,
  )
  return onApplied
}

async function elegir(reqName = 'Padrón') {
  fireEvent.change(screen.getByLabelText(/sujeto/i), { target: { value: 'ASSET:a1' } })
  await screen.findByRole('option', { name: reqName })
  fireEvent.change(screen.getByLabelText(/tipo de documento/i), {
    target: { value: reqName === 'Padrón' ? 'req-1' : 'req-2' },
  })
}

beforeEach(() => {
  vi.mocked(complianceApi.listRequirements).mockReset().mockResolvedValue([REQ, REQ_FECHA])
  vi.mocked(documentIngestApi.classifyBatch).mockReset()
    .mockResolvedValue({ applied: ['i1', 'i2'], errors: [] })
})

describe('TriageClassifyForm', () => {
  it('anuncia a cuántos documentos va a aplicar', () => {
    setup()
    expect(screen.getByRole('button', { name: /aplicar a los 2/i })).toBeInTheDocument()
  })

  it('aplica a toda la selección de una vez', async () => {
    const onApplied = setup()
    await elegir()
    fireEvent.click(screen.getByRole('button', { name: /aplicar a los 2/i }))

    await waitFor(() => {
      expect(documentIngestApi.classifyBatch).toHaveBeenCalledWith({
        item_ids: ['i1', 'i2'], entity_type: 'ASSET',
        entity_id: 'a1', requirement_id: 'req-1',
      })
      expect(onApplied).toHaveBeenCalledWith(['i1', 'i2'])
    })
  })

  it('exige la fecha cuando el requisito la requiere', async () => {
    setup()
    await elegir('SOAP')
    expect(screen.getByLabelText(/fecha de vencimiento/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /aplicar/i })).toBeDisabled()
  })

  it('no deja aplicar sin selección', () => {
    setup([])
    expect(screen.getByText(/elegí uno o más documentos/i)).toBeInTheDocument()
  })

  it('muestra el error del backend sin perder la selección', async () => {
    vi.mocked(documentIngestApi.classifyBatch).mockRejectedValue(new Error('Esa entidad no tiene ese requisito'))
    setup()
    await elegir()
    fireEvent.click(screen.getByRole('button', { name: /aplicar a los 2/i }))

    expect(await screen.findByText(/no tiene ese requisito/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/
```

Esperado: FAIL — los módulos no existen.

- [ ] **Step 3: Implementar `TriagePreview.tsx`**

```tsx
'use client'

import { FileStack } from 'lucide-react'
import type { TrayItem } from '@/lib/types'

/** Panel central: qué es el archivo que se está por clasificar.
 *
 *  No es decorativo — de 24 documentos reales cargados, uno solo traía un
 *  identificador en el nombre. Con `IMG_9001.png` la vista previa es lo único
 *  que permite decidir. Con varios seleccionados pasa a resumir la selección,
 *  porque ahí la decisión ya no es sobre un archivo puntual. */
export function TriagePreview({ items }: { items: TrayItem[] }) {
  if (!items.length) {
    return (
      <div className="h-full min-h-[240px] flex items-center justify-center">
        <p className="text-xs text-gray-400">Elegí un documento para verlo</p>
      </div>
    )
  }

  if (items.length > 1) {
    return (
      <div className="h-full min-h-[240px] flex flex-col items-center justify-center gap-2">
        <FileStack size={28} className="text-accent" />
        <p className="text-sm font-semibold text-text-primary">
          {items.length} documentos seleccionados
        </p>
        <p className="text-[11px] text-gray-400 text-center max-w-[240px]">
          Lo que elijas a la derecha se aplica a todos.
        </p>
      </div>
    )
  }

  const item = items[0]
  const isImage = (item.mime_type ?? '').startsWith('image/')

  return (
    <div className="h-full min-h-[240px] flex flex-col gap-2">
      <div className="flex-1 bg-gray-50 rounded-lg flex items-center justify-center overflow-hidden">
        {item.preview_url && isImage && (
          <img src={item.preview_url} alt={item.file_name} className="max-h-[46vh] object-contain" />
        )}
        {item.preview_url && !isImage && (
          <iframe src={item.preview_url} title={item.file_name} className="w-full h-[46vh]" />
        )}
        {!item.preview_url && <p className="text-xs text-gray-400">Sin vista previa</p>}
      </div>
      <p className="text-[11px] text-gray-500 font-mono text-center truncate">{item.file_name}</p>
    </div>
  )
}
```

- [ ] **Step 4: Implementar `TriageClassifyForm.tsx`**

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { documentIngestApi } from '@/lib/api/documentIngest'

type Subject = { entity_type: 'CARRIER' | 'DRIVER' | 'ASSET'; entity_id: string; label: string }

interface Props {
  targetIds: string[]
  subjects:  Subject[]
  onApplied: (appliedIds: string[]) => void
}

/** Panel derecho: a quién pertenece y qué es.
 *
 *  El mismo formulario sirve para uno o para quince — la selección múltiple no
 *  necesita una pantalla propia. */
export function TriageClassifyForm({ targetIds, subjects, onApplied }: Props) {
  const [subjectKey, setSubjectKey] = useState('')
  const [requirementId, setRequirementId] = useState('')
  const [expiration, setExpiration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const subject = useMemo(
    () => subjects.find(s => `${s.entity_type}:${s.entity_id}` === subjectKey) ?? null,
    [subjects, subjectKey],
  )

  const requirementsQuery = useQuery({
    queryKey: ['compliance-requirements', subject?.entity_type],
    queryFn: () => complianceApi.listRequirements(subject!.entity_type),
    enabled: !!subject,
  })

  const requirements = requirementsQuery.data ?? []
  const selected = requirements.find(r => r.id === requirementId) ?? null
  const needsDate = selected?.has_expiration ?? false
  const canApply = targetIds.length > 0 && !!subject && !!requirementId
    && (!needsDate || !!expiration) && !saving

  async function apply() {
    if (!subject) return
    setSaving(true)
    setError(null)
    try {
      const res = await documentIngestApi.classifyBatch({
        item_ids: targetIds,
        entity_type: subject.entity_type,
        entity_id: subject.entity_id,
        requirement_id: requirementId,
        ...(expiration ? { expiration_date: expiration } : {}),
      })
      setRequirementId('')
      setExpiration('')
      onApplied(res.applied)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo clasificar')
    } finally {
      setSaving(false)
    }
  }

  if (!targetIds.length) {
    return (
      <p className="text-xs text-gray-400 p-2">
        Elegí uno o más documentos de la lista para clasificarlos.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-[11px] font-semibold text-gray-600">Sujeto</span>
        <select
          aria-label="Sujeto"
          value={subjectKey}
          onChange={e => { setSubjectKey(e.target.value); setRequirementId(''); setExpiration('') }}
          className="w-full mt-1 text-xs border border-border rounded-lg px-2 py-1.5"
        >
          <option value="">— Seleccionar —</option>
          {subjects.map(s => (
            <option key={`${s.entity_type}:${s.entity_id}`} value={`${s.entity_type}:${s.entity_id}`}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      {subject && (
        <label className="block">
          <span className="text-[11px] font-semibold text-gray-600">Tipo de documento</span>
          <select
            aria-label="Tipo de documento"
            value={requirementId}
            onChange={e => { setRequirementId(e.target.value); setExpiration('') }}
            disabled={requirementsQuery.isPending}
            className="w-full mt-1 text-xs border border-border rounded-lg px-2 py-1.5"
          >
            <option value="">— Seleccionar —</option>
            {requirements.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
      )}

      {needsDate && (
        <label className="block">
          <span className="text-[11px] font-semibold text-gray-600">Fecha de vencimiento</span>
          <input
            type="date"
            aria-label="Fecha de vencimiento"
            value={expiration}
            onChange={e => setExpiration(e.target.value)}
            className="w-full mt-1 text-xs border border-border rounded-lg px-2 py-1.5"
          />
        </label>
      )}

      {error && <p className="text-[11px] text-red-500">{error}</p>}

      <button
        type="button"
        onClick={apply}
        disabled={!canApply}
        className="w-full flex items-center justify-center gap-2 bg-accent text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-accent/90 disabled:opacity-40 transition-colors"
      >
        {saving && <Loader2 size={14} className="animate-spin" />}
        {targetIds.length === 1 ? 'Aplicar' : `Aplicar a los ${targetIds.length}`}
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Verificar**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/ && npx tsc --noEmit
```

Esperado: 4 + 5 tests PASS y `tsc` limpio.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/components/compliance/
git commit -m "feat(compliance): vista previa y formulario que aplica a la seleccion

El mismo formulario sirve para uno o para quince documentos: la seleccion
multiple no necesita pantalla propia.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Armar la bandeja y retirar los modales

> **HECHA PARCIALMENTE — el resto quedó SUPERADO por la revisión del 2026-08-14
> (ver el final de este documento).** Se construyó `TriageWorkbench` con sus
> tests; **NO se ejecutó** el montaje en `app/dashboard/compliance/page.tsx` ni
> el borrado de `ClassifyDocumentModal`. La bandeja no se monta en esa página:
> vive en `/dashboard/compliance/inbox` (Task 16), y los borrados pasaron a la
> Task 17. El `TriageWorkbench` de acá **se reescribe** en la Task 16.

**Files:**
- Create: `components/compliance/TriageWorkbench.tsx`, `TriageWorkbench.test.tsx`
- Modify: `app/dashboard/compliance/page.tsx`
- Delete: `components/dashboard/ClassifyDocumentModal.tsx` y su test

**Interfaces:**
- Consumes: `TriageFileList`, `TriagePreview`, `TriageClassifyForm`, `documentIngestApi`.
- Produces:
```ts
export function TriageWorkbench(props: { carrierId: string; carrierName: string }): JSX.Element
```

- [ ] **Step 1: Escribir el test que falla**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TriageWorkbench } from './TriageWorkbench'

vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: {
    listTray: vi.fn(), upload: vi.fn(), remove: vi.fn(),
    classifyBatch: vi.fn(), moveItems: vi.fn(),
  },
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listPending: vi.fn(), listRequirements: vi.fn() },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))
import { documentIngestApi } from '@/lib/api/documentIngest'
import { complianceApi } from '@/lib/api/compliance'

const item = (id: string) => ({
  id, file_name: `${id}.png`, mime_type: 'image/png', size_bytes: 10,
  storage_path: `s/${id}`, match_status: 'UNMATCHED' as const, preview_url: `https://x/${id}`,
})

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <TriageWorkbench carrierId="c1" carrierName="ACME" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(documentIngestApi.listTray).mockReset().mockResolvedValue([item('i1'), item('i2')])
  vi.mocked(complianceApi.listPending).mockReset().mockResolvedValue({
    total: 1,
    rows: [{
      id: 'r1', carrier_id: 'c1', carrier_name: 'ACME', carrier_tax_id: '1-9',
      carrier_operation_types: [], certification_type: 'BASICA', category: 'EQUIPO',
      entity_type: 'ASSET', entity_id: 'a1', subject_name: 'HKXW55',
      requirement_code: 'PADRON', document_name: 'Padrón',
      status: 'MISSING', expiration_date: null,
    }],
  })
  vi.mocked(complianceApi.listRequirements).mockReset().mockResolvedValue([])
})

describe('TriageWorkbench', () => {
  it('muestra los tres paneles sin abrir ningún modal', async () => {
    setup()
    await screen.findByText('i1.png')
    expect(screen.getByRole('listbox', { name: /sin clasificar/i })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('al marcar dos archivos, el formulario ofrece aplicar a los dos', async () => {
    setup()
    await screen.findByText('i1.png')
    fireEvent.click(screen.getByRole('checkbox', { name: /i1\.png/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /i2\.png/ }))

    expect(await screen.findByRole('button', { name: /aplicar a los 2/i })).toBeInTheDocument()
  })

  it('deriva los sujetos de los pendientes de la empresa', async () => {
    setup()
    await screen.findByText('i1.png')
    fireEvent.click(screen.getByRole('checkbox', { name: /i1\.png/ }))

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'HKXW55' })).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/TriageWorkbench.test.tsx
```

Esperado: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, UploadCloud } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { documentIngestApi } from '@/lib/api/documentIngest'
import { useCanEdit } from '@/hooks/useCanEdit'
import { TriageClassifyForm } from './TriageClassifyForm'
import { TriageFileList } from './TriageFileList'
import { TriagePreview } from './TriagePreview'

interface Props {
  carrierId:   string
  carrierName: string
}

/** La bandeja de trabajo: tres paneles, cero modales.
 *
 *  Reemplaza al par panel + modal de clasificación, que costaba ~5 clics por
 *  documento. Acá el formulario aplica a todo lo marcado: con un archivo
 *  clasifica ese, con quince aplica a los quince. */
export function TriageWorkbench({ carrierId, carrierName }: Props) {
  const qc = useQueryClient()
  const canEdit = useCanEdit()
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [dragging, setDragging] = useState(false)
  const [errors, setErrors] = useState<{ file_name: string; error: string }[]>([])

  const trayKey = ['ingest-tray', carrierId]
  const trayQuery = useQuery({ queryKey: trayKey, queryFn: () => documentIngestApi.listTray(carrierId) })
  const pendingQuery = useQuery({
    queryKey: ['compliance-pending-carrier-panel', carrierId],
    queryFn: () => complianceApi.listPending({ carrierId, limit: 200 }),
  })

  const items = trayQuery.data ?? []
  const rows = pendingQuery.data?.rows ?? []

  const subjects = useMemo(() => {
    const seen = new Map<string, { entity_type: 'CARRIER' | 'DRIVER' | 'ASSET'; entity_id: string; label: string }>()
    for (const r of rows) {
      const key = `${r.entity_type}:${r.entity_id}`
      if (!seen.has(key)) {
        seen.set(key, {
          entity_type: r.entity_type as 'CARRIER' | 'DRIVER' | 'ASSET',
          entity_id: r.entity_id,
          label: r.subject_name ?? r.carrier_name,
        })
      }
    }
    return Array.from(seen.values())
  }, [rows])

  // Con nada marcado, el formulario opera sobre el archivo enfocado: así se
  // clasifica de a uno sin obligar a marcar primero.
  const targetIds = selectedIds.size > 0
    ? items.filter(i => selectedIds.has(i.id)).map(i => i.id)
    : (focusedId ? [focusedId] : [])
  const previewItems = items.filter(i => targetIds.includes(i.id))

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => documentIngestApi.upload(carrierId, files),
    onSuccess: res => { setErrors(res.errors); qc.invalidateQueries({ queryKey: trayKey }) },
  })
  const removeMutation = useMutation({
    mutationFn: (id: string) => documentIngestApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: trayKey }),
  })

  function handleFiles(list: FileList | null) {
    const files = Array.from(list ?? [])
    if (files.length) uploadMutation.mutate(files)
  }

  function handleApplied(appliedIds: string[]) {
    setSelectedIds(new Set())
    setFocusedId(null)
    qc.invalidateQueries({ queryKey: trayKey })
    qc.invalidateQueries({ queryKey: ['compliance-pending-carrier-panel', carrierId] })
    qc.invalidateQueries({ queryKey: ['compliance-pending'] })
  }

  return (
    <div className="space-y-3">
      {canEdit && (
        <label
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
          className={`flex items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-3 cursor-pointer transition-colors ${
            dragging ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50'
          }`}
        >
          {uploadMutation.isPending
            ? <Loader2 size={16} className="animate-spin text-accent" />
            : <UploadCloud size={16} className="text-gray-400" />}
          <span className="text-[11px] text-gray-500">
            Arrastrá acá los documentos de {carrierName}
          </span>
          <input
            type="file" multiple className="hidden"
            aria-label={`Arrastrá acá los documentos de ${carrierName}`}
            onChange={e => handleFiles(e.target.files)}
          />
        </label>
      )}

      {errors.map(e => (
        <p key={e.file_name} className="text-[10px] text-red-500">{e.file_name}: {e.error}</p>
      ))}

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr_240px] gap-3">
        <div className="border border-border rounded-lg overflow-y-auto max-h-[52vh]">
          {trayQuery.isPending ? (
            <p className="text-[11px] text-gray-400 p-3 flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin" /> Cargando…
            </p>
          ) : (
            <TriageFileList
              items={items}
              focusedId={focusedId}
              selectedIds={selectedIds}
              onFocus={setFocusedId}
              onToggle={id => setSelectedIds(prev => {
                const next = new Set(prev)
                next.has(id) ? next.delete(id) : next.add(id)
                return next
              })}
              onToggleAll={() => setSelectedIds(prev =>
                prev.size === items.length ? new Set() : new Set(items.map(i => i.id)),
              )}
              onDiscard={id => removeMutation.mutate(id)}
            />
          )}
        </div>

        <div className="border border-border rounded-lg p-3">
          <TriagePreview items={previewItems} />
        </div>

        <div className="border border-border rounded-lg p-3">
          <TriageClassifyForm
            targetIds={canEdit ? targetIds : []}
            subjects={subjects}
            onApplied={handleApplied}
          />
        </div>
      </div>

      <p className="text-[10px] text-gray-400 font-mono">
        ↑↓ mover · space marcar · ↵ aplicar · ⌫ descartar
      </p>
    </div>
  )
}
```

En `app/dashboard/compliance/page.tsx`, reemplazar el uso de `CertificationCompanyPanel` por `TriageWorkbench` cuando hay una empresa seleccionada. La sábana de pendientes y sus filtros **no se tocan** en esta tarea.

Borrar `components/dashboard/ClassifyDocumentModal.tsx` y `ClassifyDocumentModal.test.tsx`:

```bash
git rm monitor-app/frontend/components/dashboard/ClassifyDocumentModal.tsx \
       monitor-app/frontend/components/dashboard/ClassifyDocumentModal.test.tsx
```

- [ ] **Step 4: Verificar**

```bash
cd monitor-app/frontend && npx vitest run && npx tsc --noEmit && npm run build
```

Esperado: todo verde. Si `CertificationCompanyPanel.test.tsx` falla por los tests de la bandeja vieja, actualizarlo: esa superficie se movió a `TriageWorkbench`.

- [ ] **Step 5: Commit**

```bash
git add -A monitor-app/frontend
git commit -m "feat(compliance): la bandeja reemplaza a los dos modales apilados

Tres paneles en una sola superficie. Con nada marcado el formulario opera
sobre el archivo enfocado, asi que clasificar de a uno no obliga a marcar.

Se elimina ClassifyDocumentModal.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Mover archivos a otra empresa desde la bandeja

Cierra la cuarta variante de "mover" de la HU-03. Sin esta tarea el endpoint de
la Task 3 queda sin forma de invocarse.

**Files:**
- Create: `components/compliance/MoveToCarrierBar.tsx`, `MoveToCarrierBar.test.tsx`
- Modify: `components/compliance/TriageWorkbench.tsx`

**Interfaces:**
- Consumes: `documentIngestApi.moveItems(itemIds, carrierId)`, `CarrierSearchPicker`.
- Produces:
```ts
export function MoveToCarrierBar(props: {
  targetIds: string[]
  currentCarrierId: string
  onMoved: () => void
}): JSX.Element | null
```

- [ ] **Step 1: Escribir el test que falla**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MoveToCarrierBar } from './MoveToCarrierBar'

vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: { moveItems: vi.fn() },
}))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { list: vi.fn().mockResolvedValue({ rows: [
    { id: 'c2', business_name: 'Otra Empresa', tax_id: '76000000-0' },
  ] }) },
}))
import { documentIngestApi } from '@/lib/api/documentIngest'

function setup(targetIds = ['i1', 'i2'], onMoved = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MoveToCarrierBar targetIds={targetIds} currentCarrierId="c1" onMoved={onMoved} />
    </QueryClientProvider>,
  )
  return onMoved
}

beforeEach(() => {
  vi.mocked(documentIngestApi.moveItems).mockReset().mockResolvedValue({ moved: 2 })
})

describe('MoveToCarrierBar', () => {
  it('no aparece si no hay nada seleccionado', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MoveToCarrierBar targetIds={[]} currentCarrierId="c1" onMoved={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('anuncia cuántos documentos va a mover', () => {
    setup()
    expect(screen.getByRole('button', { name: /mover 2 a otra empresa/i })).toBeInTheDocument()
  })

  it('mueve la selección a la empresa elegida', async () => {
    const onMoved = setup()
    fireEvent.click(screen.getByRole('button', { name: /mover 2 a otra empresa/i }))
    fireEvent.change(await screen.findByPlaceholderText(/buscar empresa/i), {
      target: { value: 'Otra' },
    })
    fireEvent.click(await screen.findByText('Otra Empresa'))

    await waitFor(() => {
      expect(documentIngestApi.moveItems).toHaveBeenCalledWith(['i1', 'i2'], 'c2')
      expect(onMoved).toHaveBeenCalled()
    })
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/MoveToCarrierBar.test.tsx
```

Esperado: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

```tsx
'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, Loader2 } from 'lucide-react'
import { documentIngestApi } from '@/lib/api/documentIngest'
import { CarrierSearchPicker } from '@/components/dashboard/CarrierSearchPicker'

interface Props {
  targetIds:        string[]
  currentCarrierId: string
  onMoved:          () => void
}

/** Corrige el error más probable del uso real: soltar cuarenta archivos en la
 *  empresa equivocada y darse cuenta al verlos.
 *
 *  Sólo mueve archivos SIN clasificar — no toca compliance_records, porque
 *  todavía no están aplicados a ningún requisito. */
export function MoveToCarrierBar({ targetIds, currentCarrierId, onMoved }: Props) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!targetIds.length) return null

  async function move(carrierId: string) {
    setError(null)
    try {
      await documentIngestApi.moveItems(targetIds, carrierId)
      setOpen(false)
      setQuery('')
      qc.invalidateQueries({ queryKey: ['ingest-tray', currentCarrierId] })
      qc.invalidateQueries({ queryKey: ['ingest-tray', carrierId] })
      onMoved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo mover')
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-600 hover:text-accent transition-colors"
      >
        <ArrowRightLeft size={11} />
        Mover {targetIds.length} a otra empresa
      </button>
    )
  }

  return (
    <div className="space-y-1.5">
      <CarrierSearchPicker
        query={query}
        onQueryChange={setQuery}
        onPick={c => move(c.id)}
        excludeId={currentCarrierId}
        placeholder="Buscar empresa…"
        size="sm"
        autoFocus
      />
      {error && <p className="text-[10px] text-red-500">{error}</p>}
      <button
        type="button"
        onClick={() => { setOpen(false); setError(null) }}
        className="text-[10px] text-gray-400 hover:text-gray-600"
      >
        Cancelar
      </button>
    </div>
  )
}
```

En `TriageWorkbench.tsx`, montarla debajo del formulario de clasificación:

```tsx
          <MoveToCarrierBar
            targetIds={canEdit ? targetIds : []}
            currentCarrierId={carrierId}
            onMoved={() => { setSelectedIds(new Set()); setFocusedId(null) }}
          />
```

con su import: `import { MoveToCarrierBar } from './MoveToCarrierBar'`.

**Verificar antes** la firma real de `CarrierSearchPicker`, que ya existe y se
reusa sin modificarla:

```bash
cd monitor-app/frontend && grep -n "export function CarrierSearchPicker" -A14 components/dashboard/CarrierSearchPicker.tsx
```

Ajustar las props del ejemplo a las que ese componente declare.

- [ ] **Step 4: Verificar**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/ && npx tsc --noEmit
```

Esperado: 3 tests nuevos PASS, y los de `TriageWorkbench` siguen pasando.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/compliance/
git commit -m "feat(compliance): mover archivos sin clasificar a otra empresa

Cuarta variante de mover de la HU-03, el error mas probable del uso real.
No toca compliance_records: los archivos todavia no estan aplicados.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Descomponer la ficha de empresa

971 líneas y 6 tabs. Refactor sin cambio funcional, en su propio commit para que se pueda revisar como tal.

**Files:**
- Create: `components/dashboard/carriers/CarrierDocumentsTab.tsx`
- Modify: `app/dashboard/carriers/[id]/page.tsx:579-605` (el bloque del tab Documentos)

**Interfaces:**
- Produces:
```ts
export function CarrierDocumentsTab(props: {
  carrierId: string
  records: ComplianceRecord[]
  onExport: () => void
  exporting: boolean
}): JSX.Element
```

- [ ] **Step 1: Verificar el estado de partida**

```bash
cd monitor-app/frontend && wc -l app/dashboard/carriers/\[id\]/page.tsx && npx vitest run app/dashboard/carriers/
```

Anotar el número de líneas y que los tests pasan **antes** de tocar nada. El refactor no debe cambiar ninguno.

- [ ] **Step 2: Extraer el tab a su componente**

Mover el contenido del bloque `{activeTab === 'documentos' && ( … )}` a `components/dashboard/carriers/CarrierDocumentsTab.tsx`, con `TransporterAlertBanner`, `TransporterDocumentsPanel` y el botón de exportar. La página pasa a:

```tsx
{activeTab === 'documentos' && (
  <CarrierDocumentsTab
    carrierId={carrierId}
    records={carrier.compliance_records}
    onExport={handleExportDocuments}
    exporting={exporting}
  />
)}
```

- [ ] **Step 3: Verificar que nada cambió**

```bash
cd monitor-app/frontend && npx vitest run && npx tsc --noEmit && wc -l app/dashboard/carriers/\[id\]/page.tsx
```

Esperado: **los mismos tests pasando que en el Step 1**, y el archivo más corto. Un test que cambia de resultado significa que el refactor alteró comportamiento.

- [ ] **Step 4: Commit**

```bash
git add monitor-app/frontend
git commit -m "refactor(empresas): extrae el tab Documentos de la ficha

Sin cambio funcional: los mismos tests pasan antes y despues. La ficha tenia
971 lineas y va a recibir la carga de documentos; sumarle superficie sin
descomponerla primero la vuelve inmanejable.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: La ficha vuelve a poder cargar documentos

Cierra el *"tenés una empresa, no veo la parte cargar"* que reportó Pablo.

**Files:**
- Modify: `components/dashboard/carriers/CarrierDocumentsTab.tsx`
- Test: `components/dashboard/carriers/CarrierDocumentsTab.test.tsx`

**Interfaces:**
- Consumes: `TriageWorkbench` de la Task 7.

- [ ] **Step 1: Escribir el test que falla**

```tsx
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CarrierDocumentsTab } from './CarrierDocumentsTab'

vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: {
    // Revisión 2026-08-14: `listTray` se retira en la Task 17. Si esta tarea
    // se ejecuta después de la Task 13, mockear `listQueue` y `previewUrl`.
    listQueue: vi.fn().mockResolvedValue({ total: 0, rows: [] }),
    previewUrl: vi.fn().mockResolvedValue({ preview_url: null }),
    upload: vi.fn(), remove: vi.fn(), classifyBatch: vi.fn(), moveItems: vi.fn(),
  },
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: {
    listPending: vi.fn().mockResolvedValue({ total: 0, rows: [] }),
    listRequirements: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <CarrierDocumentsTab
        carrierId="c1" carrierName="ACME" records={[]}
        onExport={vi.fn()} exporting={false}
      />
    </QueryClientProvider>,
  )
}

describe('CarrierDocumentsTab', () => {
  beforeEach(() => vi.clearAllMocks())

  it('permite cargar documentos sin salir de la ficha', async () => {
    setup()
    expect(await screen.findByLabelText(/arrastrá acá los documentos de ACME/i)).toBeInTheDocument()
  })

  it('ya no manda a otro módulo para cargar', () => {
    setup()
    expect(screen.queryByText(/subir en certificación/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/carriers/CarrierDocumentsTab.test.tsx
```

Esperado: FAIL — el tab todavía es solo lectura con el link de salida.

- [ ] **Step 3: Implementar**

En `CarrierDocumentsTab.tsx`: agregar la prop `carrierName: string`, montar `<TriageWorkbench carrierId={carrierId} carrierName={carrierName} />` arriba del panel de solo lectura, y **quitar el link "Subir en Certificación"** de `TransporterDocumentsPanel` (ya no hace falta salir del módulo). Pasar `carrierName` desde `carriers/[id]/page.tsx`.

Es el mismo componente que usa la bandeja: una sola implementación de carga, que es el criterio de aceptación *"una sola implementación"* de la HU-04.

- [ ] **Step 4: Verificar**

```bash
cd monitor-app/frontend && npx vitest run && npx tsc --noEmit && npm run build
```

Esperado: todo verde. Los tests de `TransporterDocumentsPanel` que verifican el link de salida hay que actualizarlos: ese link deja de existir a propósito.

- [ ] **Step 5: Commit**

```bash
git add -A monitor-app/frontend
git commit -m "feat(empresas): la ficha vuelve a poder cargar documentos

Revierte la amputacion de la Ronda 88: el lugar donde miras la empresa vuelve
a ser el lugar donde actuas sobre ella. Usa el mismo componente que la
bandeja, no una segunda implementacion.

Cierra el "tenes una empresa, no veo la parte cargar" de la reunion del 14/08.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: Adaptar las skills heredadas de suma-scout

**Files:**
- Modify: `.claude/skills/mockups/SKILL.md`, `.claude/skills/qa-testing/SKILL.md`

- [ ] **Step 1: Corregir las referencias**

Ambas skills se copiaron de suma-scout y su `description` dice *"in suma-scout"*, además de referenciar archivos que en webcarga no existen (su `CLAUDE.md`, su blueprint HTML, `docs/arquitectura/`).

En `mockups/SKILL.md`: cambiar la `description` a webcarga, y reemplazar la fuente de verdad — acá los mockups viven en `monitor-app/docs/user-stories/<fecha>/` junto a la HU que describen, y el companion visual se publica como artifact. Conservar íntegras las secciones de **estados obligatorios** (vacío, a medias, sin permiso, error) y de **verificación visual**, que no dependen del proyecto.

En `qa-testing/SKILL.md`: cambiar la `description`, y ajustar los comandos al stack real de webcarga — `venv/bin/pytest` para el backend y `npx vitest run` para el frontend, con la ruta del venv correcta.

- [ ] **Step 2: Verificar que no quedan referencias al proyecto ajeno**

```bash
cd /Users/usuario/Desktop/projects/webcarga
grep -rn "suma-scout\|suma scout" .claude/skills/ | grep -v "ui-ux-pro-max/data"
```

Esperado: sin resultados.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/
git commit -m "chore(skills): adapta mockups y qa-testing a webcarga

Venian de suma-scout y referenciaban su CLAUDE.md, su blueprint y rutas que
aca no existen. Se conservan las secciones que no dependen del proyecto:
estados obligatorios de pantalla y verificacion visual.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verificación final

- [ ] **Suites completas**

```bash
cd monitor-app/backend/api && venv/bin/pytest tests/ -q
cd ../../frontend && npx vitest run && npx tsc --noEmit && npm run build
```

Esperado: backend 529+ (524 previos + 5 nuevos); frontend sobre 750. Hay flakiness conocida bajo carga en `FleetDailyOverviewDialog.test.tsx` y `TripAssignDialog.test.tsx` — correrlos aislados antes de darlos por rotos.

- [ ] **Click-through en dev**, con la precaución que ya costó un documento real:

```sql
-- Elegir una empresa SIN nada cargado antes de abrir el navegador
SELECT c.id::text, c.business_name,
       count(*) FILTER (WHERE cr.status IN ('MISSING','EXPIRED')) AS pendientes,
       count(*) FILTER (WHERE cr.file_url IS NOT NULL) AS con_archivo
FROM public.carriers c
JOIN public.compliance_records cr ON cr.entity_type='CARRIER' AND cr.entity_id=c.id
WHERE c.operational_status='ACTIVE'
GROUP BY 1,2 HAVING count(*) FILTER (WHERE cr.file_url IS NOT NULL) = 0
ORDER BY pendientes DESC LIMIT 3;
```

Recorrido a verificar:
1. `/dashboard/certification?carrier_id=X` **redirige** a `/dashboard/compliance?carrier_id=X`.
2. Arrastrar 4 archivos: caen en la bandeja, `compliance_records` no cambia.
3. Marcar 3 y aplicarles el mismo requisito **de una vez**.
4. Moverlos a otra empresa y comprobar que desaparecen de la bandeja de origen.
5. Recorrer y clasificar **sólo con teclado**: ↑↓, espacio, Enter.
6. Cargar un documento **desde la ficha de empresa**, sin salir.
7. **Limpiar todo** al terminar y confirmar con un conteo global que la base volvió a su estado previo.

---

## Fuera de alcance

- **HU-05** (administración de requisitos), **HU-06** (Seguros proyectado).
- **Mover un documento ya clasificado** — es el resto de la HU-03; acá sólo se cubre mover los que aún están sin clasificar.
- **Absorber Seguros** como sección de la ficha: la HU-04 lo contempla, pero excede este plan y no bloquea nada.
- **Cablear `document_matcher.py`** — es la etapa del agente, acordada como posterior.
- Descomponer los otros 5 tabs de la ficha: sólo se extrae Documentos, que es el que recibe superficie nueva.

---

# Revisión de diseño — 2026-08-14 (aprobada por el usuario)

La Task 7 dejó abierto **dónde se monta la bandeja**, y al resolverlo el usuario
pidió que la pantalla opere como un SaaS enterprise, no como un cliente de
correo. Esta sección **reemplaza** esa decisión pendiente y agrega las Tasks
12-17. Las Tasks 1-6 y 8 quedan como están; sus componentes se reusan.

## Qué se decidió, y por qué

**La bandeja es un destino con nombre propio, no un tab ni un panel.**
Ítem del sidebar `Bandeja`, con contador. Un tab dice "otra vista del mismo
reporte"; un ítem de navegación con contador dice "esto es trabajo tuyo
pendiente". Ruta `/dashboard/compliance/inbox` — etiqueta en español, ruta en
inglés, igual que el resto del módulo. Va **al mismo nivel** que Certificación y
no colgando de ella: ver el motivo en la Task 16, Step 5 — anidarla obligaba a
duplicar 55 líneas de markup o a generalizar el Sidebar entero.

**La cola es global, no por empresa.** Se entra y el trabajo está ahí, agrupado
por empresa; la empresa es un filtro, no un requisito previo. Una bandeja que
arranca vacía y te pide adivinar una empresa es un buscador, no una bandeja.

**La lista es una tabla con columnas** — archivo, empresa, subido, sugerencia —
ordenable. Una columna única de nombres de archivo no se escanea ni se ordena, y
sin eso no hay trabajo masivo posible.

**Barra contextual al seleccionar**, con `Clasificar · Mover · Descartar ·
Deseleccionar`, en vez de acciones siempre presentes. Es el estándar de Gmail,
Linear, Airtable y Salesforce Lightning, y es donde pasan a vivir *mover* y
*descartar*, hoy escondidos en el panel derecho.

**`⇧`+click selecciona rango.** Marcar de a uno cuarenta archivos es la misma
tortura con otra ropa.

**La columna Sugerencia se construye ahora, aunque hoy esté vacía.** El esquema
ya tiene `match_status`, `confidence` y `candidates`, y la HU dice que el agente
de clasificación llega después. Ningún producto de esta categoría hace clasificar
desde cero: propone y la persona confirma. Sin el lugar reservado, cuando llegue
el agente hay que rehacer fila y barra de acciones.

## Dos hallazgos del código que condicionan el diseño

**1 · `resolve_signed_url` es una llamada HTTP por ítem, secuencial.**
`app/utils/document_storage.py:121`, invocada dentro de un list comprehension en
`list_tray`. Con 20 documentos son 20 llamadas; con una cola global de 2.000 son
2.000 llamadas secuenciales en un request — minutos y timeout. **La corrección de
raíz no es paginar más fino: es no firmar en el listado.** La vista previa se
mira de a un archivo por vez, así que la firma pasa a un endpoint aparte que se
llama al enfocar. El listado deja de firmar nada. La paginación se mantiene igual,
pero por peso de render, no por esto.

**2 · Ninguna de las dos acciones destructivas se puede deshacer, y eso cambia
el patrón.** El diseño aprobado pedía "deshacer en vez de confirmar". Al ir al
código, ninguna de las dos operaciones lo permite:

- `classify_batch` llama a `_apply_stored_document`, que escribe **una versión
  nueva en `compliance_records`**. Revertir eso es tocar el historial documental,
  no borrar una fila. Revertir una clasificación ya aplicada **es la parte
  abierta de la HU-03** ("mover un documento ya clasificado"), que ya figura en
  Fuera de alcance — ahí es donde corresponde, con su propio diseño.
- `delete_item` (`document_ingest.py:196`) marca `DISCARDED` sin borrar la fila,
  **pero llama a `delete_document_version`, que elimina el blob de staging**. El
  archivo deja de existir: no hay nada que restaurar.

Entonces el patrón correcto no es "deshacer" sino:

| Acción | Qué se hace |
|---|---|
| Clasificar | Se aplica y el toast **confirma** cuántos y cuántos quedan. Es constructiva y la corrige la HU-03 |
| Mover | Se aplica directo. **Sí es reversible** — se mueve de vuelta |
| Descartar | **Confirmación en línea dentro de la barra**, nunca un modal. Es irreversible y borra el archivo |

Prometer un "Deshacer" que no puede cumplirse sería peor que pedir confirmación.
Hacer que descartar fuera reversible implica postergar el borrado del blob y
sumarle una retención — decisión propia, no la toma este plan.

## Qué se reusa y qué se retira de lo ya construido

| Componente | Destino |
|---|---|
| `TriageClassifyForm` (Task 6) | **Se reusa sin cambios.** Ya aplica a N y ya deriva los sujetos del sujeto elegido |
| `TriagePreview` (Task 6) | **Se reusa**, con la URL firmada llegando por prop en vez de venir en el ítem |
| `MoveToCarrierBar` (Task 8) | **Se reusa**, pero su disparador se muda a la barra contextual |
| `TriageFileList` (Task 5) | **Se retira**: lo reemplaza `TriageFileTable`. La lógica de teclado se conserva y se le suma el rango |
| `UnclassifiedTray`, `ClassifyDocumentModal` | **Se borran** (Task 17) |

---

## Task 12: La cola global, sin firmar URLs en el listado

**Files:**
- Modify: `monitor-app/backend/api/app/routers/document_ingest.py`
- Modify: `monitor-app/backend/api/app/schemas/document_ingest.py`
- Modify: `monitor-app/backend/api/tests/test_document_ingest.py`

**Interfaces:**
- Produces:
  - `GET /api/v1/document-ingest/items?carrier_id=&limit=&offset=` → `TrayPage`
  - `GET /api/v1/document-ingest/items/{item_id}/preview-url` → `{"preview_url": str | None}`

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/test_document_ingest.py`:

```python
@pytest.mark.asyncio
async def test_list_queue_devuelve_total_y_empresa(client, pool):
    """La cola global agrupa por empresa, asi que cada fila trae su empresa."""
    pool.fetchval.return_value = 2
    pool.fetch.return_value = [
        {
            "id": "i1", "file_name": "IMG_9001.png", "mime_type": "image/png",
            "size_bytes": 10, "storage_path": "s/1", "match_status": "UNMATCHED",
            "created_at": datetime(2026, 8, 14, tzinfo=timezone.utc),
            "carrier_id": "c1", "carrier_name": "ACME S.A.",
            "confidence": None, "suggested_requirement_name": None, "candidate_count": 0,
        }
    ]
    r = await client.get("/api/v1/document-ingest/items")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2
    assert body["rows"][0]["carrier_name"] == "ACME S.A."


@pytest.mark.asyncio
async def test_list_queue_no_firma_urls(client, pool, supabase):
    """Firmar en el listado es una llamada HTTP por item: con 2.000 no termina."""
    pool.fetchval.return_value = 1
    pool.fetch.return_value = [
        {
            "id": "i1", "file_name": "a.png", "mime_type": "image/png",
            "size_bytes": 10, "storage_path": "s/1", "match_status": "UNMATCHED",
            "created_at": datetime(2026, 8, 14, tzinfo=timezone.utc),
            "carrier_id": "c1", "carrier_name": "ACME S.A.",
            "confidence": None, "suggested_requirement_name": None, "candidate_count": 0,
        }
    ]
    await client.get("/api/v1/document-ingest/items")
    supabase.storage.from_.assert_not_called()


@pytest.mark.asyncio
async def test_list_queue_filtra_por_empresa(client, pool):
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    await client.get("/api/v1/document-ingest/items?carrier_id=c1")
    sql, *params = pool.fetch.call_args[0]
    assert "c1" in params


@pytest.mark.asyncio
async def test_preview_url_se_firma_de_a_uno(client, pool, supabase):
    pool.fetchval.return_value = "staging/x/foto.png"
    r = await client.get("/api/v1/document-ingest/items/i1/preview-url")
    assert r.status_code == 200
    assert r.json()["preview_url"] is not None


@pytest.mark.asyncio
async def test_preview_url_404_si_no_existe(client, pool):
    pool.fetchval.return_value = None
    r = await client.get("/api/v1/document-ingest/items/nope/preview-url")
    assert r.status_code == 404
```

- [ ] **Step 2: Correr y verificar que fallan**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_document_ingest.py -k "queue or preview_url" -v
```

Esperado: FAIL — las rutas no existen (404).

- [ ] **Step 3: Agregar los schemas**

En `app/schemas/document_ingest.py`:

```python
class QueueRow(BaseModel):
    """Fila de la cola global. Trae su empresa porque la cola las mezcla, y
    trae la sugerencia porque el agente de clasificacion la va a llenar sobre
    este mismo contrato — la columna existe desde ahora para no rehacer la
    pantalla cuando llegue."""
    id: str
    file_name: str
    mime_type: Optional[str] = None
    size_bytes: Optional[int] = None
    storage_path: str
    match_status: MatchStatus
    created_at: datetime
    carrier_id: Optional[str] = None
    carrier_name: Optional[str] = None
    confidence: Optional[float] = None
    suggested_requirement_name: Optional[str] = None
    candidate_count: int = 0


class TrayPage(BaseModel):
    total: int
    rows: list[QueueRow]
```

Agregar `from datetime import date, datetime` al import existente.

- [ ] **Step 4: Implementar las rutas**

En `app/routers/document_ingest.py`, **antes** de `@router.get("/{carrier_id}/items")`
(si no, `/items` cae en el path param y nunca se alcanza):

```python
@router.get("/items", response_model=TrayPage)
async def list_queue(
    carrier_id: str | None = None,
    limit: int = 200,
    offset: int = 0,
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    """La cola global de documentos sin clasificar, agrupada por empresa.

    NO firma URLs. Firmar es una llamada HTTP a Storage por archivo: con los
    2.000 pendientes el request no termina. La vista previa se mira de a un
    archivo por vez, asi que se firma en /items/{id}/preview-url.
    """
    limit = max(1, min(limit, 500))
    where = """
        WHERE i.match_status = 'UNMATCHED'
          AND ($1::uuid IS NULL OR COALESCE(i.carrier_id, b.carrier_id) = $1::uuid)
    """
    total = await pool.fetchval(
        f"""
        SELECT count(*)
        FROM public.document_ingest_items i
        JOIN public.document_ingest_batches b ON b.id = i.batch_id
        {where}
        """,
        carrier_id,
    )
    rows = await pool.fetch(
        f"""
        SELECT i.id::text, i.file_name, i.mime_type, i.size_bytes,
               i.storage_path, i.match_status, i.created_at,
               COALESCE(i.carrier_id, b.carrier_id)::text AS carrier_id,
               c.business_name                            AS carrier_name,
               i.confidence,
               r.name                                     AS suggested_requirement_name,
               jsonb_array_length(i.candidates)           AS candidate_count
        FROM public.document_ingest_items i
        JOIN public.document_ingest_batches b ON b.id = i.batch_id
        LEFT JOIN public.carriers c
               ON c.id = COALESCE(i.carrier_id, b.carrier_id)
        LEFT JOIN public.compliance_requirements r ON r.id = i.requirement_id
        {where}
        ORDER BY c.business_name NULLS LAST, i.created_at
        LIMIT $2 OFFSET $3
        """,
        carrier_id, limit, offset,
    )
    return {"total": total or 0, "rows": [dict(r) for r in rows]}


@router.get("/items/{item_id}/preview-url")
async def get_preview_url(
    item_id: str,
    pool=Depends(get_pool),
    supabase=Depends(get_supabase),
    _=Depends(get_current_user),
):
    """Firma la URL de un solo archivo, al enfocarlo en la bandeja."""
    storage_path = await pool.fetchval(
        "SELECT storage_path FROM public.document_ingest_items WHERE id = $1",
        item_id,
    )
    if not storage_path:
        raise HTTPException(404, "Documento no encontrado")
    return {"preview_url": resolve_signed_url(supabase, storage_path)}
```

Importar `TrayPage` y `QueueRow` desde los schemas.

**`GET /{carrier_id}/items` queda como está** — todavía la usa `UnclassifiedTray`.
Se retira en la Task 17, cuando no le quede ningún llamador.

- [ ] **Step 5: Verificar contra la base real**

El SQL es nuevo; los mocks no detectan una columna inexistente (ya pasó dos
veces en este proyecto). Correr vía MCP de Supabase:

```sql
SELECT i.id::text, i.file_name, COALESCE(i.carrier_id, b.carrier_id)::text AS carrier_id,
       c.business_name AS carrier_name, i.confidence,
       r.name AS suggested_requirement_name,
       jsonb_array_length(i.candidates) AS candidate_count
FROM public.document_ingest_items i
JOIN public.document_ingest_batches b ON b.id = i.batch_id
LEFT JOIN public.carriers c ON c.id = COALESCE(i.carrier_id, b.carrier_id)
LEFT JOIN public.compliance_requirements r ON r.id = i.requirement_id
WHERE i.match_status = 'UNMATCHED'
ORDER BY c.business_name NULLS LAST, i.created_at
LIMIT 5;
```

Esperado: corre sin error y devuelve `carrier_name` poblado.

- [ ] **Step 6: Correr los tests**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/ -v
```

Esperado: todo verde, 5 tests nuevos.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/backend/api
git commit -m "feat(compliance): cola global de sin clasificar, sin firmar en el listado

Firmar la URL de cada archivo en el listado es una llamada HTTP por item:
con los 2.000 pendientes el request no termina. La vista previa se mira de
a uno, asi que la firma pasa a /items/{id}/preview-url.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 13: Cliente y tipos de la cola global

**Files:**
- Modify: `monitor-app/frontend/lib/types.ts`
- Modify: `monitor-app/frontend/lib/api/documentIngest.ts`
- Modify: `monitor-app/frontend/lib/api/documentIngest.test.ts`

**Interfaces:**
- Produces:
```ts
export type QueueRow = {
  id: string; file_name: string; mime_type: string | null
  size_bytes: number | null; storage_path: string
  match_status: IngestMatchStatus; created_at: string
  carrier_id: string | null; carrier_name: string | null
  confidence: number | null; suggested_requirement_name: string | null
  candidate_count: number
}
export type TrayPage = { total: number; rows: QueueRow[] }

documentIngestApi.listQueue(params?: { carrierId?: string; limit?: number; offset?: number }): Promise<TrayPage>
documentIngestApi.previewUrl(itemId: string): Promise<{ preview_url: string | null }>
```

- [ ] **Step 1: Escribir el test que falla**

En `lib/api/documentIngest.test.ts`:

```ts
it('listQueue arma el query string solo con lo que viene', async () => {
  const spy = vi.mocked(apiFetch).mockResolvedValue({ total: 0, rows: [] })
  await documentIngestApi.listQueue({ carrierId: 'c1', limit: 50 })
  expect(spy).toHaveBeenCalledWith('/api/v1/document-ingest/items?carrier_id=c1&limit=50')
})

it('listQueue sin parámetros pide la cola completa', async () => {
  const spy = vi.mocked(apiFetch).mockResolvedValue({ total: 0, rows: [] })
  await documentIngestApi.listQueue()
  expect(spy).toHaveBeenCalledWith('/api/v1/document-ingest/items')
})

it('previewUrl firma un solo archivo', async () => {
  const spy = vi.mocked(apiFetch).mockResolvedValue({ preview_url: 'https://x/1' })
  await documentIngestApi.previewUrl('i1')
  expect(spy).toHaveBeenCalledWith('/api/v1/document-ingest/items/i1/preview-url')
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/frontend && npx vitest run lib/api/documentIngest.test.ts
```

Esperado: FAIL — `listQueue` no existe.

- [ ] **Step 3: Implementar**

En `lib/types.ts`, junto a `TrayItem`:

```ts
/** Fila de la cola global. `carrier_name` viene del servidor porque la cola
 *  mezcla empresas y se agrupa por ese valor. Los campos de sugerencia hoy
 *  llegan vacios: los llena el agente de clasificacion cuando exista. */
export type QueueRow = {
  id:                         string
  file_name:                  string
  mime_type:                  string | null
  size_bytes:                 number | null
  storage_path:               string
  match_status:               IngestMatchStatus
  created_at:                 string
  carrier_id:                 string | null
  carrier_name:               string | null
  confidence:                 number | null
  suggested_requirement_name: string | null
  candidate_count:            number
}

export type TrayPage = { total: number; rows: QueueRow[] }
```

En `lib/api/documentIngest.ts`:

```ts
  /** La cola global de sin clasificar. Sin `carrierId` trae todas las empresas. */
  listQueue: (params: { carrierId?: string; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams()
    if (params.carrierId) qs.set('carrier_id', params.carrierId)
    if (params.limit != null)  qs.set('limit',  String(params.limit))
    if (params.offset != null) qs.set('offset', String(params.offset))
    const suffix = qs.toString() ? `?${qs}` : ''
    return apiFetch<TrayPage>(`/api/v1/document-ingest/items${suffix}`)
  },

  /** Firma la vista previa de un archivo. Se pide al enfocarlo, no al listar. */
  previewUrl: (itemId: string) =>
    apiFetch<{ preview_url: string | null }>(
      `/api/v1/document-ingest/items/${itemId}/preview-url`,
    ),
```

- [ ] **Step 4: Verificar**

```bash
cd monitor-app/frontend && npx vitest run lib/api/documentIngest.test.ts && npx tsc --noEmit
```

Esperado: PASS y `tsc` limpio.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/lib
git commit -m "feat(compliance): cliente de la cola global y de la firma diferida

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 14: La tabla de la bandeja

Reemplaza a `TriageFileList`. Columnas, agrupación por empresa, rango con `⇧`,
y la columna Sugerencia que hoy muestra un guion.

**Files:**
- Create: `monitor-app/frontend/components/compliance/TriageFileTable.tsx`
- Create: `monitor-app/frontend/components/compliance/TriageFileTable.test.tsx`
- Delete: `components/compliance/TriageFileList.tsx` y su test

**Interfaces:**
- Produces:
```ts
export function TriageFileTable(props: {
  rows:        QueueRow[]
  focusedId:   string | null
  selectedIds: Set<string>
  onFocus:     (id: string) => void
  onToggle:    (id: string, opts?: { range?: boolean }) => void
  onToggleAll: () => void
}): JSX.Element
```

`onDiscard` sale de la fila: descartar pasa a la barra contextual (Task 15).

- [ ] **Step 1: Escribir el test que falla**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ComponentProps } from 'react'
import { TriageFileTable } from './TriageFileTable'

const row = (id: string, carrier: string, over: Record<string, unknown> = {}) => ({
  id, file_name: `${id}.png`, mime_type: 'image/png', size_bytes: 10,
  storage_path: `s/${id}`, match_status: 'UNMATCHED' as const,
  created_at: '2026-08-14T10:00:00Z',
  carrier_id: carrier.toLowerCase(), carrier_name: carrier,
  confidence: null, suggested_requirement_name: null, candidate_count: 0,
  ...over,
})

const ROWS = [row('i1', 'ACME'), row('i2', 'ACME'), row('i3', 'NORTE')]

function setup(over: Record<string, unknown> = {}) {
  const props = {
    rows: ROWS, focusedId: 'i1', selectedIds: new Set<string>(),
    onFocus: vi.fn(), onToggle: vi.fn(), onToggleAll: vi.fn(),
    ...over,
  }
  render(<TriageFileTable {...(props as unknown as ComponentProps<typeof TriageFileTable>)} />)
  return props
}

describe('TriageFileTable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('agrupa las filas por empresa', () => {
    setup()
    expect(screen.getByText(/ACME — 2 sin clasificar/i)).toBeInTheDocument()
    expect(screen.getByText(/NORTE — 1 sin clasificar/i)).toBeInTheDocument()
  })

  it('muestra las columnas de la tabla', () => {
    setup()
    expect(screen.getByRole('columnheader', { name: /archivo/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /subido/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /sugerencia/i })).toBeInTheDocument()
  })

  it('sin agente, la sugerencia es un guion', () => {
    setup()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('muestra la sugerencia cuando el agente la dejo', () => {
    setup({ rows: [row('i1', 'ACME', {
      match_status: 'SUGGESTED', suggested_requirement_name: 'Padrón', confidence: 0.91,
    })] })
    expect(screen.getByText(/Padrón/)).toBeInTheDocument()
    expect(screen.getByText(/91%/)).toBeInTheDocument()
  })

  it('avisa cuantas alternativas hay si es ambiguo', () => {
    setup({ rows: [row('i1', 'ACME', { match_status: 'AMBIGUOUS', candidate_count: 3 })] })
    expect(screen.getByText(/3 posibles/i)).toBeInTheDocument()
  })

  it('shift+click selecciona el rango', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('checkbox', { name: /Seleccionar i3/ }), { shiftKey: true })
    expect(p.onToggle).toHaveBeenCalledWith('i3', { range: true })
  })

  it('mueve el foco con las flechas', () => {
    const p = setup()
    fireEvent.keyDown(screen.getByRole('table'), { key: 'ArrowDown' })
    expect(p.onFocus).toHaveBeenCalledWith('i2')
  })

  it('marca con la barra espaciadora', () => {
    const p = setup()
    fireEvent.keyDown(screen.getByRole('table'), { key: ' ' })
    expect(p.onToggle).toHaveBeenCalledWith('i1', undefined)
  })

  it('avisa cuando no queda nada por clasificar', () => {
    setup({ rows: [] })
    expect(screen.getByText(/no hay documentos sin clasificar/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/TriageFileTable.test.tsx
```

Esperado: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

```tsx
'use client'

import { FileQuestion } from 'lucide-react'
import type { QueueRow } from '@/lib/types'

interface Props {
  rows:        QueueRow[]
  focusedId:   string | null
  selectedIds: Set<string>
  onFocus:     (id: string) => void
  onToggle:    (id: string, opts?: { range?: boolean }) => void
  onToggleAll: () => void
}

/** Panel izquierdo de la bandeja: la cola, como tabla.
 *
 *  Es tabla y no lista porque una columna de nombres de archivo no se escanea
 *  ni se ordena, y sin eso no hay trabajo masivo posible. La columna
 *  Sugerencia hoy muestra un guion: la llena el agente de clasificacion
 *  cuando exista, sobre el mismo contrato. */
export function TriageFileTable({
  rows, focusedId, selectedIds, onFocus, onToggle, onToggleAll,
}: Props) {
  function handleKey(e: React.KeyboardEvent) {
    if (!rows.length) return
    const i = rows.findIndex(r => r.id === focusedId)
    const cur = i < 0 ? 0 : i

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      onFocus(rows[Math.min(cur + 1, rows.length - 1)].id)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      onFocus(rows[Math.max(cur - 1, 0)].id)
    } else if (e.key === ' ') {
      e.preventDefault()
      onToggle(rows[cur].id, e.shiftKey ? { range: true } : undefined)
    }
  }

  if (!rows.length) {
    return (
      <div className="p-6 text-center">
        <FileQuestion size={20} className="mx-auto text-gray-300 mb-2" />
        <p className="text-xs text-gray-400">No hay documentos sin clasificar</p>
      </div>
    )
  }

  const allSelected = rows.every(r => selectedIds.has(r.id))

  // Las filas ya vienen ordenadas por empresa desde el servidor, asi que el
  // encabezado de grupo se emite cuando cambia el nombre.
  const counts = new Map<string, number>()
  for (const r of rows) {
    const k = r.carrier_name ?? 'Sin empresa'
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }

  let lastCarrier: string | null = null

  return (
    <table
      className="w-full text-left focus:outline-none focus:ring-2 focus:ring-accent/40 rounded-lg"
      tabIndex={0}
      onKeyDown={handleKey}
    >
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="p-1.5 w-8">
            <input
              type="checkbox"
              aria-label="Seleccionar todos"
              checked={allSelected}
              onChange={onToggleAll}
            />
          </th>
          <th scope="col" className="p-1.5 text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Archivo</th>
          <th scope="col" className="p-1.5 text-[10px] uppercase tracking-wide text-gray-400 font-semibold w-16">Subido</th>
          <th scope="col" className="p-1.5 text-[10px] uppercase tracking-wide text-gray-400 font-semibold w-32">Sugerencia</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const carrier = r.carrier_name ?? 'Sin empresa'
          const header = carrier !== lastCarrier ? carrier : null
          lastCarrier = carrier
          const focused = r.id === focusedId
          const checked = selectedIds.has(r.id)

          return (
            <>
              {header && (
                <tr key={`g-${carrier}`} className="bg-gray-50">
                  <td colSpan={4} className="px-1.5 py-1 text-[10px] font-semibold text-gray-500 tracking-wide">
                    {carrier} — {counts.get(carrier)} sin clasificar
                  </td>
                </tr>
              )}
              <tr
                key={r.id}
                onClick={() => onFocus(r.id)}
                aria-selected={checked}
                className={`cursor-pointer transition-colors ${
                  focused ? 'bg-accent/10' : 'hover:bg-gray-50'
                }`}
              >
                <td className="p-1.5">
                  <input
                    type="checkbox"
                    aria-label={`Seleccionar ${r.file_name}`}
                    checked={checked}
                    onChange={() => {}}
                    onClick={e => {
                      e.stopPropagation()
                      onToggle(r.id, e.shiftKey ? { range: true } : undefined)
                    }}
                  />
                </td>
                <td className="p-1.5 text-[11px] font-mono truncate max-w-0">{r.file_name}</td>
                <td className="p-1.5 text-[11px] text-gray-400">
                  {new Date(r.created_at).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' })}
                </td>
                <td className="p-1.5 text-[11px]">
                  <Suggestion row={r} />
                </td>
              </tr>
            </>
          )
        })}
      </tbody>
    </table>
  )
}

/** Hoy siempre devuelve un guion: ningun item llega con match. El lugar existe
 *  desde ahora para que la llegada del agente no obligue a rehacer la fila. */
function Suggestion({ row }: { row: QueueRow }) {
  if (row.match_status === 'AMBIGUOUS' && row.candidate_count > 0) {
    return <span className="text-amber-600">{row.candidate_count} posibles</span>
  }
  if (row.suggested_requirement_name) {
    return (
      <span className="text-green-700">
        {row.suggested_requirement_name}
        {row.confidence != null && (
          <span className="text-gray-400 ml-1">{Math.round(row.confidence * 100)}%</span>
        )}
      </span>
    )
  }
  return <span className="text-gray-300">—</span>
}
```

**Nota para quien implemente**: el `<>…</>` dentro de `.map()` necesita
`key` en el fragmento — usar `<Fragment key={r.id}>` importando `Fragment`
de `react`, no el atajo `<>`. `tsc` lo marca si se olvida.

- [ ] **Step 4: Borrar el componente que reemplaza**

```bash
git rm monitor-app/frontend/components/compliance/TriageFileList.tsx \
       monitor-app/frontend/components/compliance/TriageFileList.test.tsx
```

- [ ] **Step 5: Verificar**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/TriageFileTable.test.tsx && npx tsc --noEmit
```

Esperado: 9 tests PASS. `tsc` va a fallar en `TriageWorkbench` porque todavía
importa `TriageFileList` — se arregla en la Task 16, que es la que lo reescribe.
Si preferís no dejar el árbol roto entre tareas, hacé las Tasks 14-16 en una
sola sesión y commiteá al final de la 16.

- [ ] **Step 6: Commit**

```bash
git add -A monitor-app/frontend/components/compliance
git commit -m "feat(compliance): la cola es una tabla con columnas y rango con shift

Una columna unica de nombres de archivo no se escanea ni se ordena. La
columna Sugerencia queda construida aunque hoy muestre un guion: el esquema
ya tiene match_status/confidence/candidates y el agente los va a llenar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 15: La barra contextual de acciones

**Files:**
- Create: `monitor-app/frontend/components/compliance/TriageBulkBar.tsx`
- Create: `monitor-app/frontend/components/compliance/TriageBulkBar.test.tsx`

**Interfaces:**
- Consumes: `MoveToCarrierBar` (Task 8).
- Produces:
```ts
export function TriageBulkBar(props: {
  selectedCount:    number
  targetIds:        string[]
  currentCarrierId: string | null
  onDiscard:        () => void
  onClear:          () => void
  onMoved:          () => void
}): JSX.Element | null
```

- [ ] **Step 1: Escribir el test que falla**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'
import { TriageBulkBar } from './TriageBulkBar'

vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: { moveItems: vi.fn().mockResolvedValue({ moved: 2 }) },
}))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { list: vi.fn().mockResolvedValue({ data: [] }) },
}))

function setup(over: Record<string, unknown> = {}) {
  const props = {
    selectedCount: 3, targetIds: ['i1', 'i2', 'i3'], currentCarrierId: 'c1',
    onDiscard: vi.fn(), onClear: vi.fn(), onMoved: vi.fn(), ...over,
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TriageBulkBar {...(props as never)} />
    </QueryClientProvider>,
  )
  return props
}

describe('TriageBulkBar', () => {
  it('no aparece sin seleccion', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <TriageBulkBar
          selectedCount={0} targetIds={[]} currentCarrierId={null}
          onDiscard={vi.fn()} onClear={vi.fn()} onMoved={vi.fn()}
        />
      </QueryClientProvider>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('dice cuantos hay seleccionados', () => {
    setup()
    expect(screen.getByText(/3 seleccionados/i)).toBeInTheDocument()
  })

  it('descartar pide confirmacion en la barra, no en un modal', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: /^descartar$/i }))
    expect(p.onDiscard).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText(/se borran definitivamente/i)).toBeInTheDocument()
  })

  it('descarta al confirmar', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: /^descartar$/i }))
    fireEvent.click(screen.getByRole('button', { name: /si, descartar 3/i }))
    expect(p.onDiscard).toHaveBeenCalled()
  })

  it('se puede arrepentir', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: /^descartar$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^cancelar$/i }))
    expect(p.onDiscard).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^descartar$/i })).toBeInTheDocument()
  })

  it('deselecciona', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: /deseleccionar/i }))
    expect(p.onClear).toHaveBeenCalled()
  })

  it('ofrece mover cuando la seleccion es de una sola empresa', () => {
    setup()
    expect(screen.getByRole('button', { name: /mover 3 a otra empresa/i })).toBeInTheDocument()
  })

  it('no ofrece mover si la seleccion cruza empresas', () => {
    setup({ currentCarrierId: null })
    expect(screen.queryByRole('button', { name: /mover/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/TriageBulkBar.test.tsx
```

Esperado: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

```tsx
'use client'

import { useState } from 'react'
import { Trash2, X } from 'lucide-react'
import { MoveToCarrierBar } from './MoveToCarrierBar'

interface Props {
  selectedCount:    number
  targetIds:        string[]
  /** null = la seleccion cruza empresas; mover exige un origen unico. */
  currentCarrierId: string | null
  onDiscard:        () => void
  onClear:          () => void
  onMoved:          () => void
}

/** Barra contextual: aparece al seleccionar y dice cuantos son.
 *
 *  Es el estandar de Gmail, Linear, Airtable y Salesforce Lightning, y es
 *  donde viven mover y descartar — antes escondidos en el panel derecho. */
export function TriageBulkBar({
  selectedCount, targetIds, currentCarrierId, onDiscard, onClear, onMoved,
}: Props) {
  const [confirming, setConfirming] = useState(false)

  if (!selectedCount) return null

  return (
    <div className="flex items-center gap-3 flex-wrap bg-accent text-white rounded-lg px-3 py-2">
      <span className="text-xs font-bold bg-white/20 rounded px-2 py-0.5">
        {selectedCount} seleccionados
      </span>

      {currentCarrierId && !confirming && (
        <MoveToCarrierBar
          targetIds={targetIds}
          currentCarrierId={currentCarrierId}
          onMoved={onMoved}
        />
      )}

      {/* Descartar borra el blob de staging: no hay nada que restaurar
          despues. Por eso confirma — pero en la barra, no en un modal, que
          es lo que haria insoportable vaciar una bandeja de dos mil. */}
      {confirming ? (
        <>
          <span className="text-[11px]">Se borran definitivamente</span>
          <button
            type="button"
            onClick={() => { setConfirming(false); onDiscard() }}
            className="text-[11px] font-bold bg-white text-accent rounded px-2 py-0.5"
          >
            Sí, descartar {selectedCount}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-[11px] font-semibold opacity-75 hover:opacity-100 transition-opacity"
          >
            Cancelar
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="flex items-center gap-1.5 text-[11px] font-semibold hover:opacity-80 transition-opacity"
        >
          <Trash2 size={12} /> Descartar
        </button>
      )}

      <button
        type="button"
        onClick={onClear}
        className="flex items-center gap-1.5 text-[11px] font-semibold ml-auto opacity-75 hover:opacity-100 transition-opacity"
      >
        <X size={12} /> Deseleccionar
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Verificar**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/TriageBulkBar.test.tsx
```

Esperado: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/compliance
git commit -m "feat(compliance): barra contextual de acciones en lote

Aparece al seleccionar y dice cuantos son. Mover y descartar salen del panel
derecho, que es donde estaban escondidos.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 16: La bandeja en su lugar definitivo

Reescribe `TriageWorkbench` sobre la cola global y la monta en
`/dashboard/compliance/inbox`, con su ítem de sidebar y contador.

**Files:**
- Modify: `monitor-app/frontend/components/compliance/TriageWorkbench.tsx`
- Modify: `monitor-app/frontend/components/compliance/TriageWorkbench.test.tsx`
- Create: `monitor-app/frontend/app/dashboard/compliance/inbox/page.tsx`
- Create: `monitor-app/frontend/app/dashboard/compliance/inbox/page.test.tsx`
- Modify: `monitor-app/frontend/components/dashboard/Sidebar.tsx`

**Interfaces:**
- Consumes: `documentIngestApi.listQueue`, `documentIngestApi.previewUrl`,
  `TriageFileTable`, `TriageBulkBar`, `TriageClassifyForm`, `TriagePreview`.
- Produces:
```ts
export function TriageWorkbench(props: {
  /** Sin empresa = cola global (la bandeja). Con empresa = acotada (la ficha, Task 10). */
  carrierId?:   string
  carrierName?: string
}): JSX.Element
```

- [ ] **Step 1: Escribir los tests que fallan**

Reemplazar `TriageWorkbench.test.tsx` por:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TriageWorkbench } from './TriageWorkbench'

vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: {
    listQueue: vi.fn(), previewUrl: vi.fn(), upload: vi.fn(),
    remove: vi.fn(), classifyBatch: vi.fn(), moveItems: vi.fn(),
  },
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listPending: vi.fn(), listRequirements: vi.fn() },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))
import { documentIngestApi } from '@/lib/api/documentIngest'
import { complianceApi } from '@/lib/api/compliance'

const row = (id: string, carrier: string) => ({
  id, file_name: `${id}.png`, mime_type: 'image/png', size_bytes: 10,
  storage_path: `s/${id}`, match_status: 'UNMATCHED' as const,
  created_at: '2026-08-14T10:00:00Z',
  carrier_id: carrier.toLowerCase(), carrier_name: carrier,
  confidence: null, suggested_requirement_name: null, candidate_count: 0,
})

function setup(props: Record<string, unknown> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <TriageWorkbench {...(props as never)} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(documentIngestApi.listQueue).mockReset().mockResolvedValue({
    total: 2, rows: [row('i1', 'ACME'), row('i2', 'NORTE')],
  })
  vi.mocked(documentIngestApi.previewUrl).mockReset()
    .mockResolvedValue({ preview_url: 'https://x/1' })
  vi.mocked(complianceApi.listPending).mockReset().mockResolvedValue({
    total: 1,
    rows: [{
      id: 'r1', carrier_id: 'acme', carrier_name: 'ACME', carrier_tax_id: '1-9',
      carrier_operation_types: [], certification_type: 'BASICA', category: 'EQUIPO',
      entity_type: 'ASSET', entity_id: 'a1', subject_name: 'HKXW55',
      requirement_code: 'PADRON', document_name: 'Padrón',
      status: 'MISSING', expiration_date: null,
    }],
  })
  vi.mocked(complianceApi.listRequirements).mockReset().mockResolvedValue([])
})

describe('TriageWorkbench', () => {
  it('sin empresa pide la cola completa', async () => {
    setup()
    await screen.findByText('i1.png')
    expect(documentIngestApi.listQueue).toHaveBeenCalledWith(
      expect.objectContaining({ carrierId: undefined }),
    )
  })

  it('con empresa acota la cola a esa empresa', async () => {
    setup({ carrierId: 'acme', carrierName: 'ACME' })
    await screen.findByText('i1.png')
    expect(documentIngestApi.listQueue).toHaveBeenCalledWith(
      expect.objectContaining({ carrierId: 'acme' }),
    )
  })

  it('no abre ningun modal', async () => {
    setup()
    await screen.findByText('i1.png')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('la barra contextual aparece al seleccionar', async () => {
    setup()
    await screen.findByText('i1.png')
    fireEvent.click(screen.getByRole('checkbox', { name: /i1\.png/ }))
    expect(await screen.findByText(/1 seleccionados/i)).toBeInTheDocument()
  })

  it('marcar un archivo de otra empresa reemplaza la seleccion', async () => {
    setup()
    await screen.findByText('i1.png')
    fireEvent.click(screen.getByRole('checkbox', { name: /i1\.png/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /i2\.png/ }))

    // El formulario aplica un requisito de UNA entidad: mezclar empresas
    // dejaria la eleccion de sujeto sin sentido.
    expect(await screen.findByText(/1 seleccionados/i)).toBeInTheDocument()
  })

  it('pide la url firmada solo del archivo enfocado', async () => {
    setup()
    await screen.findByText('i1.png')
    fireEvent.click(screen.getByText('i1.png'))
    await waitFor(() => {
      expect(documentIngestApi.previewUrl).toHaveBeenCalledWith('i1')
    })
    expect(documentIngestApi.previewUrl).toHaveBeenCalledTimes(1)
  })

  it('deriva los sujetos de la empresa de la seleccion', async () => {
    setup()
    await screen.findByText('i1.png')
    fireEvent.click(screen.getByRole('checkbox', { name: /i1\.png/ }))
    await waitFor(() => {
      expect(complianceApi.listPending).toHaveBeenCalledWith(
        expect.objectContaining({ carrierId: 'acme' }),
      )
    })
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/TriageWorkbench.test.tsx
```

Esperado: FAIL — sigue usando `listTray` y `TriageFileList`.

- [ ] **Step 3: Reescribir `TriageWorkbench.tsx`**

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, UploadCloud } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { documentIngestApi } from '@/lib/api/documentIngest'
import { useCanEdit } from '@/hooks/useCanEdit'
import { TriageBulkBar } from './TriageBulkBar'
import { TriageClassifyForm } from './TriageClassifyForm'
import { TriageFileTable } from './TriageFileTable'
import { TriagePreview } from './TriagePreview'

interface Props {
  /** Sin empresa = la cola global (la bandeja). Con empresa = acotada a esa
   *  empresa (la ficha). Es una sola prop opcional, no dos modos. */
  carrierId?:   string
  carrierName?: string
}

const QUEUE_PAGE = 200

export function TriageWorkbench({ carrierId, carrierName }: Props) {
  const qc = useQueryClient()
  const canEdit = useCanEdit()
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [dragging, setDragging] = useState(false)
  const [errors, setErrors] = useState<{ file_name: string; error: string }[]>([])
  const [notice, setNotice] = useState<string | null>(null)

  const queueKey = ['ingest-queue', carrierId ?? 'all']
  const queueQuery = useQuery({
    queryKey: queueKey,
    queryFn: () => documentIngestApi.listQueue({ carrierId, limit: QUEUE_PAGE }),
  })

  const rows = queueQuery.data?.rows ?? []
  const total = queueQuery.data?.total ?? 0

  // La empresa de la seleccion. El formulario aplica un requisito de UNA
  // entidad, asi que una seleccion que cruza empresas no tiene sentido: al
  // marcar un archivo de otra empresa la seleccion se reemplaza.
  const selectedCarrierId = useMemo(() => {
    const sel = rows.filter(r => selectedIds.has(r.id))
    if (!sel.length) return null
    const first = sel[0].carrier_id
    return sel.every(r => r.carrier_id === first) ? first : null
  }, [rows, selectedIds])

  const subjectCarrierId = selectedCarrierId
    ?? (focusedId ? rows.find(r => r.id === focusedId)?.carrier_id ?? null : null)

  const pendingQuery = useQuery({
    queryKey: ['compliance-pending-carrier-panel', subjectCarrierId],
    queryFn: () => complianceApi.listPending({ carrierId: subjectCarrierId!, limit: 200 }),
    enabled: !!subjectCarrierId,
  })

  const subjects = useMemo(() => {
    const seen = new Map<string, { entity_type: 'CARRIER' | 'DRIVER' | 'ASSET'; entity_id: string; label: string }>()
    for (const r of pendingQuery.data?.rows ?? []) {
      const key = `${r.entity_type}:${r.entity_id}`
      if (!seen.has(key)) {
        seen.set(key, {
          entity_type: r.entity_type as 'CARRIER' | 'DRIVER' | 'ASSET',
          entity_id: r.entity_id,
          label: r.subject_name ?? r.carrier_name,
        })
      }
    }
    return Array.from(seen.values())
  }, [pendingQuery.data])

  // Con nada marcado, el formulario opera sobre el archivo enfocado.
  const targetIds = selectedIds.size > 0
    ? rows.filter(r => selectedIds.has(r.id)).map(r => r.id)
    : (focusedId ? [focusedId] : [])

  // La vista previa se firma de a una, al enfocar — firmar el listado entero
  // es una llamada HTTP por archivo.
  const previewQuery = useQuery({
    queryKey: ['ingest-preview', focusedId],
    queryFn: () => documentIngestApi.previewUrl(focusedId!),
    enabled: !!focusedId && targetIds.length === 1,
  })

  const previewItems = rows
    .filter(r => targetIds.includes(r.id))
    .map(r => ({
      id: r.id, file_name: r.file_name, mime_type: r.mime_type,
      size_bytes: r.size_bytes, storage_path: r.storage_path,
      match_status: r.match_status,
      preview_url: r.id === focusedId ? previewQuery.data?.preview_url ?? null : null,
    }))

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => documentIngestApi.upload(carrierId!, files),
    onSuccess: res => { setErrors(res.errors); qc.invalidateQueries({ queryKey: queueKey }) },
  })
  const discardMutation = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map(id => documentIngestApi.remove(id))),
    onSuccess: (_r, ids) => {
      setNotice(`${ids.length} descartados`)
      clearSelection()
      qc.invalidateQueries({ queryKey: queueKey })
    },
  })

  function clearSelection() {
    setSelectedIds(new Set())
    setFocusedId(null)
  }

  function handleFiles(list: FileList | null) {
    const files = Array.from(list ?? [])
    if (files.length) uploadMutation.mutate(files)
  }

  function handleToggle(id: string, opts?: { range?: boolean }) {
    setSelectedIds(prev => {
      const rowCarrier = rows.find(r => r.id === id)?.carrier_id ?? null
      const current = rows.filter(r => prev.has(r.id))
      const crossesCarrier = current.length > 0 && current.some(r => r.carrier_id !== rowCarrier)

      // Cruzar empresas reemplaza la seleccion en vez de sumarse.
      if (crossesCarrier) return new Set([id])

      if (opts?.range && focusedId) {
        const a = rows.findIndex(r => r.id === focusedId)
        const b = rows.findIndex(r => r.id === id)
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          const next = new Set(prev)
          for (const r of rows.slice(lo, hi + 1)) {
            if (r.carrier_id === rowCarrier) next.add(r.id)
          }
          return next
        }
      }

      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setFocusedId(id)
  }

  function handleApplied(appliedIds: string[]) {
    setNotice(`${appliedIds.length} clasificados · ${Math.max(total - appliedIds.length, 0)} restantes`)
    clearSelection()
    qc.invalidateQueries({ queryKey: queueKey })
    qc.invalidateQueries({ queryKey: ['compliance-pending-carrier-panel', subjectCarrierId] })
    qc.invalidateQueries({ queryKey: ['compliance-pending'] })
  }

  return (
    <div className="space-y-3">
      {/* Subir exige una empresa: la cola global no sabe a quien atribuir el
          archivo. Desde la ficha (con carrierId) siempre esta disponible. */}
      {canEdit && carrierId && (
        <label
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
          className={`flex items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-3 cursor-pointer transition-colors ${
            dragging ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50'
          }`}
        >
          {uploadMutation.isPending
            ? <Loader2 size={16} className="animate-spin text-accent" />
            : <UploadCloud size={16} className="text-gray-400" />}
          <span className="text-[11px] text-gray-500">
            Arrastrá acá los documentos de {carrierName}
          </span>
          <input
            type="file" multiple className="hidden"
            aria-label={`Arrastrá acá los documentos de ${carrierName}`}
            onChange={e => handleFiles(e.target.files)}
          />
        </label>
      )}

      {errors.map(e => (
        <p key={e.file_name} className="text-[10px] text-red-500">{e.file_name}: {e.error}</p>
      ))}

      {canEdit && (
        <TriageBulkBar
          selectedCount={selectedIds.size}
          targetIds={targetIds}
          currentCarrierId={selectedCarrierId}
          onDiscard={() => discardMutation.mutate(targetIds)}
          onClear={clearSelection}
          onMoved={() => { setNotice('Documentos movidos'); clearSelection() }}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-3">
        <div className="border border-border rounded-lg overflow-y-auto max-h-[58vh]">
          {queueQuery.isPending ? (
            <p className="text-[11px] text-gray-400 p-3 flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin" /> Cargando…
            </p>
          ) : (
            <TriageFileTable
              rows={rows}
              focusedId={focusedId}
              selectedIds={selectedIds}
              onFocus={setFocusedId}
              onToggle={handleToggle}
              onToggleAll={() => setSelectedIds(prev =>
                prev.size === rows.length ? new Set() : new Set(rows.map(r => r.id)),
              )}
            />
          )}
        </div>

        <div className="border border-border rounded-lg p-3 space-y-3">
          <TriageClassifyForm
            targetIds={canEdit ? targetIds : []}
            subjects={subjects}
            onApplied={handleApplied}
          />
          <TriagePreview items={previewItems} />
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[10px] text-gray-400 font-mono">
          ↑↓ mover · space marcar · ⇧+click rango · ↵ aplicar
        </p>
        {rows.length < total && (
          <p className="text-[10px] text-gray-400">
            Mostrando {rows.length} de {total}
          </p>
        )}
      </div>

      {notice && (
        <div className="inline-flex items-center gap-3 bg-gray-900 text-white text-[11px] rounded-lg px-3 py-1.5">
          {notice}
          <button type="button" onClick={() => setNotice(null)} className="opacity-70 hover:opacity-100">
            Cerrar
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Crear la página de la bandeja**

`app/dashboard/compliance/inbox/page.tsx`:

```tsx
'use client'

import { TriageWorkbench } from '@/components/compliance/TriageWorkbench'

/** La bandeja de documentos sin clasificar — destino propio, no un tab.
 *
 *  Es la cola de trabajo de la HU-04: se entra y el trabajo esta ahi,
 *  agrupado por empresa. La empresa es un filtro de la tabla, no un requisito
 *  previo — una bandeja que arranca vacia es un buscador. */
export default function ComplianceInboxPage() {
  return (
    <div className="p-4 md:p-6 space-y-3">
      <div>
        <h1 className="font-mulish font-bold text-xl text-text-primary">Bandeja</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Documentos cargados que todavía no están asignados a un requisito.
        </p>
      </div>
      <TriageWorkbench />
    </div>
  )
}
```

`app/dashboard/compliance/inbox/page.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'
import ComplianceInboxPage from './page'

vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: {
    listQueue: vi.fn().mockResolvedValue({ total: 0, rows: [] }),
    previewUrl: vi.fn(), upload: vi.fn(), remove: vi.fn(),
    classifyBatch: vi.fn(), moveItems: vi.fn(),
  },
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: {
    listPending: vi.fn().mockResolvedValue({ total: 0, rows: [] }),
    listRequirements: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))

describe('ComplianceInboxPage', () => {
  it('muestra la bandeja vacia con un mensaje util', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ComplianceInboxPage />
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/no hay documentos sin clasificar/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 5: Agregar `Bandeja` al sidebar, con contador**

**Va como ítem de primer nivel en `NAV_ITEMS`, no como sub-ítem de
Certificación.** El motivo es concreto: `MONITOR_GROUP` es el único grupo del
Sidebar y su render son ~55 líneas de markup especializado (`Sidebar.tsx:139-186`)
con estado propio (`monitorOpen`, `monitorActiveHref`). Un segundo grupo obliga a
duplicar esas 55 líneas o a generalizar el Sidebar entero — refactor que no pide
nadie. Y de paso, primer nivel dice más fuerte lo que se quería decir: la bandeja
de Gmail tampoco cuelga de un módulo. `NAV_ITEMS` ya se renderiza en un `.map`,
así que el badge sale con un cambio chico.

En `Sidebar.tsx`, agregar el ítem con su badge opcional:

```tsx
const NAV_ITEMS: {
  href: string; label: string; icon: LucideIcon; badge?: 'inbox'
}[] = [
  { href: '/dashboard/carriers',        label: 'Empresas',      icon: Building2 },
  { href: '/dashboard/insurance',       label: 'Seguros',       icon: Shield },
  { href: '/dashboard/pricing',         label: 'Tarifario',     icon: Receipt },
  { href: '/dashboard/compliance',      label: 'Certificación', icon: BadgeCheck },
  // La cola de sin clasificar es trabajo pendiente, no una vista del modulo:
  // por eso va al mismo nivel y con contador.
  { href: '/dashboard/compliance/inbox', label: 'Bandeja', icon: Inbox, badge: 'inbox' },
]
```

Importar `Inbox` de `lucide-react` y `LucideIcon` como tipo.

**Cuidado con el orden de `activeHref`**: ya resuelve el match más específico
primero (`.sort((a, b) => b.length - a.length)`), así que
`/dashboard/compliance/inbox` gana sobre `/dashboard/compliance` sin tocar nada.

Dentro del componente, el contador:

```tsx
  // El total de la cola. Se pide con limit=1: solo interesa `total`.
  const inboxCount = useQuery({
    queryKey: ['ingest-queue-count'],
    queryFn: () => documentIngestApi.listQueue({ limit: 1 }),
    staleTime: 60_000,
  }).data?.total ?? 0
```

Y en el `.map` de `NAV_ITEMS`, después del `<span>` de la etiqueta:

```tsx
{badge === 'inbox' && inboxCount > 0 && !collapsed && (
  <span className="ml-auto bg-red-500 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5">
    {inboxCount}
  </span>
)}
```

desestructurando `badge` junto a `href, label, icon: Icon`.

- [ ] **Step 5b: Test del sidebar**

En `components/dashboard/Sidebar.test.tsx` (crearlo si no existe, mockeando
`next/navigation` como hacen los tests de página del proyecto):

```tsx
it('muestra el contador de la bandeja', async () => {
  vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 2000, rows: [] })
  renderSidebar()
  expect(await screen.findByText('2000')).toBeInTheDocument()
})

it('sin cola pendiente no muestra contador', async () => {
  vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
  renderSidebar()
  expect(await screen.findByText('Bandeja')).toBeInTheDocument()
  expect(screen.queryByText('0')).not.toBeInTheDocument()
})
```

- [ ] **Step 6: Verificar**

```bash
cd monitor-app/frontend && npx vitest run && npx tsc --noEmit && npm run build
```

Esperado: todo verde y `/dashboard/compliance/inbox` en el manifest del build.

- [ ] **Step 7: Commit**

```bash
git add -A monitor-app/frontend
git commit -m "feat(compliance): la bandeja pasa a ser un destino con contador propio

Cola global agrupada por empresa, con la empresa como filtro y no como
requisito previo. La seleccion se acota a una empresa: el formulario aplica
un requisito de UNA entidad. La vista previa se firma al enfocar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 17: Retirar lo que quedó sin uso

**Files:**
- Delete: `components/dashboard/UnclassifiedTray.tsx` y su test
- Delete: `components/dashboard/ClassifyDocumentModal.tsx` y su test
- Modify: `components/dashboard/CertificationCompanyPanel.tsx` y su test
- Modify: `monitor-app/backend/api/app/routers/document_ingest.py`

- [ ] **Step 1: Sacar la bandeja del panel de empresa**

En `CertificationCompanyPanel.tsx`, borrar el import y el uso de
`UnclassifiedTray` y de `ClassifyDocumentModal`, junto con el estado
`classifying` y el `useMemo` de `subjects` que sólo alimentaba al modal. El
panel queda con lo suyo: pendientes, fecha de vencimiento, subir de a uno,
subir masivo y el link a la ficha. En su test, borrar los casos que cubrían la
bandeja — esa superficie se mudó a `TriageWorkbench`.

- [ ] **Step 2: Borrar los componentes**

```bash
git rm monitor-app/frontend/components/dashboard/UnclassifiedTray.tsx \
       monitor-app/frontend/components/dashboard/UnclassifiedTray.test.tsx \
       monitor-app/frontend/components/dashboard/ClassifyDocumentModal.tsx \
       monitor-app/frontend/components/dashboard/ClassifyDocumentModal.test.tsx
```

- [ ] **Step 3: Confirmar que no quedan llamadores de la ruta vieja**

```bash
cd monitor-app/frontend && grep -rn "listTray" app components lib
```

Esperado: sin resultados. Si aparece alguno, migrarlo a `listQueue` antes de
seguir.

- [ ] **Step 4: Retirar `GET /{carrier_id}/items` y `listTray`**

Borrar la ruta en `document_ingest.py` y la función `listTray` en
`lib/api/documentIngest.ts`, con sus tests. `GET /items?carrier_id=` la cubre
por completo.

- [ ] **Step 5: Verificar**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/ -v
cd monitor-app/frontend && npx vitest run && npx tsc --noEmit && npm run build
```

Esperado: todo verde.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(compliance): retira la bandeja vieja y su endpoint

UnclassifiedTray y ClassifyDocumentModal quedaron sin uso al mudarse la
superficie a TriageWorkbench. GET /{carrier_id}/items lo cubre por completo
GET /items?carrier_id=.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verificación final de la revisión

- [ ] `venv/bin/python -m pytest tests/ -v` en el backend: verde.
- [ ] `npx vitest run && npx tsc --noEmit && npm run build` en el frontend: verde.
- [ ] Click-through en vivo, **eligiendo por SQL una empresa sin documentos
      cargados** antes de abrir el navegador (ya se pisó un documento real por
      elegir a ojo del desplegable):
  - [ ] La bandeja abre con la cola completa y el contador del sidebar coincide
        con `SELECT count(*) FROM public.document_ingest_items WHERE match_status='UNMATCHED'`.
  - [ ] `⇧`+click selecciona un rango dentro de una empresa y no lo cruza.
  - [ ] Marcar un archivo de otra empresa reemplaza la selección.
  - [ ] Clasificar en lote baja el contador y el toast dice cuántos quedan.
  - [ ] Mover a otra empresa saca las filas del grupo de origen.
  - [ ] El recorrido completo se puede hacer sólo con teclado.
  - [ ] Limpiar lo cargado en la prueba y confirmar con un conteo global.

## Fuera de alcance de esta revisión

- **Revertir una clasificación ya aplicada** — toca el versionado de
  `compliance_records`; es la parte abierta de la HU-03, ya listada arriba.
- **El agente de clasificación automática** — la columna Sugerencia queda
  construida y vacía, esperándolo.
- **Filtros persistidos en la URL** de la bandeja.
- **Scroll virtual**: con `LIMIT 200` y "Mostrando N de M" alcanza; si la cola
  crece mucho más, ahí se evalúa.
