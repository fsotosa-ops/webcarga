# Certificación como un solo zoom: empresa, conductor y vehículo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Empresas deje de sentirse como un módulo que duplica Certificación y pase a ser lo que realmente es —**un nivel de zoom del mismo recorrido**—, con la misma gramática en los tres niveles y una página propia para conductores y vehículos.

**Architecture:** Un mismo objeto mirado a tres distancias. En cada nivel la pantalla dice lo mismo con la misma gramática: **quién es · cuánto le falta · qué tiene adentro · qué documentos son suyos**. Los tabs de la ficha existían para separar "lo de adentro" de "lo mío", que con esta gramática son dos secciones, no seis pestañas.

```
/dashboard/compliance          Todas las empresas (o conductores, o vehículos)
        ↓
/dashboard/carriers/[id]       Una empresa · su flota · sus documentos
        ↓
/dashboard/drivers/[id]        Un conductor · sus documentos
/dashboard/assets/[id]         Un vehículo  · sus documentos
```

**Tech Stack:** Next.js 14 App Router, React Query, Tailwind, lucide-react (frontend); FastAPI + asyncpg (backend); vitest + pytest; Playwright para el click-through.

**Spec:**
- `monitor-app/docs/user-stories/20260814/04-hu-modulo-unificado.md` — "el lugar donde mirás la empresa es el lugar donde actuás sobre ella"
- `monitor-app/docs/user-stories/20260814/00-epica-certificacion-unificada.md`
- Mockups: `.superpowers/brainstorm/64757-1786756707/content/zoom.html` (aprobado por el usuario el 2026-08-15)

## El problema, en concreto

1. **Conductores y vehículos no tienen página propia en ninguna parte de la app.** Existen sólo como modal dentro de un tab dentro de la ficha. No hay link que compartir, el botón atrás no vuelve, y adentro del modal hay otra sección de documentación — cuarto nivel de anidamiento.
2. Por ese hueco, Certificación no podía llevar a un conductor: se inventó `?driver=` / `?asset=` para abrir ese modal. Es un parche sobre un problema estructural.
3. La ficha tiene **959 líneas y 6 tabs**, y su tab Documentos es Certificación acotada a una empresa → la duplicación que el usuario reporta.
4. Hay **dos componentes distintos** para listar documentos: `TransporterDocumentsPanel` (empresa) y `DocumentChecklist` (conductor/vehículo). Sin unificarlos, "la misma gramática" es una frase, no un hecho.

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
| `components/compliance/ZoomHeader.tsx` | CREAR: migas + nombre + avance, la cabecera común |
| `components/compliance/ChildrenList.tsx` | CREAR: "lo que tiene adentro", con su avance |
| `app/dashboard/drivers/[id]/page.tsx` | CREAR: nivel 2 — conductor |
| `app/dashboard/assets/[id]/page.tsx` | CREAR: nivel 2 — vehículo |
| `app/dashboard/carriers/[id]/page.tsx` | MODIFICAR: página plana, sin tabs |
| `components/dashboard/DriverDetailPanel.tsx` | BORRAR: lo reemplaza la página |
| `components/dashboard/VehicleDetailPanel.tsx` | BORRAR: idem |
| `components/dashboard/TransporterDocumentsPanel.tsx` | BORRAR: lo reemplaza `DocumentList` |
| `components/dashboard/DocumentChecklist.tsx` | BORRAR: idem |
| `components/compliance/CertificationStatusTable.tsx` | MODIFICAR: enlaza a las páginas nuevas, sin `?driver=` |

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

## Task 4: Página del conductor

El nivel que hoy no existe. Reemplaza al modal.

**Files:**
- Create: `app/dashboard/drivers/[id]/page.tsx`, `page.test.tsx`

**Interfaces:**
- Consumes: `driversApi.get`, `driversApi.listComplianceRecords`, `ZoomHeader`, `DocumentList`.

- [ ] **Step 1: Escribir el test que falla**

