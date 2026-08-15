# Certificación como un solo zoom: empresa, conductor y vehículo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Empresas deje de sentirse como un módulo que duplica Certificación y pase a ser lo que realmente es —**un nivel de zoom del mismo recorrido**—, resuelto en **una sola página** de la que no hace falta salir.

**Architecture:** Lista a la izquierda, **detalle embebido a la derecha**. Bajar de nivel cambia el panel, no la página. En cada nivel el detalle usa la misma gramática: **quién es · cuánto le falta · qué tiene adentro · qué documentos son suyos**. Los tabs de la ficha existían para separar "lo de adentro" de "lo mío", que con esta gramática son dos secciones del mismo panel.

```
┌ /dashboard/compliance ─────────────────────────────────────────┐
│ [Empresas] [Conductores] [Vehículos] [Documentos]   buscar…    │
├──────────────────┬─────────────────────────────────────────────┤
│ LISTA            │ DETALLE (embebido)                          │
│ ▸ Transportes Sur│ Certificación › Transportes Sur             │
│   Hasa Spa       │ Transportes Sur   ▓▓▓░ 9 de 12              │
│   Logística Norte│                                             │
│                  │ SU FLOTA (20)              ‹ 1 de 3 ›       │
│                  │  Juan Pérez     0 de 12  →                  │
│                  │  HKXW55         5 de 10  →                  │
│                  │ SUS DOCUMENTOS                              │
│                  │  Rol SII      cargado · reasignar           │
│                  │ SEGUROS · CONTACTOS · DATOS  (plegados)     │
└──────────────────┴─────────────────────────────────────────────┘
```

Clic en un conductor **no navega**: el panel pasa a ser el del conductor, con migas `Certificación › Transportes Sur › Juan Pérez` para volver. La lista de la izquierda no se mueve.

**La selección viaja en la URL** (`?empresa=…&conductor=…`), así el enlace se comparte y el botón atrás funciona. Nota: el `?driver=` que existía se llamó "parche" porque abría **un modal**; acá el estado en la URL es exactamente lo correcto.

**Tech Stack:** Next.js 14 App Router, React Query, Tailwind, lucide-react (frontend); FastAPI + asyncpg (backend); vitest + pytest; Playwright para el click-through.

**Spec:**
- `monitor-app/docs/user-stories/20260814/04-hu-modulo-unificado.md` — "el lugar donde mirás la empresa es el lugar donde actuás sobre ella"
- `monitor-app/docs/user-stories/20260814/00-epica-certificacion-unificada.md`
- Mockups aprobados: `.superpowers/brainstorm/64757-1786756707/content/una-pagina.html` (2026-08-15)

## Lo que NO cambia

**La carga masiva y la clasificación posterior quedan intactas.** Es la vista
**Documentos** del conmutador: se sueltan N archivos sin saber de quién son ni
qué son, y después se clasifican en lote contra el hueco que corresponda
(HU-01). Ese flujo es el que justifica todo el módulo y **este plan no lo
toca**.

Las cuatro vistas del conmutador quedan así:

| Vista | Qué muestra | Forma |
|---|---|---|
| **Empresas** | lista de empresas | lista + panel de detalle |
| **Conductores** | lista de conductores, con su empresa | lista + panel de detalle |
| **Vehículos** | lista de vehículos, con su empresa | lista + panel de detalle |
| **Documentos** | la cola de sin clasificar | `TriageWorkbench`, **a todo el ancho** (no lleva panel: la selección de archivos ya es su propia columna) |

Y **la puerta de carga sigue siendo una sola**: `documentIngestApi.uploadAndClassify`
para el caso "ya sé a qué requisito va" (desde el panel de detalle), y
`upload` + `classifyBatch` para el caso "llegaron en bloque" (la bandeja). Los
dos usan los mismos dos endpoints.

## El problema, en concreto

1. **Conductores y vehículos no tienen detalle propio en ninguna parte de la app.** Existen sólo como modal dentro de un tab dentro de la ficha. Por ese hueco se inventó `?driver=` para abrir ese modal.
2. La ficha tiene **959 líneas y 6 tabs**, y su tab Documentos es Certificación acotada a una empresa → la duplicación que el usuario reporta.
3. Hay **dos componentes distintos** para listar documentos: `TransporterDocumentsPanel` (empresa) y `DocumentChecklist` (conductor/vehículo). Sin unificarlos, "la misma gramática" es una frase, no un hecho.
4. Navegar entre módulos y modales rompe el hilo del trabajo. **No debería hacer falta salir de la pantalla.**

## Global Constraints