```tsx
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'd1' }) }))
vi.mock('@/lib/api/drivers', () => ({
  driversApi: { get: vi.fn(), listComplianceRecords: vi.fn() },
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listFiles: vi.fn().mockResolvedValue([]), listPending: vi.fn(), reassign: vi.fn() },
}))
vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: { uploadAndClassify: vi.fn() },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))

import { driversApi } from '@/lib/api/drivers'
import DriverPage from './page'

const CONDUCTOR = {
  id: 'd1', full_name: 'Juan Pérez', tax_id: '11111111-1',
  operational_status: 'ACTIVE', carrier_id: 'c1', carrier_name: 'Transportes Sur',
}

function setup() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DriverPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(driversApi.get).mockReset().mockResolvedValue(CONDUCTOR as never)
  vi.mocked(driversApi.listComplianceRecords).mockReset().mockResolvedValue([] as never)
})

describe('Página del conductor', () => {
  it('es una página con URL propia, no un modal', async () => {
    setup()
    expect(await screen.findByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('dice a qué empresa pertenece y deja volver', async () => {
    setup()
    expect(await screen.findByRole('link', { name: 'Transportes Sur' }))
      .toHaveAttribute('href', '/dashboard/carriers/c1')
  })

  it('sin empresa asignada lo dice, en vez de mostrar una miga rota', async () => {
    vi.mocked(driversApi.get).mockResolvedValue({ ...CONDUCTOR, carrier_id: null, carrier_name: null } as never)
    setup()
    expect(await screen.findByText(/sin empresa asignada/i)).toBeInTheDocument()
  })

  it('muestra sus documentos', async () => {
    vi.mocked(driversApi.listComplianceRecords).mockResolvedValue([{
      id: 'cr1', requirement_id: 'req1', requirement_code: 'LICENCIA', name: 'Licencia',
      requirement_level: 'LEGAL_MANDATORY', requires_file: true, status: 'MISSING',
      expiration_date: null, file_url: null, metadata: {}, is_manual_override: false,
      is_expired: false, is_expiring_soon: false, updated_at: null,
    }] as never)
    setup()
    expect(await screen.findByText('Licencia')).toBeInTheDocument()
  })

  it('avisa si el conductor no existe', async () => {
    vi.mocked(driversApi.get).mockRejectedValue(new Error('Conductor no encontrado'))
    setup()
    expect(await screen.findByText(/no encontrado/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/frontend && npx vitest run app/dashboard/drivers
```

- [ ] **Step 3: Implementar**

Página plana: `ZoomHeader` (migas `Certificación › Empresa › Conductor`, avance calculado de los `compliance_records`) + `DocumentList` acotado a `entityType='DRIVER'`. Los datos editables del conductor (nombre, RUT) y las acciones de roster —transferir, quitar— se traen del modal **en la Task 6**, cuando se retire; en esta tarea la página ya sirve para lo que se necesita: ver y cargar su documentación.

- [ ] **Step 4: Verificar**

```bash
cd monitor-app/frontend && npx vitest run app/dashboard/drivers && npx tsc --noEmit && npm run build
```

Esperado: `/dashboard/drivers/[id]` en el manifest.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/app/dashboard/drivers
git commit -m "feat(roster): el conductor pasa a tener pagina propia

Existia solo como modal dentro de un tab dentro de la ficha: sin URL, el boton
atras no volvia, y su documentacion quedaba a cuatro niveles de anidamiento.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Página del vehículo

Idéntica a la Task 4, con `assetsApi` y `license_plate` como título. **Repetir el código de la Task 4 adaptado — no referenciarlo**: quien implemente esta tarea puede no haber leído la anterior.

**Files:**
- Create: `app/dashboard/assets/[id]/page.tsx`, `page.test.tsx`

- [ ] **Step 1: Escribir el test que falla**

Mismo archivo que la Task 4 cambiando: `useParams: () => ({ id: 'a1' })`, `assetsApi` en vez de `driversApi`, y el vehículo:

```tsx
const VEHICULO = {
  id: 'a1', license_plate: 'HKXW55', asset_type: 'TRACTO',
  operational_status: 'ACTIVE', carrier_id: 'c1', carrier_name: 'Transportes Sur',
}
```

Los cinco casos son los mismos: página sin modal, empresa enlazada, sin empresa asignada, sus documentos, y no encontrado.

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/frontend && npx vitest run app/dashboard/assets
```

- [ ] **Step 3: Implementar**

`ZoomHeader` con migas `Certificación › Empresa › Patente` + `DocumentList` con `entityType='ASSET'`.

- [ ] **Step 4: Verificar**

```bash
cd monitor-app/frontend && npx vitest run app/dashboard/assets && npx tsc --noEmit && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/app/dashboard/assets
git commit -m "feat(roster): el vehiculo pasa a tener pagina propia

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Retirar los modales y enlazar a las páginas

**Files:**
- Delete: `components/dashboard/DriverDetailPanel.tsx` y su test, `VehicleDetailPanel.tsx` y su test
- Modify: `app/dashboard/carriers/[id]/page.tsx`, `components/dashboard/DriverRosterCard.tsx`, `VehicleRosterCard.tsx`
- Modify: `components/compliance/CertificationStatusTable.tsx`

- [ ] **Step 1: Mover a las páginas lo que sólo vivía en los modales**

Antes de borrar, inventariar qué hace cada modal y que no se pierda nada: edición de nombre/RUT (`onPatch`), quitar del roster (`onRemove`), transferir a otra empresa (`onTransferClick`), y la lista de contactos del conductor. Todo eso pasa a la página del nivel 2, como acciones de la cabecera (`ZoomHeader acciones`) y una sección de contactos.

- [ ] **Step 2: Los rosters enlazan a las páginas**

En `DriverRosterCard` y `VehicleRosterCard`, la tarjeta pasa a ser un `<Link>` a `/dashboard/drivers/{id}` y `/dashboard/assets/{id}`. Se retiran `onSelect`/`selectedId` y el estado `selectedDriverId` / `selectedAssetId` de la ficha.

- [ ] **Step 3: Certificación enlaza directo**

En `CertificationStatusTable`, la fila de conductor/vehículo apunta a su página en vez de a `/dashboard/carriers/{carrierId}?tab=…&driver=…`. Se retiran los parámetros `?driver=` / `?asset=` de la ficha: eran el parche que compensaba la falta de página propia.

- [ ] **Step 4: Borrar los modales**

```bash
git rm monitor-app/frontend/components/dashboard/DriverDetailPanel.tsx \
       monitor-app/frontend/components/dashboard/DriverDetailPanel.test.tsx \
       monitor-app/frontend/components/dashboard/VehicleDetailPanel.tsx \
       monitor-app/frontend/components/dashboard/VehicleDetailPanel.test.tsx
```

- [ ] **Step 5: Verificar**

```bash
cd monitor-app/frontend && grep -rn "DriverDetailPanel\|VehicleDetailPanel\|?driver=\|?asset=" app components | grep -v node_modules
npx vitest run && npx tsc --noEmit && npm run build
```

Esperado: sin resultados en el grep, y todo verde.

- [ ] **Step 6: Commit**

```bash
git add -A monitor-app/frontend
git commit -m "refactor(roster): mueren los modales de conductor y vehiculo

El roster y Certificacion enlazan a las paginas. Se retira el ?driver= que
existia solo para abrir un modal que no tenia URL propia.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: La ficha de empresa, plana

Sin tabs. Es el trabajo más grande: hay que redistribuir 959 líneas sin perder ninguna acción.

**Files:**
- Modify: `app/dashboard/carriers/[id]/page.tsx`
- Create: `components/compliance/ChildrenList.tsx` y su test
- Create: `components/dashboard/carriers/CarrierInsuranceSection.tsx`, `CarrierContactsSection.tsx`

- [ ] **Step 1: Inventariar lo que hoy vive en cada tab**

| Tab | Qué contiene | A dónde va |
|---|---|---|
| Resumen (:523) | `CompletionRing`, obligatorios pendientes, `AlertStatTiles`, `ComplianceHealth` | A la cabecera y a la sección Certificación |
| Documentos (:582) | `CarrierDocumentsTab` (carga + listado) | Sección **Sus documentos** |
| Contactos (:594) | `ContactCard`, `AddContactForm` | Sección **Contactos** |
| Conductores (:616) | `DriverRosterCard`, `TransferModal`, `BajaReasonModal` | Sección **Su flota** |
| Equipos (:706) | `VehicleRosterCard` | Sección **Su flota** |
| Seguros (:818) | `InsuranceSummaryCard`, `PolicyCreateForm`, `InsurancePolicyModal` | Sección **Seguros** |

Las acciones de la empresa —editar, dar de baja, eliminar, transferir— pasan a la cabecera.

- [ ] **Step 2: Escribir el test que falla**

```tsx
it('muestra todo el estado de la empresa sin navegar por tabs', async () => {
  setup()
  expect(await screen.findByText('Transportes Sur')).toBeInTheDocument()
  // Las cuatro secciones, todas presentes a la vez.
  for (const s of ['Certificación', 'Su flota', 'Seguros', 'Contactos']) {
    expect(screen.getByRole('heading', { name: new RegExp(s, 'i') })).toBeInTheDocument()
  }
  expect(screen.queryByRole('button', { name: 'Resumen' })).not.toBeInTheDocument()
})