- **Rama**: trabajar en `dev`. No commitear a `main`.
- **venv del backend**: `monitor-app/backend/api/venv` — NO `.venv` ni anaconda.
- **Español neutral, sin voseo**: "Elige", "Arrastra", "Selecciona". Nunca "Elegí"/"Arrastrá", nunca `vosotros`.
- **Nombrar por el trabajo, no por el modelo de datos**: "¿A quién pertenece?", no "Sujeto".
- **Cero emojis**: sólo `lucide-react`.
- **Una sola puerta de carga**: todo pasa por `documentIngestApi.uploadAndClassify` (que usa `upload` + `classifyBatch`). **No** reintroducir `POST /compliance-records/{id}/file` desde la interfaz — es el criterio "una sola implementación" de la HU-04, y ya se violó una vez.
- **Navegador**: usar el MCP de **Playwright**, nunca `claude-in-chrome` (la extensión está apagada).
- **Diseño**: correr `ui-ux-pro-max` **con `--design-system`** y su checklist de pre-entrega (contraste 4.5:1, `cursor-pointer`, foco visible, `prefers-reduced-motion`, responsive 375/768/1024/1440), junto con `frontend-design`. No alcanza con el dominio `ux`.
- **Mirar la pantalla renderizada antes de decir que está lista.** Las dos veces que se saltó este paso, el resultado se rechazó.
- **SQL nuevo**: verificarlo contra la base **con parámetros**, no sustituyendo `$n` por literales — eso probó el SQL pero no el binding, y dejó pasar un `IndeterminateDatatypeError` en vivo.
- **Cuidado con el 429**: el proxy sólo va a la API de Auth cerca del vencimiento del token. No reintroducir `getUser()` por request.

---

## File Structure

**Backend** (`monitor-app/backend/api/`)

| Archivo | Responsabilidad |
|---|---|
| `app/routers/drivers.py` | MODIFICAR: `GET /{driver_id}` devuelve la empresa asignada |
| `app/routers/assets.py` | MODIFICAR: idem para vehículos |
| `tests/test_drivers.py`, `tests/test_assets.py` | MODIFICAR |

**Frontend** (`monitor-app/frontend/`)

| Archivo | Responsabilidad |
|---|---|
| `components/compliance/DocumentList.tsx` | CREAR: **el** listado de documentos, único para los tres niveles |
| `components/compliance/ZoomHeader.tsx` | CREAR: migas + nombre + avance, la cabecera del panel |
| `components/compliance/ChildrenList.tsx` | CREAR: "lo que tiene adentro", paginado |
| `components/compliance/EntityDetailPanel.tsx` | CREAR: el detalle embebido — empresa, conductor o vehículo |
| `app/dashboard/compliance/page.tsx` | MODIFICAR: lista + panel, con la selección en la URL |
| `app/dashboard/carriers/[id]/page.tsx` | REEMPLAZAR por una redirección a `?empresa=` |
| `components/dashboard/DriverDetailPanel.tsx` | BORRAR: lo reemplaza el panel embebido |
| `components/dashboard/VehicleDetailPanel.tsx` | BORRAR: idem |
| `components/dashboard/TransporterDocumentsPanel.tsx` | BORRAR: lo reemplaza `DocumentList` |
| `components/dashboard/DocumentChecklist.tsx` | BORRAR: idem |
| `components/dashboard/carriers/CarrierDocumentsTab.tsx` | BORRAR: el tab deja de existir |

---

## Task 1: El detalle de conductor y vehículo devuelve su empresa

Sin esto la página del nivel 2 no puede mostrar migas ni decir a qué empresa pertenece — que es lo que el usuario pidió explícitamente.

**Files:**
- Modify: `app/routers/drivers.py`, `app/routers/assets.py`
- Test: `tests/test_drivers.py`, `tests/test_assets.py`

**Interfaces:**
- Produces: `GET /drivers/{id}` y `GET /assets/{id}` suman `carrier_id: str | None` y `carrier_name: str | None`.

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/test_drivers.py`:

```python
def test_driver_detail_carries_its_carrier():
    """Un conductor sin la empresa a la que pertenece no se puede mostrar en su
    propia pagina: no habria migas ni contexto."""
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "id": "d1", "tax_id": "11111111-1", "country_code": "CL",
        "full_name": "Juan Perez", "operational_status": "ACTIVE",
        "is_manual_override": False, "created_at": None,
        "total_requirements": 12, "last_document_update": None,
        "carrier_id": "c1", "carrier_name": "Transportes Sur Spa",
    }
    client = make_client(pool)

    res = client.get("/api/v1/drivers/d1")

    assert res.status_code == 200
    assert res.json()["carrier_name"] == "Transportes Sur Spa"
    assert "driver_assignments" in pool.fetchrow.call_args.args[0]


def test_driver_detail_without_active_assignment():
    """Sin asignacion activa la empresa viaja en null, no rompe."""
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "id": "d1", "tax_id": None, "country_code": "CL",
        "full_name": "Sin Asignar", "operational_status": "ACTIVE",
        "is_manual_override": False, "created_at": None,
        "total_requirements": 0, "last_document_update": None,
        "carrier_id": None, "carrier_name": None,
    }
    client = make_client(pool)

    res = client.get("/api/v1/drivers/d1")

    assert res.status_code == 200
    assert res.json()["carrier_id"] is None
```

El equivalente en `tests/test_assets.py`, con `license_plate` en vez de `full_name`.

- [ ] **Step 2: Correr y verificar que fallan**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_drivers.py -k carrier -v
```

Esperado: FAIL — la respuesta no trae `carrier_name`.

- [ ] **Step 3: Implementar**

En `app/routers/drivers.py`, dentro de `get_driver`:

```python
        SELECT d.id, d.tax_id, d.country_code, d.full_name, d.operational_status,
               d.is_manual_override, d.created_at,
               dcs.total_requirements, dcs.last_document_update,
               -- La empresa a la que pertenece hoy. Mismo criterio de
               -- atribucion que el resto del roster: la asignacion ACTIVE.
               c.id::text          AS carrier_id,
               c.business_name     AS carrier_name
        FROM public.drivers d
        LEFT JOIN app.driver_compliance_status dcs ON dcs.driver_id = d.id
        LEFT JOIN public.driver_assignments da
               ON da.driver_id = d.id AND da.status = 'ACTIVE'
        LEFT JOIN public.carriers c ON c.id = da.carrier_id
        WHERE d.id = $1
```

En `app/routers/assets.py`, idem con `asset_assignments` y `aa.asset_id`.

- [ ] **Step 4: Verificar contra la base real, con parámetros**

Los `AsyncMock` no ejecutan SQL. Correr la consulta vía MCP de Supabase con un `driver_id` real, y comprobar que un conductor **sin** asignación activa devuelve `carrier_id` nulo en vez de desaparecer (el `LEFT JOIN` lo garantiza; confirmarlo).

- [ ] **Step 5: Correr los tests**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/ -q
```

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api
git commit -m "feat(roster): el detalle de conductor y vehiculo trae su empresa

Sin la empresa no hay migas ni contexto en su pagina propia, que es el nivel
que falta del recorrido.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Un solo listado de documentos para los tres niveles

Hoy hay dos: `TransporterDocumentsPanel` (empresa) y `DocumentChecklist` (conductor/vehículo). Con dos, "la misma gramática" no existe: divergen.

**Files:**
- Create: `components/compliance/DocumentList.tsx`, `DocumentList.test.tsx`

**Interfaces:**
- Consumes: `ExpirationDateCell`, `ReassignDocument`, `DocumentPreviewModal`, `documentIngestApi.uploadAndClassify`.
- Produces:
```ts
export function DocumentList(props: {
  records:    ComplianceRecord[]
  carrierId:  string | null
  entityType: 'CARRIER' | 'DRIVER' | 'ASSET'
  entityId:   string
  onChanged:  () => void
}): JSX.Element
```

- [ ] **Step 1: Escribir el test que falla**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DocumentList } from './DocumentList'
import type { ComplianceRecord } from '@/lib/types'

vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: { uploadAndClassify: vi.fn().mockResolvedValue({ applied: ['i1'], errors: [] }) },
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listFiles: vi.fn().mockResolvedValue([]), listPending: vi.fn(), reassign: vi.fn() },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))
import { documentIngestApi } from '@/lib/api/documentIngest'

const REGISTROS: ComplianceRecord[] = [
  { id: 'cr1', requirement_id: 'req1', requirement_code: 'ROL_SII', name: 'Rol SII',
    requirement_level: 'LEGAL_MANDATORY', requires_file: true, status: 'MISSING',
    expiration_date: null, file_url: null, metadata: {}, is_manual_override: false,
    is_expired: false, is_expiring_soon: false, updated_at: null },
  { id: 'cr2', requirement_id: 'req2', requirement_code: 'F30', name: 'F30',
    requirement_level: 'LEGAL_MANDATORY', requires_file: true, status: 'APPROVED_MANUAL',
    expiration_date: '2027-01-01', file_url: 'https://x/f30.pdf', metadata: {},
    is_manual_override: false, is_expired: false, is_expiring_soon: false, updated_at: null },
]

function setup(over: Record<string, unknown> = {}) {
  const onChanged = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DocumentList
        records={REGISTROS} carrierId="c1" entityType="CARRIER" entityId="c1"
        onChanged={onChanged} {...over}
      />
    </QueryClientProvider>,
  )
  return onChanged
}

beforeEach(() => vi.clearAllMocks())

describe('DocumentList', () => {
  it('muestra cada requisito, con archivo o sin él', () => {
    setup()
    expect(screen.getByText('Rol SII')).toBeInTheDocument()
    expect(screen.getByText('F30')).toBeInTheDocument()
  })

  it('carga por la única puerta: ingesta y clasificación', async () => {
    setup()
    const archivo = new File(['x'], 'rol.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Subir Rol SII'), { target: { files: [archivo] } })

    await waitFor(() => {
      expect(documentIngestApi.uploadAndClassify).toHaveBeenCalledWith(
        expect.objectContaining({
          carrierId: 'c1', entityType: 'CARRIER', entityId: 'c1', requirementId: 'req1',
        }),
      )
    })
  })

  it('sólo ofrece reasignar sobre lo que ya tiene archivo', () => {
    setup()
    expect(screen.getAllByRole('button', { name: /reasignar/i })).toHaveLength(1)
  })

  it('deja declarar el vencimiento sin adjuntar archivo (HU-02)', () => {
    setup()
    expect(screen.getAllByRole('button', { name: /vencimiento/i }).length).toBeGreaterThan(0)
  })

  it('sin permiso de edición, se ve pero no se actúa', () => {
    vi.doMock('@/hooks/useCanEdit', () => ({ useCanEdit: () => false }))
    setup()
    expect(screen.getByText('Rol SII')).toBeInTheDocument()
  })

  it('sin empresa no se puede cargar, y lo dice', () => {
    setup({ carrierId: null })
    expect(screen.queryByLabelText('Subir Rol SII')).not.toBeInTheDocument()
    expect(screen.getByText(/sin empresa asignada/i)).toBeInTheDocument()
  })

  it('no deja la lista vacía sin explicación', () => {
    setup({ records: [] })
    expect(screen.getByText(/todavía no hay requisitos/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/DocumentList.test.tsx
```