it('cada conductor y vehículo lleva a su página', async () => {
  setup()
  expect(await screen.findByRole('link', { name: /Juan Pérez/ }))
    .toHaveAttribute('href', '/dashboard/drivers/d1')
})

it('conserva las acciones de la empresa', async () => {
  setup()
  for (const a of [/editar empresa/i, /dar de baja/i, /eliminar/i]) {
    expect(await screen.findByRole('button', { name: a })).toBeInTheDocument()
  }
})
```

- [ ] **Step 3: Implementar**

Una columna con secciones ancladas y un índice al costado (`<nav>` con enlaces `#certificacion`, `#flota`, `#seguros`, `#contactos`). `ChildrenList` renderiza la flota con el mismo lenguaje visual que `CertificationStatusTable`: nombre + barra + `N de M`, enlazando a la página de cada uno.

**Con flota grande la página se hace larga**: la sección **Su flota** se pagina a 20 y ofrece "Ver todos" que lleva a Certificación filtrado por esa empresa. Es el mismo dato, en la vista que ya existe para recorrerlo.

- [ ] **Step 4: Verificar que no se perdió nada**

```bash
cd monitor-app/frontend && npx vitest run app/dashboard/carriers && npx tsc --noEmit && npm run build
```

Comparar contra el inventario del Step 1: cada fila tiene que tener destino.

- [ ] **Step 5: Commit**

```bash
git add -A monitor-app/frontend
git commit -m "refactor(empresas): la ficha pasa a ser una pagina plana

Los seis tabs existian para separar 'lo de adentro' de 'lo mio', que con la
gramatica del zoom son dos secciones. Para saber como esta una empresa ya no
hay que recorrer cuatro pestanas.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Retirar los listados viejos

**Files:**
- Delete: `components/dashboard/TransporterDocumentsPanel.tsx`, `DocumentChecklist.tsx` y sus tests
- Modify: los consumidores que queden

- [ ] **Step 1: Confirmar que no quedan consumidores**

```bash
cd monitor-app/frontend && grep -rn "TransporterDocumentsPanel\|DocumentChecklist" app components lib | grep -v node_modules
```

Si aparece alguno, migrarlo a `DocumentList` antes de seguir.

- [ ] **Step 2: Borrar**

```bash
git rm monitor-app/frontend/components/dashboard/TransporterDocumentsPanel.tsx \
       monitor-app/frontend/components/dashboard/TransporterDocumentsPanel.test.tsx \
       monitor-app/frontend/components/dashboard/DocumentChecklist.tsx \
       monitor-app/frontend/components/dashboard/DocumentChecklist.test.tsx
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
- [ ] `npx vitest run && npx tsc --noEmit && npm run build` en el frontend: verde, con `/dashboard/drivers/[id]` y `/dashboard/assets/[id]` en el manifest.
- [ ] **Pasada de diseño**: correr `ui-ux-pro-max --design-system` y su checklist sobre las tres páginas. Contraste 4.5:1, `cursor-pointer`, foco visible, `prefers-reduced-motion`, y responsive a 375 / 768 / 1024 / 1440.
- [ ] **Mirar las tres pantallas renderizadas** con Playwright, en escritorio y en teléfono. No dar por lista ninguna sin haberla abierto.
- [ ] Click-through del recorrido completo, **con datos de prueba sembrados y borrados después**:
  - [ ] Certificación → una empresa → un conductor, y volver con las migas y con el botón atrás.
  - [ ] Cargar un documento desde cada uno de los tres niveles.
  - [ ] Reasignar desde cada nivel.
  - [ ] Un conductor **sin empresa asignada**: la página no rompe y explica por qué no se puede cargar.
  - [ ] Limpiar y confirmar con un conteo global (0 items, 0 lotes, 0 registros alterados, 0 filas de auditoría).

## Fuera de alcance

- **HU-05** (administración de requisitos) y **HU-06** (Seguros proyectado a cumplimiento). HU-06 es la que sacaría a Seguros del primer nivel y lo dejaría como sección de la empresa — encaja con este plan, pero es una HU propia.
- **El nivel 3, el documento**, como página con su historial. Hoy el historial de versiones vive dentro de la fila y alcanza.
- **Los 2.000 documentos** siguen sin entrar al sistema. Este plan no los trae; sigue siendo el bloqueante para que todo esto sirva.