- [ ] **Step 3: Implementar**

Partir de `TransporterDocumentsPanel` (que ya tiene historial de versiones, vista previa, `ExpirationDateCell` y `ReassignDocument`) y sumarle de `DocumentChecklist` lo que le falta: el control de carga por requisito y el contador. La carga usa **siempre** `documentIngestApi.uploadAndClassify` con el `requirement_id` de la fila.

Cuando `carrierId` es `null` —conductor o vehículo sin asignación activa— **no se ofrece cargar** y se explica por qué: sin empresa no hay a qué lote asociar el archivo.

- [ ] **Step 4: Verificar**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/DocumentList.test.tsx && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/compliance
git commit -m "feat(compliance): un solo listado de documentos para los tres niveles

Habia dos, uno para empresa y otro para conductor/vehiculo. Con dos, la misma
gramatica en cada nivel es una frase, no un hecho: divergen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: La cabecera común del zoom

**Files:**
- Create: `components/compliance/ZoomHeader.tsx`, `ZoomHeader.test.tsx`

**Interfaces:**
- Produces:
```ts
export function ZoomHeader(props: {
  migas:    { label: string; href?: string }[]
  titulo:   string
  subtitulo?: string
  cubiertos: number
  total:     number
  acciones?: React.ReactNode
}): JSX.Element
```

- [ ] **Step 1: Escribir el test que falla**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ZoomHeader } from './ZoomHeader'

describe('ZoomHeader', () => {
  it('muestra dónde estás y cómo volver', () => {
    render(<ZoomHeader
      migas={[{ label: 'Certificación', href: '/dashboard/compliance' },
              { label: 'Transportes Sur', href: '/dashboard/carriers/c1' },
              { label: 'Juan Pérez' }]}
      titulo="Juan Pérez" cubiertos={0} total={12}
    />)
    expect(screen.getByRole('link', { name: 'Certificación' }))
      .toHaveAttribute('href', '/dashboard/compliance')
    expect(screen.getByRole('link', { name: 'Transportes Sur' })).toBeInTheDocument()
    // El último es dónde estás: no es un enlace.
    expect(screen.queryByRole('link', { name: 'Juan Pérez' })).not.toBeInTheDocument()
  })

  it('dice cuánto le falta', () => {
    render(<ZoomHeader migas={[]} titulo="ACME" cubiertos={9} total={12} />)
    expect(screen.getByText('9 de 12')).toBeInTheDocument()
  })

  it('sin requisitos no inventa un porcentaje', () => {
    render(<ZoomHeader migas={[]} titulo="ACME" cubiertos={0} total={0} />)
    expect(screen.getByText(/sin requisitos/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/ZoomHeader.test.tsx
```

- [ ] **Step 3: Implementar**

Migas con `<nav aria-label="Migas de pan">`, el último elemento sin enlace. La barra de avance reusa el mismo lenguaje visual que `CertificationStatusTable` (barra + `N de M`), para que el nivel 0 y el nivel 2 se lean igual. Con `total === 0`, se omite la barra y se dice "Sin requisitos" — inventar un 0% sería peor que no mostrarlo.

- [ ] **Step 4: Verificar**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/ZoomHeader.test.tsx && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/compliance
git commit -m "feat(compliance): cabecera comun del zoom, con migas y avance

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: La flota, paginada

Lo que la empresa "tiene adentro". Se pagina porque una empresa con veinte o más estiraría el panel sin límite.

**Files:**
- Create: `components/compliance/ChildrenList.tsx`, `ChildrenList.test.tsx`

**Interfaces:**
- Produces:
```ts
export function ChildrenList(props: {
  titulo:   string
  filas:    { id: string; nombre: string; tipo: 'DRIVER' | 'ASSET'
              cubiertos: number; total: number }[]
  porPagina?: number            // 20 por defecto
  onAbrir:  (tipo: 'DRIVER' | 'ASSET', id: string) => void
}): JSX.Element
```

- [ ] **Step 1: Escribir el test que falla**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ChildrenList } from './ChildrenList'

const filas = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `d${i}`, nombre: `Conductor ${i}`, tipo: 'DRIVER' as const,
  cubiertos: 0, total: 12,
}))

describe('ChildrenList', () => {
  it('muestra el avance de cada uno', () => {
    render(<ChildrenList titulo="Su flota" filas={filas(2)} onAbrir={vi.fn()} />)
    expect(screen.getAllByText('0 de 12')).toHaveLength(2)
  })

  it('con flota grande pagina en vez de estirar el panel', () => {
    render(<ChildrenList titulo="Su flota" filas={filas(45)} onAbrir={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: /Conductor/ })).toHaveLength(20)
    expect(screen.getByText(/1 de 3/)).toBeInTheDocument()
  })

  it('avanza de página sin salir de la pantalla', () => {
    render(<ChildrenList titulo="Su flota" filas={filas(45)} onAbrir={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /siguiente/i }))
    expect(screen.getByText(/2 de 3/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Conductor 20' })).toBeInTheDocument()
  })

  it('con flota chica no muestra controles de paginación', () => {
    render(<ChildrenList titulo="Su flota" filas={filas(3)} onAbrir={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /siguiente/i })).not.toBeInTheDocument()
  })

  it('abrir uno avisa a quién, sin navegar', () => {
    const onAbrir = vi.fn()
    render(<ChildrenList titulo="Su flota" filas={filas(2)} onAbrir={onAbrir} />)
    fireEvent.click(screen.getByRole('button', { name: 'Conductor 1' }))
    expect(onAbrir).toHaveBeenCalledWith('DRIVER', 'd1')
  })

  it('sin flota lo dice, en vez de una lista vacía', () => {
    render(<ChildrenList titulo="Su flota" filas={[]} onAbrir={vi.fn()} />)
    expect(screen.getByText(/todavía no tiene/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/ChildrenList.test.tsx
```

- [ ] **Step 3: Implementar**

Filas con el mismo lenguaje visual que `CertificationStatusTable` —nombre + barra + `N de M`— para que el nivel 0 y el detalle se lean igual. Cada fila es un `<button>`, no un enlace: **no navega**, cambia el panel. Los controles de paginación sólo aparecen si hay más de una página.

- [ ] **Step 4: Verificar**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/ChildrenList.test.tsx && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/compliance
git commit -m "feat(compliance): la flota del detalle, paginada

Cada fila cambia el panel en vez de navegar: la idea es no salir de la
pantalla. Se pagina a 20 para que una empresa grande no la estire.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: El panel de detalle embebido

El corazón del cambio: un panel que sirve para los tres niveles.

**Files:**
- Create: `components/compliance/EntityDetailPanel.tsx`, `EntityDetailPanel.test.tsx`

**Interfaces:**
- Consumes: `ZoomHeader`, `ChildrenList`, `DocumentList`, `carriersApi.get`, `driversApi.get`, `assetsApi.get`, `driversApi.listComplianceRecords`, `assetsApi.listComplianceRecords`.
- Produces:
```ts
export function EntityDetailPanel(props: {
  seleccion: { tipo: 'CARRIER' | 'DRIVER' | 'ASSET'; id: string } | null
  /** Empresa del contexto, para las migas al bajar a un conductor. */
  empresaContexto: { id: string; nombre: string } | null
  onSeleccionar: (sel: { tipo: 'CARRIER' | 'DRIVER' | 'ASSET'; id: string } | null) => void
}): JSX.Element
```

- [ ] **Step 1: Escribir el test que falla**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EntityDetailPanel } from './EntityDetailPanel'

vi.mock('@/lib/api/carriers', () => ({ carriersApi: { get: vi.fn() } }))
vi.mock('@/lib/api/drivers', () => ({
  driversApi: { get: vi.fn(), listComplianceRecords: vi.fn() },
}))
vi.mock('@/lib/api/assets', () => ({
  assetsApi: { get: vi.fn(), listComplianceRecords: vi.fn() },
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listFiles: vi.fn().mockResolvedValue([]), listPending: vi.fn(), reassign: vi.fn() },
}))
vi.mock('@/lib/api/documentIngest', () => ({ documentIngestApi: { uploadAndClassify: vi.fn() } }))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))

import { carriersApi } from '@/lib/api/carriers'
import { driversApi } from '@/lib/api/drivers'

const EMPRESA = {
  id: 'c1', business_name: 'Transportes Sur', tax_id: '76.000-0',
  operational_status: 'ACTIVE', compliance_records: [], contacts: [],
}
const CONDUCTOR = {
  id: 'd1', full_name: 'Juan Pérez', tax_id: '1-9',
  carrier_id: 'c1', carrier_name: 'Transportes Sur',
}

function setup(props: Record<string, unknown> = {}) {
  const onSeleccionar = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EntityDetailPanel
        seleccion={{ tipo: 'CARRIER', id: 'c1' }}
        empresaContexto={null}
        onSeleccionar={onSeleccionar}
        {...props}
      />
    </QueryClientProvider>,
  )
  return onSeleccionar
}

beforeEach(() => {
  vi.mocked(carriersApi.get).mockReset().mockResolvedValue(EMPRESA as never)
  vi.mocked(driversApi.get).mockReset().mockResolvedValue(CONDUCTOR as never)
  vi.mocked(driversApi.listComplianceRecords).mockReset().mockResolvedValue([] as never)
})

describe('EntityDetailPanel', () => {
  it('sin selección invita a elegir, no queda en blanco', () => {
    setup({ seleccion: null })
    expect(screen.getByText(/selecciona una empresa/i)).toBeInTheDocument()
  })

  it('de una empresa muestra su flota y sus documentos', async () => {
    setup()
    expect(await screen.findByText('Transportes Sur')).toBeInTheDocument()
    expect(screen.getByText(/su flota/i)).toBeInTheDocument()
    expect(screen.getByText(/sus documentos/i)).toBeInTheDocument()
  })

  it('bajar a un conductor cambia el panel, no la página', async () => {
    const onSeleccionar = setup({ seleccion: { tipo: 'DRIVER', id: 'd1' },
                                  empresaContexto: { id: 'c1', nombre: 'Transportes Sur' } })
    expect(await screen.findByText('Juan Pérez')).toBeInTheDocument()
    // Nunca un modal: el detalle está embebido.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Y se vuelve por las migas, sin navegar.
    fireEvent.click(screen.getByRole('button', { name: 'Transportes Sur' }))
    expect(onSeleccionar).toHaveBeenCalledWith({ tipo: 'CARRIER', id: 'c1' })
  })

  it('un conductor sin empresa lo dice y no ofrece cargar', async () => {
    vi.mocked(driversApi.get).mockResolvedValue({ ...CONDUCTOR, carrier_id: null, carrier_name: null } as never)
    setup({ seleccion: { tipo: 'DRIVER', id: 'd1' }, empresaContexto: null })
    expect(await screen.findByText(/sin empresa asignada/i)).toBeInTheDocument()
  })

  it('avisa si la entidad no existe', async () => {
    vi.mocked(carriersApi.get).mockRejectedValue(new Error('no encontrada'))
    setup()
    expect(await screen.findByText(/no se pudo cargar/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/EntityDetailPanel.test.tsx
```

- [ ] **Step 3: Implementar**

Un solo componente con tres formas de la misma gramática:

| Nivel | Cabecera | Adentro | Documentos | Además |
|---|---|---|---|---|
| Empresa | `ZoomHeader` migas `Certificación › X` | `ChildrenList` con su flota | `DocumentList` `entityType='CARRIER'` | Seguros, Contactos y Datos, en secciones plegables |
| Conductor | migas `Certificación › Empresa › X` | — | `DocumentList` `entityType='DRIVER'` | Contactos del conductor |
| Vehículo | migas `Certificación › Empresa › Patente` | — | `DocumentList` `entityType='ASSET'` | — |

Las migas son **botones**, no enlaces: llaman a `onSeleccionar` y no navegan. La empresa del contexto sale de `empresaContexto` o, si se entró directo a un conductor, de su propio `carrier_id` (Task 1).

- [ ] **Step 4: Verificar**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/EntityDetailPanel.test.tsx && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/compliance
git commit -m "feat(compliance): panel de detalle embebido para los tres niveles

Misma gramatica en los tres: quien es, cuanto le falta, que tiene adentro y
que documentos son suyos. Bajar de nivel cambia el panel, no la pagina.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Montar el panel en la página, con la selección en la URL

**Files:**
- Modify: `app/dashboard/compliance/page.tsx`, `page.test.tsx`
- Modify: `components/compliance/CertificationStatusTable.tsx`

- [ ] **Step 1: Escribir el test que falla**

```tsx
it('elegir una fila abre su detalle sin salir de la página', async () => {
  setup()
  fireEvent.click(await screen.findByRole('button', { name: /Test Empresa Webcarga/ }))
  expect(replace).toHaveBeenCalledWith('/dashboard/compliance?empresa=c1')
})

it('la selección se lee de la URL, así el enlace se comparte', async () => {
  params = new URLSearchParams('empresa=c1')
  setup()
  expect(await screen.findByRole('heading', { name: 'Test Empresa Webcarga' })).toBeInTheDocument()
})

it('bajar a un conductor queda en la URL', async () => {
  params = new URLSearchParams('empresa=c1&conductor=d1')
  setup()
  await waitFor(() => expect(driversApi.get).toHaveBeenCalledWith('d1'))
})

it('la vista Documentos sigue siendo la bandeja a todo el ancho', async () => {
  params = new URLSearchParams('vista=documentos')
  setup()
  // Sin panel de detalle: la cola tiene su propia grilla de tres regiones.
  expect(await screen.findByText(/no hay documentos sin clasificar/i)).toBeInTheDocument()
  expect(screen.queryByText(/selecciona una empresa/i)).not.toBeInTheDocument()
})

it('la lista no se pierde al abrir un detalle', async () => {
  params = new URLSearchParams('empresa=c1')
  setup()
  // Sigue estando la lista de la izquierda.
  expect(await screen.findAllByRole('button', { name: /Test Empresa Webcarga/ })).not.toHaveLength(0)
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/frontend && npx vitest run app/dashboard/compliance
```

- [ ] **Step 3: Implementar**

**Sólo las tres vistas de entidades usan lista + panel.** La vista **Documentos**
sigue siendo `TriageWorkbench` a todo el ancho, sin panel de detalle — no se
toca. Un test lo fija para que nadie la meta dentro de la grilla al refactorizar.

Para las otras tres, la página pasa a `grid-cols-[minmax(240px,320px)_1fr]`: lista y panel. `CertificationStatusTable` deja de enlazar y pasa a avisar la selección (`onSeleccionar`), porque **no se navega**. La selección se refleja en la URL con `router.replace` — `?empresa=`, `?conductor=`, `?vehiculo=` — y se lee de ahí al montar.

En pantalla angosta no hay dos columnas: con selección se muestra el panel y un botón "Volver a la lista".

- [ ] **Step 4: Verificar**

```bash
cd monitor-app/frontend && npx vitest run && npx tsc --noEmit && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add -A monitor-app/frontend
git commit -m "feat(compliance): lista y detalle en una sola pagina

La seleccion viaja en la URL, asi el enlace se comparte y el boton atras
funciona. La lista no se mueve al abrir un detalle.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Traer lo que vivía en la ficha y retirarla

La ficha tiene **959 líneas y 6 tabs**. Nada puede perderse.

**Files:**
- Modify: `components/compliance/EntityDetailPanel.tsx`
- Replace: `app/dashboard/carriers/[id]/page.tsx` por una redirección
- Delete: `components/dashboard/DriverDetailPanel.tsx`, `VehicleDetailPanel.tsx`, `carriers/CarrierDocumentsTab.tsx` y sus tests

- [ ] **Step 1: Inventariar y ubicar cada cosa**

| Hoy | Dónde queda |
|---|---|
| Resumen (:523): `CompletionRing`, obligatorios pendientes, `AlertStatTiles`, `ComplianceHealth` | Cabecera del panel + sección Certificación |
| Documentos (:582): `CarrierDocumentsTab` | Sección **Sus documentos** (`DocumentList`) |
| Contactos (:594): `ContactCard`, `AddContactForm` | Sección plegable **Contactos** |
| Conductores (:616) y Equipos (:706): rosters | Sección **Su flota** (`ChildrenList`) |
| Seguros (:818): `InsuranceSummaryCard`, `PolicyCreateForm`, `InsurancePolicyModal` | Sección plegable **Seguros** |
| Acciones: editar, dar de baja, eliminar, transferir | Acciones de la cabecera del panel |
| Modales de conductor/vehículo: editar nombre/RUT, quitar del roster, transferir, contactos | Panel de detalle del nivel 2 |

- [ ] **Step 2: La ruta vieja redirige**

`/dashboard/carriers/[id]` queda como redirección a `/dashboard/compliance?empresa=<id>` — está en enlaces guardados, en el historial y en `CertificationStatusTable`.

```tsx
import { redirect } from 'next/navigation'

/** La ficha dejó de ser una página propia: es el panel de detalle de
 *  Certificación. La ruta se conserva porque quedó en enlaces guardados. */
export default async function CarrierRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return redirect(`/dashboard/compliance?empresa=${id}`)
}
```

- [ ] **Step 3: Borrar lo que quedó sin uso**

```bash
git rm monitor-app/frontend/components/dashboard/DriverDetailPanel.tsx        monitor-app/frontend/components/dashboard/DriverDetailPanel.test.tsx        monitor-app/frontend/components/dashboard/VehicleDetailPanel.tsx        monitor-app/frontend/components/dashboard/VehicleDetailPanel.test.tsx        monitor-app/frontend/components/dashboard/carriers/CarrierDocumentsTab.tsx        monitor-app/frontend/components/dashboard/carriers/CarrierDocumentsTab.test.tsx
```

- [ ] **Step 4: Verificar que no se perdió nada**

```bash
cd monitor-app/frontend && grep -rn "DriverDetailPanel\|VehicleDetailPanel\|CarrierDocumentsTab\|?driver=\|?asset=\|activeTab" app components | grep -v node_modules
npx vitest run && npx tsc --noEmit && npm run build
```

Esperado: sin resultados en el grep. Recorrer el inventario del Step 1 y confirmar que cada fila tiene destino **en la pantalla**, no sólo en el código.

- [ ] **Step 5: Commit**

```bash
git add -A monitor-app/frontend
git commit -m "refactor(empresas): la ficha se disuelve en el panel de detalle

Los seis tabs existian para separar 'lo de adentro' de 'lo mio', que son dos
secciones del mismo panel. La ruta vieja redirige: quedo en enlaces guardados.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Retirar los listados viejos

**Files:**
- Delete: `components/dashboard/TransporterDocumentsPanel.tsx`, `DocumentChecklist.tsx` y sus tests

- [ ] **Step 1: Confirmar que no quedan consumidores**

```bash
cd monitor-app/frontend && grep -rn "TransporterDocumentsPanel\|DocumentChecklist" app components lib | grep -v node_modules
```

Si aparece alguno, migrarlo a `DocumentList` antes de seguir.

- [ ] **Step 2: Borrar**

```bash
git rm monitor-app/frontend/components/dashboard/TransporterDocumentsPanel.tsx        monitor-app/frontend/components/dashboard/TransporterDocumentsPanel.test.tsx        monitor-app/frontend/components/dashboard/DocumentChecklist.tsx        monitor-app/frontend/components/dashboard/DocumentChecklist.test.tsx
```

- [ ] **Step 3: Verificar y commitear**

```bash
cd monitor-app/frontend && npx vitest run && npx tsc --noEmit && npm run build
git add -A && git commit -m "refactor(compliance): retira los dos listados de documentos viejos

Los reemplaza DocumentList, unico para los tres niveles.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verificación final

- [ ] `venv/bin/python -m pytest tests/ -q` en el backend: verde.
- [ ] `npx vitest run && npx tsc --noEmit && npm run build` en el frontend: verde.
- [ ] **Pasada de diseño**: correr `ui-ux-pro-max --design-system` y su checklist sobre las tres páginas. Contraste 4.5:1, `cursor-pointer`, foco visible, `prefers-reduced-motion`, y responsive a 375 / 768 / 1024 / 1440.
- [ ] **Mirar la pantalla renderizada** con Playwright en los tres niveles, en escritorio y en teléfono (en angosto no hay dos columnas). No darla por lista sin haberla abierto.
- [ ] Click-through del recorrido completo, **con datos de prueba sembrados y borrados después**:
  - [ ] Certificación → una empresa → un conductor **sin que cambie la página**, y volver con las migas y con el botón atrás.
  - [ ] Una empresa con más de 20 en su flota: la paginación funciona y el panel no se estira.
  - [ ] Copiar la URL con un conductor abierto, pegarla en otra pestaña y llegar al mismo lugar.
  - [ ] Cargar un documento desde cada uno de los tres niveles.
  - [ ] Reasignar desde cada nivel.
  - [ ] Un conductor **sin empresa asignada**: la página no rompe y explica por qué no se puede cargar.
  - [ ] Limpiar y confirmar con un conteo global (0 items, 0 lotes, 0 registros alterados, 0 filas de auditoría).

## Fuera de alcance

- **HU-05** (administración de requisitos) y **HU-06** (Seguros proyectado a cumplimiento). HU-06 es la que sacaría a Seguros del primer nivel y lo dejaría como sección de la empresa — encaja con este plan, pero es una HU propia.
- **El nivel 3, el documento**, con su propio panel. Hoy el historial de versiones vive dentro de la fila y alcanza.
- **Los 2.000 documentos** siguen sin entrar al sistema. Este plan no los trae; sigue siendo el bloqueante para que todo esto sirva.
