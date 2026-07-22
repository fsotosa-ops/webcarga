# Seguros: detalle inmersivo, antigüedad de mora, panel único — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el slide-over angosto de detalle de empresa por un modal inmersivo de 2 columnas con mecanismo de revertir pagos, reemplazar el gráfico de barras de Cobranza por un widget de antigüedad de mora, y fusionar los widgets sueltos de Pólizas en un solo panel.

**Architecture:** 3 cambios independientes en `/dashboard/seguros` (monitor-app/frontend) + 1 endpoint nuevo en el backend (monitor-app/backend/api). Sin librerías de gráficos nuevas — todo CSS/flex, mismo patrón que el donut ya existente.

**Tech Stack:** FastAPI + asyncpg (backend), Next.js 16 + TanStack Query + Tailwind v4 + lucide-react (frontend), pytest (backend tests), vitest + @testing-library/react (frontend tests).

## Global Constraints

- Spec de referencia: `docs/superpowers/specs/2026-07-11-seguros-detalle-inmersivo-design.md`.
- Colores exactos de las bandas de antigüedad: `0–30` → `#fbbf24`, `31–60` → `#f97316`, `61–90` → `#ef4444`, `+90` → `#991b1b`.
- Etiqueta de cuota: siempre "Cuota N de M" (o "Cuota N" si el total es desconocido) — nunca "#N".
- El selector de agrupamiento existente en Cobranza (Semana/Mes/Trimestre/Empresa/Aseguradora/Cliente GC) no cambia de comportamiento.
- No agregar dependencias nuevas (sin librerías de gráficos).
- Backend: `venv/bin/python -m pytest` desde `monitor-app/backend/api` (venv correcto, no `.venv`).
- Frontend: `npx vitest run` / `npx tsc --noEmit` / `npm run build` desde `monitor-app/frontend`.

---

### Task 1: Backend — endpoint para revertir un pago marcado por error

**Files:**
- Modify: `monitor-app/backend/api/app/schemas/insurance.py`
- Modify: `monitor-app/backend/api/app/routers/insurance.py`
- Test: `monitor-app/backend/api/tests/test_insurance.py`

**Interfaces:**
- Produces: `POST /api/v1/insurance/installments/{iid}/revert` con body `{ expected_updated_at?: string }`, devuelve el mismo shape que `PATCH /installments/{iid}` (installment serializado). 422 si la cuota no está `pagada`; 404 si no existe; 409 si `expected_updated_at` no coincide; 403 si el usuario no es admin.

- [ ] **Step 1: Escribir los tests que fallan primero**

Agregar al final de `monitor-app/backend/api/tests/test_insurance.py`:

```python
# ── Revertir cuota pagada ────────────────────────────────────────────

def test_revert_installment_marks_pendiente_when_due_date_in_future():
    pool = AsyncMock()
    pool.fetchrow.side_effect = [
        {"status": "pagada", "due_date": date(2026, 12, 1), "updated_at": None},
        {
            "id": "i1", "policy_id": "p1", "installment_number": 1, "total_installments": 2,
            "amount_uf": 3.5, "due_date": date(2026, 12, 1), "status": "pendiente",
            "paid_at": None, "payment_url": None, "manual_override": True,
            "updated_by": USER_ID, "updated_at": datetime.now(timezone.utc),
        },
    ]
    client = make_client(pool)
    res = client.post("/api/v1/insurance/installments/i1/revert", json={})
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "pendiente"
    assert data["paid_at"] is None
    update_sql = pool.fetchrow.call_args_list[1].args[0]
    assert "paid_at         = NULL" in update_sql


def test_revert_installment_marks_vencida_when_due_date_past():
    pool = AsyncMock()
    pool.fetchrow.side_effect = [
        {"status": "pagada", "due_date": date(2020, 1, 1), "updated_at": None},
        {
            "id": "i1", "policy_id": "p1", "installment_number": 1, "total_installments": 2,
            "amount_uf": 3.5, "due_date": date(2020, 1, 1), "status": "vencida",
            "paid_at": None, "payment_url": None, "manual_override": True,
            "updated_by": USER_ID, "updated_at": datetime.now(timezone.utc),
        },
    ]
    client = make_client(pool)
    res = client.post("/api/v1/insurance/installments/i1/revert", json={})
    assert res.status_code == 200
    assert res.json()["status"] == "vencida"


def test_revert_installment_requires_status_pagada():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"status": "pendiente", "due_date": date(2026, 12, 1), "updated_at": None}
    client = make_client(pool)
    res = client.post("/api/v1/insurance/installments/i1/revert", json={})
    assert res.status_code == 422


def test_revert_installment_missing_is_404():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)
    res = client.post("/api/v1/insurance/installments/i1/revert", json={})
    assert res.status_code == 404


def test_revert_installment_requires_admin():
    pool = AsyncMock()
    client = make_client(pool, role="editor", enforce_roles=True)
    res = client.post("/api/v1/insurance/installments/i1/revert", json={})
    assert res.status_code == 403
    pool.fetchrow.assert_not_called()


def test_revert_installment_stale_expected_updated_at_is_409():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "status": "pagada", "due_date": date(2026, 12, 1),
        "updated_at": datetime(2026, 7, 1, tzinfo=timezone.utc),
    }
    client = make_client(pool)
    res = client.post("/api/v1/insurance/installments/i1/revert", json={
        "expected_updated_at": "2026-06-01T00:00:00Z",
    })
    assert res.status_code == 409
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_insurance.py -k revert -v
```
Esperado: FAIL (404, la ruta no existe todavía).

- [ ] **Step 3: Agregar el schema**

En `monitor-app/backend/api/app/schemas/insurance.py`, agregar al final del archivo:

```python
class RevertInstallmentBody(BaseModel):
    expected_updated_at: Optional[datetime] = None
```

- [ ] **Step 4: Implementar el endpoint**

En `monitor-app/backend/api/app/routers/insurance.py`:

1. Cambiar la línea de import de `datetime` (agregar al inicio del archivo, junto a los imports de fastapi):
```python
from datetime import date
```

2. Cambiar el import de schemas para incluir `RevertInstallmentBody`:
```python
from ..schemas.insurance import InsuranceDocumentPatchBody, InstallmentPatchBody, PolicyPatchBody, RevertInstallmentBody
```

3. Agregar el endpoint inmediatamente después de `patch_installment` (antes de `patch_policy`):

```python
@router.post("/installments/{iid}/revert")
async def revert_installment_payment(
    iid: str, body: RevertInstallmentBody,
    pool=Depends(get_pool), user=Depends(require_admin),
):
    current = await pool.fetchrow(
        "SELECT status, due_date, updated_at FROM app.insurance_installments WHERE id = $1", iid,
    )
    if not current:
        raise HTTPException(404, "Cuota no encontrada")

    if current["status"] != "pagada":
        raise HTTPException(422, "Solo se puede revertir una cuota marcada como pagada")

    if body.expected_updated_at is not None and current["updated_at"] != body.expected_updated_at:
        raise HTTPException(409, "La cuota fue modificada por otro usuario; recargue e intente de nuevo")

    new_status = "vencida" if current["due_date"] and current["due_date"] < date.today() else "pendiente"

    row = await pool.fetchrow(
        """
        UPDATE app.insurance_installments SET
            status          = $2,
            paid_at         = NULL,
            manual_override = true,
            updated_by      = $3::uuid,
            updated_at      = NOW()
        WHERE id = $1
        RETURNING *
        """,
        iid, new_status, user["sub"],
    )
    return _serialize_installment(dict(row))
```

- [ ] **Step 5: Correr los tests, confirmar que pasan**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_insurance.py -v
```
Esperado: todos los tests del archivo pasan (los previos + los 6 nuevos de revert).

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api/app/schemas/insurance.py monitor-app/backend/api/app/routers/insurance.py monitor-app/backend/api/tests/test_insurance.py
git commit -m "feat(seguros): endpoint para revertir una cuota marcada como pagada"
```

---

### Task 2: Frontend — utilidades compartidas de cuotas (`dueRelative`, `cuotaLabel`)

**Files:**
- Create: `monitor-app/frontend/lib/utils/installments.ts`
- Test: `monitor-app/frontend/lib/utils/installments.test.ts`

**Interfaces:**
- Produces: `dueRelative(dueDate: string | null, isOverdue: boolean, today?: string): string | null`; `cuotaLabel(installmentNumber: number, totalInstallments: number | null): string`. Ambas se usan en Task 5 (`InstallmentRow.tsx`); `dueRelative` reemplaza la copia local hoy en `CobranzaTab.tsx` (se migra en Task 8).

- [ ] **Step 1: Escribir los tests que fallan primero**

```typescript
// lib/utils/installments.test.ts
import { describe, it, expect } from 'vitest'
import { dueRelative, cuotaLabel } from './installments'

describe('dueRelative', () => {
  it('returns null when there is no due date', () => {
    expect(dueRelative(null, false, '2026-07-10')).toBeNull()
  })

  it('returns "vence hoy" for today', () => {
    expect(dueRelative('2026-07-10', false, '2026-07-10')).toBe('vence hoy')
  })

  it('returns a future-relative message for a date ahead', () => {
    expect(dueRelative('2026-07-15', false, '2026-07-10')).toBe('vence en 5 días')
  })

  it('returns a past-relative message only when overdue', () => {
    expect(dueRelative('2026-07-07', true, '2026-07-10')).toBe('vencida hace 3 días')
  })

  it('returns null for a past date that is not marked overdue', () => {
    expect(dueRelative('2026-07-07', false, '2026-07-10')).toBeNull()
  })

  it('uses singular "día" for exactly 1 day', () => {
    expect(dueRelative('2026-07-11', false, '2026-07-10')).toBe('vence en 1 día')
  })
})

describe('cuotaLabel', () => {
  it('includes the total when known', () => {
    expect(cuotaLabel(1, 5)).toBe('Cuota 1 de 5')
  })

  it('falls back to just the number when the total is unknown', () => {
    expect(cuotaLabel(3, null)).toBe('Cuota 3')
  })
})
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

```bash
cd monitor-app/frontend && npx vitest run lib/utils/installments.test.ts
```
Esperado: FAIL (`installments.ts` no existe).

- [ ] **Step 3: Implementar**

```typescript
// lib/utils/installments.ts

/** Utilidades compartidas para mostrar cuotas de seguros — usadas tanto en
 *  Cobranza (lista plana) como en el detalle de póliza (modal). */

const TODAY = () => new Date().toISOString().slice(0, 10)

/** "vence en 3 días" / "vencida hace 4 días" / "vence hoy" — opera sobre
 *  fechas YYYY-MM-DD sin hora, y es bidireccional (pasado y futuro). */
export function dueRelative(dueDate: string | null, isOverdue: boolean, today: string = TODAY()): string | null {
  if (!dueDate) return null
  const diffDays = Math.round((new Date(dueDate + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000)
  if (diffDays === 0) return 'vence hoy'
  if (diffDays > 0) return `vence en ${diffDays} día${diffDays === 1 ? '' : 's'}`
  return isOverdue ? `vencida hace ${Math.abs(diffDays)} día${Math.abs(diffDays) === 1 ? '' : 's'}` : null
}

/** "Cuota 1 de 5" — si no se conoce el total (`totalInstallments` null), cae
 *  a "Cuota 1". Nunca usar "#N" (se ve tosco). */
export function cuotaLabel(installmentNumber: number, totalInstallments: number | null): string {
  return totalInstallments != null ? `Cuota ${installmentNumber} de ${totalInstallments}` : `Cuota ${installmentNumber}`
}
```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

```bash
cd monitor-app/frontend && npx vitest run lib/utils/installments.test.ts
```
Esperado: PASS (8/8).

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/lib/utils/installments.ts monitor-app/frontend/lib/utils/installments.test.ts
git commit -m "feat(seguros): utilidades compartidas dueRelative/cuotaLabel"
```

---

### Task 3: Frontend — bandas de antigüedad de mora (`agingBucket`)

**Files:**
- Modify: `monitor-app/frontend/lib/utils/insuranceGrouping.ts`
- Test: `monitor-app/frontend/lib/utils/insuranceGrouping.test.ts`

**Interfaces:**
- Produces: `export type AgingBand = '0-30' | '31-60' | '61-90' | '90+'`; `agingBucket(row: Pick<InsuranceInstallmentFlat, 'due_date' | 'is_overdue'>, today?: string): AgingBand | null` (null si la cuota no está vencida). Se usa en Task 8 (`CobranzaTab.tsx`).

- [ ] **Step 1: Escribir los tests que fallan primero**

Agregar al final de `monitor-app/frontend/lib/utils/insuranceGrouping.test.ts` (reusa el helper `row()` ya definido arriba en el archivo):

```typescript
describe('agingBucket', () => {
  it('returns null for a row that is not overdue', () => {
    expect(agingBucket(row({ is_overdue: false, due_date: '2026-07-01' }), '2026-07-10')).toBeNull()
  })

  it('returns null when due_date is missing', () => {
    expect(agingBucket(row({ is_overdue: true, due_date: null }), '2026-07-10')).toBeNull()
  })

  it('buckets 0-30 days overdue', () => {
    expect(agingBucket(row({ is_overdue: true, due_date: '2026-06-20' }), '2026-07-10')).toBe('0-30')
  })

  it('buckets exactly 30 days as 0-30 (boundary)', () => {
    expect(agingBucket(row({ is_overdue: true, due_date: '2026-06-10' }), '2026-07-10')).toBe('0-30')
  })

  it('buckets 31-60 days overdue', () => {
    expect(agingBucket(row({ is_overdue: true, due_date: '2026-05-20' }), '2026-07-10')).toBe('31-60')
  })

  it('buckets 61-90 days overdue', () => {
    expect(agingBucket(row({ is_overdue: true, due_date: '2026-04-20' }), '2026-07-10')).toBe('61-90')
  })

  it('buckets more than 90 days overdue as 90+', () => {
    expect(agingBucket(row({ is_overdue: true, due_date: '2026-01-01' }), '2026-07-10')).toBe('90+')
  })
})
```

Y agregar `agingBucket` al import existente en la línea 2 del archivo:
```typescript
import { groupInstallments, agingBucket } from './insuranceGrouping'
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

```bash
cd monitor-app/frontend && npx vitest run lib/utils/insuranceGrouping.test.ts
```
Esperado: FAIL (`agingBucket` no existe).

- [ ] **Step 3: Implementar**

Agregar en `monitor-app/frontend/lib/utils/insuranceGrouping.ts`, después de la definición de `GroupBy` (línea 3):

```typescript
export type AgingBand = '0-30' | '31-60' | '61-90' | '90+'

/** Banda de antigüedad de una cuota vencida, en días desde su vencimiento.
 *  Devuelve null si la cuota no está vencida — la antigüedad no aplica. */
export function agingBucket(
  row: Pick<InsuranceInstallmentFlat, 'due_date' | 'is_overdue'>,
  today: string = new Date().toISOString().slice(0, 10),
): AgingBand | null {
  if (!row.is_overdue || !row.due_date) return null
  const diffDays = Math.round(
    (new Date(today + 'T00:00:00').getTime() - new Date(row.due_date + 'T00:00:00').getTime()) / 86400000,
  )
  if (diffDays <= 30) return '0-30'
  if (diffDays <= 60) return '31-60'
  if (diffDays <= 90) return '61-90'
  return '90+'
}
```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

```bash
cd monitor-app/frontend && npx vitest run lib/utils/insuranceGrouping.test.ts
```
Esperado: PASS (12/12 — 5 previos + 7 nuevos).

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/lib/utils/insuranceGrouping.ts monitor-app/frontend/lib/utils/insuranceGrouping.test.ts
git commit -m "feat(seguros): agingBucket — bandas de antigüedad de mora"
```

---

### Task 4: Frontend — `DocumentChecklist` como lista vertical (reemplaza nodos circulares)

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/DocumentChecklist.tsx`
- Test: `monitor-app/frontend/components/dashboard/DocumentChecklist.test.tsx`

**Interfaces:**
- Consumes: nada nuevo — mismo `ChecklistItem`/`Props` que ya existen.
- Produces: mismo contrato público (`items`, `canEdit`, `onUpload`) — el cambio es solo de render interno (lista vertical en vez de nodos circulares en tira horizontal) más un contador "X de N completos". Task 6 (`InsurancePolicyModal.tsx`) consume esto sin cambios en su forma de invocarlo.

- [ ] **Step 1: Escribir el test que falla primero**

Agregar al final de `monitor-app/frontend/components/dashboard/DocumentChecklist.test.tsx`:

```typescript
  it('shows a completion count', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} />)
    expect(screen.getByText('1 de 3 completos')).toBeInTheDocument()
  })
```

(Nota: con `ITEMS` tal como está definido arriba en el archivo — 1 `ok`, 1 `actualizar`, 1 `null` — solo el primero cuenta como completo.)

- [ ] **Step 2: Correr el test, confirmar que falla**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/DocumentChecklist.test.tsx
```
Esperado: FAIL (el texto "1 de 3 completos" no existe todavía).

- [ ] **Step 3: Reescribir el componente**

Reemplazar el contenido completo de `monitor-app/frontend/components/dashboard/DocumentChecklist.tsx`:

```tsx
'use client'

import { Check, Circle, AlertTriangle, Upload } from 'lucide-react'

export type ChecklistItem = {
  doc_code:     string
  label:        string
  status:       'ok' | 'pendiente' | 'actualizar' | 'n_a' | 'factible' | null
  expiry_date:  string | null
  has_expiry:   boolean
}

interface Props {
  items:     ChecklistItem[]
  canEdit:   boolean
  onUpload:  (docCode: string, file: File) => void
}

const TODAY = () => new Date().toISOString().slice(0, 10)

function nodeState(item: ChecklistItem): 'ok' | 'overdue' | 'pending' {
  if (item.status === 'ok') {
    if (item.has_expiry && item.expiry_date && item.expiry_date < TODAY()) return 'overdue'
    return 'ok'
  }
  if (item.status === 'actualizar') return 'overdue'
  if (item.status === 'n_a' || item.status === 'factible') return 'ok'
  return 'pending'
}

function stateLabel(state: 'ok' | 'overdue' | 'pending'): string {
  return state === 'ok' ? 'al día' : state === 'overdue' ? 'vencido' : 'pendiente'
}

/** Checklist de documentos de una póliza — lista vertical de filas (icono +
 *  nombre + acción). Genérico: no importa nada específico de Seguros, así
 *  que se puede reusar tal cual en un futuro rediseño de Empresas. */
export function DocumentChecklist({ items, canEdit, onUpload }: Props) {
  const okCount = items.filter(item => nodeState(item) === 'ok').length

  return (
    <div>
      {items.length > 0 && (
        <p className="text-xs text-gray-400 mb-2">{okCount} de {items.length} completos</p>
      )}
      <div className="flex flex-col gap-1.5">
        {items.map(item => {
          const state = nodeState(item)
          const iconCls = state === 'ok'
            ? 'bg-green-500 border-green-500 text-white'
            : state === 'overdue'
              ? 'bg-red-500 border-red-500 text-white'
              : 'bg-white border-amber-400 text-amber-500'
          return (
            <div
              key={item.doc_code}
              title={`${item.label} — ${stateLabel(state)}`}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-gray-50"
            >
              <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${iconCls}`}>
                {state === 'ok' ? <Check size={11} /> : state === 'overdue' ? <AlertTriangle size={10} /> : <Circle size={10} />}
              </span>
              <span className="text-xs font-semibold text-text-primary flex-1 truncate">{item.label}</span>
              {canEdit && (
                <label className="flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline cursor-pointer shrink-0">
                  <Upload size={11} /> Subir
                  <input
                    type="file"
                    className="hidden"
                    aria-label={`Subir ${item.label}`}
                    onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(item.doc_code, f) }}
                  />
                </label>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/DocumentChecklist.test.tsx
```
Esperado: PASS (6/6 — los 5 previos siguen pasando sin cambios porque `title`/`aria-label` no cambiaron, + el nuevo del contador).

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/DocumentChecklist.tsx monitor-app/frontend/components/dashboard/DocumentChecklist.test.tsx
git commit -m "redesign(seguros): DocumentChecklist como lista vertical con contador"
```

---

### Task 5: Frontend — `InstallmentRow` (fila de cuota: Pagar / revertir)

**Files:**
- Modify: `monitor-app/frontend/lib/api/insurance.ts` (agrega `revertInstallment`)
- Create: `monitor-app/frontend/components/dashboard/InstallmentRow.tsx`
- Test: `monitor-app/frontend/components/dashboard/InstallmentRow.test.tsx`

**Interfaces:**
- Consumes: `dueRelative`/`cuotaLabel` (Task 2), `insuranceApi.patchInstallment` (ya existe), `insuranceApi.revertInstallment` (nuevo, este task), endpoint de Task 1.
- Produces: `<InstallmentRow installment={InsuranceInstallment} canAdmin={boolean} onChanged={(updated: InsuranceInstallment) => void} />`. Task 6 (`InsurancePolicyModal.tsx`) la usa tanto para la cuota destacada como para la lista completa expandida.

- [ ] **Step 1: Agregar el cliente API**

En `monitor-app/frontend/lib/api/insurance.ts`, agregar el tipo y el método (junto a `patchInstallment`):

```typescript
export type RevertInstallmentPatch = {
  expected_updated_at?: string
}
```

Y dentro del objeto `insuranceApi`, después de `patchInstallment`:

```typescript
  revertInstallment: (iid: string, body: RevertInstallmentPatch) =>
    apiFetch<InsuranceInstallment>(`/api/v1/insurance/installments/${iid}/revert`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
```

- [ ] **Step 2: Escribir los tests que fallan primero**

```typescript
// components/dashboard/InstallmentRow.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { InstallmentRow } from './InstallmentRow'
import { insuranceApi } from '@/lib/api/insurance'
import type { InsuranceInstallment } from '@/lib/types'

vi.mock('@/lib/api/insurance', () => ({
  insuranceApi: {
    patchInstallment:   vi.fn(),
    revertInstallment:  vi.fn(),
  },
}))

const PENDING: InsuranceInstallment = {
  id: 'i1', policy_id: 'p1', installment_number: 4, total_installments: 5,
  amount_uf: 4.54, due_date: '2099-01-01', status: 'pendiente', paid_at: null,
  payment_url: null, manual_override: false, updated_at: '2026-07-01T00:00:00Z',
}

const PAID: InsuranceInstallment = {
  ...PENDING, status: 'pagada', paid_at: '2026-06-01',
}

beforeEach(() => {
  vi.mocked(insuranceApi.patchInstallment).mockReset()
  vi.mocked(insuranceApi.revertInstallment).mockReset()
})

describe('InstallmentRow — pendiente', () => {
  it('shows the "Cuota N de M" label and amount', () => {
    render(<InstallmentRow installment={PENDING} canAdmin={true} onChanged={vi.fn()} />)
    expect(screen.getByText(/Cuota 4 de 5/)).toBeInTheDocument()
    expect(screen.getByText('4.54 UF')).toBeInTheDocument()
  })

  it('disables Pagar for a non-admin', () => {
    render(<InstallmentRow installment={PENDING} canAdmin={false} onChanged={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Pagar/i })).toBeDisabled()
  })

  it('calls patchInstallment and onChanged when Pagar is clicked by an admin', async () => {
    const onChanged = vi.fn()
    vi.mocked(insuranceApi.patchInstallment).mockResolvedValue(PAID)
    render(<InstallmentRow installment={PENDING} canAdmin={true} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: /Pagar/i }))
    await waitFor(() => expect(insuranceApi.patchInstallment).toHaveBeenCalledWith('i1', expect.objectContaining({ status: 'pagada' })))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(PAID))
  })

  it('shows a visible error when marking as paid fails', async () => {
    vi.mocked(insuranceApi.patchInstallment).mockRejectedValue(new Error('La cuota fue modificada por otro usuario'))
    render(<InstallmentRow installment={PENDING} canAdmin={true} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Pagar/i }))
    expect(await screen.findByText('La cuota fue modificada por otro usuario')).toBeInTheDocument()
  })

  it('does not render a revert control', () => {
    render(<InstallmentRow installment={PENDING} canAdmin={true} onChanged={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /revertir/i })).not.toBeInTheDocument()
  })
})

describe('InstallmentRow — pagada', () => {
  it('does not render a Pagar button', () => {
    render(<InstallmentRow installment={PAID} canAdmin={true} onChanged={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /^Pagar$/i })).not.toBeInTheDocument()
  })

  it('does not render a revert control for a non-admin', () => {
    render(<InstallmentRow installment={PAID} canAdmin={false} onChanged={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /revertir/i })).not.toBeInTheDocument()
  })

  it('shows a confirmation popover when revertir is clicked, and does nothing on "No"', () => {
    render(<InstallmentRow installment={PAID} canAdmin={true} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /revertir/i }))
    expect(screen.getByText('¿Revertir a pendiente?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    expect(screen.queryByText('¿Revertir a pendiente?')).not.toBeInTheDocument()
    expect(insuranceApi.revertInstallment).not.toHaveBeenCalled()
  })

  it('calls revertInstallment and onChanged when confirmed with "Sí"', async () => {
    const onChanged = vi.fn()
    vi.mocked(insuranceApi.revertInstallment).mockResolvedValue(PENDING)
    render(<InstallmentRow installment={PAID} canAdmin={true} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: /revertir/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí' }))
    await waitFor(() => expect(insuranceApi.revertInstallment).toHaveBeenCalledWith('i1', expect.objectContaining({ expected_updated_at: PAID.updated_at })))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(PENDING))
  })

  it('shows a visible error when reverting fails', async () => {
    vi.mocked(insuranceApi.revertInstallment).mockRejectedValue(new Error('Solo se puede revertir una cuota marcada como pagada'))
    render(<InstallmentRow installment={PAID} canAdmin={true} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /revertir/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí' }))
    expect(await screen.findByText('Solo se puede revertir una cuota marcada como pagada')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Correr los tests, confirmar que fallan**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/InstallmentRow.test.tsx
```
Esperado: FAIL (`InstallmentRow.tsx` no existe).

- [ ] **Step 4: Implementar el componente**

```tsx
// components/dashboard/InstallmentRow.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Circle, AlertTriangle, Loader2, Undo2 } from 'lucide-react'
import { insuranceApi } from '@/lib/api/insurance'
import type { InsuranceInstallment } from '@/lib/types'
import { formatExpiry } from '@/lib/compliance'
import { dueRelative, cuotaLabel } from '@/lib/utils/installments'

const TODAY = () => new Date().toISOString().slice(0, 10)

function isEffectivelyOverdue(inst: InsuranceInstallment): boolean {
  return inst.status === 'vencida' || (inst.status === 'pendiente' && !!inst.due_date && inst.due_date < TODAY())
}

interface Props {
  installment: InsuranceInstallment
  canAdmin:    boolean
  onChanged:   (updated: InsuranceInstallment) => void
}

/** Una fila de cuota: ícono de estado + "Cuota N de M" + fecha + monto +
 *  acción (Pagar, o revertir si ya está pagada). El botón de revertir
 *  siempre está en el DOM (funciona en touch), solo se atenúa visualmente
 *  hasta el hover/foco — no depende de un gesto de long-press. */
export function InstallmentRow({ installment, canAdmin, onChanged }: Props) {
  const [saving, setSaving]         = useState(false)
  const [err, setErr]               = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  const overdue  = isEffectivelyOverdue(installment)
  const paid     = installment.status === 'pagada'
  const relative = dueRelative(installment.due_date, overdue)

  useEffect(() => {
    if (!confirming) return
    function onOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setConfirming(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [confirming])

  async function markPaid() {
    setSaving(true); setErr(null)
    try {
      const updated = await insuranceApi.patchInstallment(installment.id, {
        status: 'pagada',
        paid_at: TODAY(),
        expected_updated_at: installment.updated_at ?? undefined,
      })
      onChanged(updated)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al marcar como pagada')
    } finally {
      setSaving(false)
    }
  }

  async function revert() {
    setSaving(true); setErr(null); setConfirming(false)
    try {
      const updated = await insuranceApi.revertInstallment(installment.id, {
        expected_updated_at: installment.updated_at ?? undefined,
      })
      onChanged(updated)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al revertir el pago')
    } finally {
      setSaving(false)
    }
  }

  const nodeCls = paid
    ? 'bg-green-500 border-green-500 text-white'
    : overdue
      ? 'bg-red-500 border-red-500 text-white'
      : 'bg-white border-amber-400 text-amber-500'

  return (
    <div className="group flex flex-wrap items-center gap-3 px-3 py-2.5 rounded-lg bg-gray-50">
      <span className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 ${nodeCls}`}>
        {paid ? <Check size={14} /> : overdue ? <AlertTriangle size={13} /> : <Circle size={13} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-text-primary truncate">
          {cuotaLabel(installment.installment_number, installment.total_installments)}
          {paid && installment.paid_at ? ` · pagada el ${formatExpiry(installment.paid_at)}` : ''}
        </p>
        {!paid && (
          <p className={`text-[11px] ${overdue ? 'text-red-500' : 'text-gray-400'}`}>
            {formatExpiry(installment.due_date)}{relative ? ` · ${relative}` : ''}
          </p>
        )}
      </div>
      <span className="text-xs font-bold text-text-primary tabular-nums shrink-0">
        {installment.amount_uf != null ? `${installment.amount_uf} UF` : '—'}
      </span>

      {!paid && (
        <button
          type="button"
          onClick={markPaid}
          disabled={!canAdmin || saving}
          title={!canAdmin ? 'Solo un administrador puede marcar cuotas como pagadas' : undefined}
          className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border border-border text-gray-500 hover:text-accent hover:border-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          Pagar
        </button>
      )}

      {paid && canAdmin && (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={saving}
            className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full text-gray-400 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 hover:text-red-500 transition-opacity"
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />}
            revertir
          </button>

          {confirming && (
            <div
              ref={popoverRef}
              className="absolute right-0 top-full mt-2 z-10 flex items-center gap-2.5 bg-slate-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg whitespace-nowrap"
            >
              <span>¿Revertir a pendiente?</span>
              <button onClick={() => setConfirming(false)} className="font-semibold text-slate-400 hover:text-white">No</button>
              <button onClick={revert} className="font-semibold bg-red-600 hover:bg-red-500 rounded px-2 py-0.5">Sí</button>
            </div>
          )}
        </div>
      )}

      {err && <p className="text-[10px] text-red-500 shrink-0 basis-full">{err}</p>}
    </div>
  )
}
```

- [ ] **Step 5: Correr los tests, confirmar que pasan**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/InstallmentRow.test.tsx
```
Esperado: PASS (11/11).

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/lib/api/insurance.ts monitor-app/frontend/components/dashboard/InstallmentRow.tsx monitor-app/frontend/components/dashboard/InstallmentRow.test.tsx
git commit -m "feat(seguros): InstallmentRow — Pagar y revertir con confirmación"
```

---

### Task 6: Frontend — `InsurancePolicyModal` (modal inmersivo de 2 columnas, reemplaza el slide-over)

**Files:**
- Create: `monitor-app/frontend/components/dashboard/InsurancePolicyModal.tsx`
- Test: `monitor-app/frontend/components/dashboard/InsurancePolicyModal.test.tsx`
- Delete: `monitor-app/frontend/components/dashboard/InsurancePolicySlideOver.tsx`
- Delete: `monitor-app/frontend/components/dashboard/InsurancePolicySlideOver.test.tsx`

**Interfaces:**
- Consumes: `InstallmentRow` (Task 5), `DocumentChecklist` (Task 4), `initialsOf`/`PaidProgressBar` (ya exportados desde `InsuranceCompanyCard.tsx`), `insuranceApi.getForTransporter`/`listPolicyDocuments`/`uploadDocumentFile` (ya existen).
- Produces: `<InsurancePolicyModal row={InsuranceSummaryRow | null} onClose={() => void} canAdmin={boolean} canEdit={boolean} />` — mismo contrato de props que `InsurancePolicySlideOver` (drop-in replacement). Task 7 (`PolizasTab.tsx`) lo consume.

- [ ] **Step 1: Escribir los tests que fallan primero**

```typescript
// components/dashboard/InsurancePolicyModal.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InsurancePolicyModal } from './InsurancePolicyModal'
import { insuranceApi } from '@/lib/api/insurance'
import type { InsuranceSummaryRow, InsuranceTransporterResponse } from '@/lib/types'

vi.mock('@/lib/api/insurance', () => ({
  insuranceApi: {
    getForTransporter:  vi.fn(),
    patchInstallment:   vi.fn(),
    revertInstallment:  vi.fn(),
    listPolicyDocuments: vi.fn(),
    uploadDocumentFile:  vi.fn(),
  },
}))

const ROW: InsuranceSummaryRow = {
  rut: '22222222-2', business_name: 'Transportes Vencido', transporter_id: 't2',
  policies_count: 2, next_due: null, overdue_count: 1, paid_pct: 50, insurance_ok: false,
}

const TWO_POLICIES: InsuranceTransporterResponse = {
  rut: '22222222-2', transporter_id: 't2',
  policies: [
    {
      id: 'p1', transporter_id: 't2', rut: '22222222-2', contractor_name: null, client_group: null,
      company: 'Chubb Generales', policy_number: '5663040', endorsement: null, coverage: 'RC vehicular',
      plate: null, policy_type: 'otro', valid_from: '2026-03-23', valid_to: '2027-03-23',
      payment_url: null, file_url: null, storage_path: null, updated_at: '2026-07-01T00:00:00Z',
      installments: [
        { id: 'i1', policy_id: 'p1', installment_number: 1, total_installments: 2, amount_uf: 4, due_date: '2020-01-01', status: 'vencida', paid_at: null, payment_url: null, manual_override: false, updated_at: '2026-07-01T00:00:00Z' },
        { id: 'i2', policy_id: 'p1', installment_number: 2, total_installments: 2, amount_uf: 4, due_date: '2099-09-01', status: 'pendiente', paid_at: null, payment_url: null, manual_override: false, updated_at: '2026-07-01T00:00:00Z' },
      ],
    },
    {
      id: 'p2', transporter_id: 't2', rut: '22222222-2', contractor_name: null, client_group: null,
      company: 'HDI', policy_number: '89632', endorsement: null, coverage: 'RC vehicular',
      plate: null, policy_type: 'otro', valid_from: null, valid_to: null,
      payment_url: null, file_url: null, storage_path: null, updated_at: '2026-07-01T00:00:00Z',
      installments: [
        { id: 'i3', policy_id: 'p2', installment_number: 1, total_installments: 1, amount_uf: 2.5, due_date: '2026-05-01', status: 'pagada', paid_at: '2026-05-01', payment_url: null, manual_override: false, updated_at: '2026-07-01T00:00:00Z' },
      ],
    },
  ],
}

function renderModal(row: InsuranceSummaryRow | null, opts: { canAdmin?: boolean; canEdit?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <InsurancePolicyModal row={row} onClose={vi.fn()} canAdmin={opts.canAdmin ?? true} canEdit={opts.canEdit ?? true} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(insuranceApi.getForTransporter).mockReset().mockResolvedValue(TWO_POLICIES)
  vi.mocked(insuranceApi.listPolicyDocuments).mockReset().mockResolvedValue([
    { doc_code: 'poliza_firmada', label: 'Póliza firmada', has_expiry: false, id: 'd1', status: 'ok', expiry_date: null, file_url: null, storage_path: null, notes: null, manual_override: false, updated_at: '2026-07-01T00:00:00Z' },
  ])
  vi.mocked(insuranceApi.uploadDocumentFile).mockReset()
  vi.mocked(insuranceApi.patchInstallment).mockReset()
  vi.mocked(insuranceApi.revertInstallment).mockReset()
})

describe('InsurancePolicyModal', () => {
  it('renders no dialog content when row is null', () => {
    renderModal(null)
    expect(screen.queryByText('Chubb Generales')).not.toBeInTheDocument()
  })

  it('shows a policy switcher when the company has more than one policy', async () => {
    renderModal(ROW)
    expect(await screen.findByText('Chubb Generales')).toBeInTheDocument()
    expect(screen.getByText('Pólizas (2)')).toBeInTheDocument()
    expect(screen.getByText('HDI')).toBeInTheDocument()
  })

  it('spotlights the oldest overdue installment as "próxima cuota"', async () => {
    renderModal(ROW)
    await screen.findByText('Chubb Generales')
    expect(screen.getByText('Próxima cuota')).toBeInTheDocument()
    expect(screen.getByText(/Cuota 1 de 2/)).toBeInTheDocument()
  })

  it('switches the selected policy when clicking another one in the list', async () => {
    renderModal(ROW)
    await screen.findByText('Chubb Generales')
    fireEvent.click(screen.getByText('HDI'))
    await waitFor(() => expect(screen.getByText('Póliza 89632')).toBeInTheDocument())
    // HDI solo tiene una cuota, ya pagada — no hay "próxima cuota" que destacar
    expect(screen.queryByText('Próxima cuota')).not.toBeInTheDocument()
  })

  it('expands the full installment list when "Ver todas las cuotas" is clicked', async () => {
    renderModal(ROW)
    await screen.findByText('Chubb Generales')
    fireEvent.click(screen.getByText(/Ver todas las cuotas \(2\)/))
    expect(await screen.findByText(/Cuota 2 de 2/)).toBeInTheDocument()
  })

  it('fetches and renders the document checklist for the selected policy', async () => {
    renderModal(ROW)
    await screen.findByText('Chubb Generales')
    expect(await screen.findByText('Póliza firmada')).toBeInTheDocument()
    expect(insuranceApi.listPolicyDocuments).toHaveBeenCalledWith('p1')
  })

  it('shows a message when the company has no linked transporter profile', () => {
    renderModal({ ...ROW, transporter_id: null })
    expect(screen.getByText(/no tiene ficha vinculada/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/InsurancePolicyModal.test.tsx
```
Esperado: FAIL (`InsurancePolicyModal.tsx` no existe).

- [ ] **Step 3: Implementar el componente**

```tsx
// components/dashboard/InsurancePolicyModal.tsx
'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Loader2, ShieldQuestion, ShieldCheck, ShieldAlert, ChevronDown, ChevronUp } from 'lucide-react'
import { insuranceApi } from '@/lib/api/insurance'
import type { InsuranceInstallment, InsurancePolicy, InsuranceSummaryRow } from '@/lib/types'
import { formatExpiry } from '@/lib/compliance'
import { DocumentChecklist } from './DocumentChecklist'
import { InstallmentRow } from './InstallmentRow'
import { initialsOf } from './InsuranceCompanyCard'

const TODAY = () => new Date().toISOString().slice(0, 10)

function isEffectivelyOverdue(inst: InsuranceInstallment): boolean {
  return inst.status === 'vencida' || (inst.status === 'pendiente' && !!inst.due_date && inst.due_date < TODAY())
}

/** La cuota a destacar: la vencida más antigua si hay alguna, si no la
 *  pendiente que vence antes. null si todas las cuotas están pagadas. */
function nextActionable(installments: InsuranceInstallment[]): InsuranceInstallment | null {
  const unpaid = installments.filter(i => i.status !== 'pagada')
  if (unpaid.length === 0) return null
  const overdue = unpaid.filter(isEffectivelyOverdue)
  const pool = overdue.length > 0 ? overdue : unpaid
  return pool.slice().sort((a, b) => (a.due_date ?? '9999-99-99').localeCompare(b.due_date ?? '9999-99-99'))[0]
}

interface Props {
  row:      InsuranceSummaryRow | null
  onClose:  () => void
  canAdmin: boolean
  canEdit:  boolean
}

/** Modal inmersivo de 2 columnas: lista de pólizas (si hay más de una) +
 *  detalle de la póliza seleccionada (próxima cuota destacada, resto
 *  colapsado detrás de "Ver todas", documentos). Reemplaza el slide-over
 *  angosto anterior (scroll horizontal que se cortaba en el borde). */
export function InsurancePolicyModal({ row, onClose, canAdmin, canEdit }: Props) {
  const open = !!row
  const queryClient = useQueryClient()
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [docUploadErr, setDocUploadErr] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['insurance', 'transporter', row?.transporter_id],
    queryFn: () => insuranceApi.getForTransporter(row!.transporter_id!),
    enabled: open && !!row?.transporter_id,
  })

  const policies = query.data?.policies ?? []

  useEffect(() => {
    if (policies.length === 0) { setSelectedPolicyId(null); return }
    if (!selectedPolicyId || !policies.some(p => p.id === selectedPolicyId)) {
      setSelectedPolicyId(policies[0].id)
    }
  }, [policies, selectedPolicyId])

  useEffect(() => { setShowAll(false) }, [selectedPolicyId])

  const docsQuery = useQuery({
    queryKey: ['insurance', 'policy-documents', selectedPolicyId],
    queryFn: () => insuranceApi.listPolicyDocuments(selectedPolicyId!),
    enabled: open && !!selectedPolicyId,
  })

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  function handleInstallmentChanged(policyId: string, updated: InsuranceInstallment) {
    queryClient.setQueryData(
      ['insurance', 'transporter', row?.transporter_id],
      (old: { rut: string; transporter_id: string; policies: InsurancePolicy[] } | undefined) =>
        old ? {
          ...old,
          policies: old.policies.map(p => p.id === policyId
            ? { ...p, installments: (p.installments ?? []).map(i => i.id === updated.id ? updated : i) }
            : p),
        } : old,
    )
  }

  async function handleDocUpload(docCode: string, file: File) {
    if (!selectedPolicyId) return
    try {
      await insuranceApi.uploadDocumentFile(selectedPolicyId, docCode, file)
      setDocUploadErr(null)
      queryClient.invalidateQueries({ queryKey: ['insurance', 'policy-documents', selectedPolicyId] })
    } catch (e) {
      setDocUploadErr(e instanceof Error ? e.message : 'Error al subir el documento')
    }
  }

  if (!open || !row) return null

  const displayName = row.business_name ?? row.rut
  const selectedPolicy = policies.find(p => p.id === selectedPolicyId) ?? null
  const installments = selectedPolicy?.installments ?? []
  const spotlight = nextActionable(installments)
  const sortedInstallments = installments.slice().sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))

  const statusBadge = row.overdue_count > 0
    ? { cls: 'bg-red-50 text-red-600', icon: <ShieldAlert size={11} />, label: `${row.overdue_count} vencida${row.overdue_count > 1 ? 's' : ''}` }
    : row.policies_count === 0
      ? { cls: 'bg-gray-100 text-gray-500', icon: <ShieldQuestion size={11} />, label: 'Sin información' }
      : { cls: 'bg-green-50 text-green-600', icon: <ShieldCheck size={11} />, label: 'Al día' }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Pólizas de ${displayName}`}
          tabIndex={-1}
          className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col sm:flex-row focus:outline-none"
        >
          <button onClick={onClose} aria-label="Cerrar detalle de pólizas" className="absolute top-4 right-4 z-10 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>

          {policies.length > 1 && (
            <div className="sm:w-[34%] shrink-0 bg-gray-50 border-b sm:border-b-0 sm:border-r border-border overflow-y-auto p-4">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-9 h-9 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xs font-bold shrink-0">
                  {initialsOf(displayName)}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-text-primary truncate">{displayName}</p>
                  <p className="text-[10px] text-gray-400">{row.rut}</p>
                </div>
              </div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Pólizas ({policies.length})</p>
              <div className="flex sm:flex-col gap-2 overflow-x-auto sm:overflow-visible">
                {policies.map(p => {
                  const active = p.id === selectedPolicyId
                  const overdueCount = (p.installments ?? []).filter(isEffectivelyOverdue).length
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedPolicyId(p.id)}
                      className={`text-left px-3 py-2 rounded-lg shrink-0 transition-colors ${
                        active ? 'bg-white shadow-sm border-l-2 border-accent' : 'hover:bg-white/60'
                      }`}
                    >
                      <p className={`text-xs font-bold ${active ? 'text-text-primary' : 'text-gray-500'}`}>{p.company}</p>
                      <p className={`text-[10px] ${overdueCount > 0 ? 'text-red-500 font-semibold' : 'text-green-600'}`}>
                        {overdueCount > 0 ? `${overdueCount} vencida${overdueCount > 1 ? 's' : ''}` : 'al día'}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex-1 min-w-0 overflow-y-auto p-5 sm:p-6">
            {!row.transporter_id ? (
              <p className="text-sm text-gray-400 flex items-center gap-2 pt-2">
                <ShieldQuestion size={16} /> Esta empresa no tiene ficha vinculada en Empresas — no es posible mostrar el detalle de pólizas.
              </p>
            ) : query.isPending ? (
              <p className="text-sm text-gray-400 flex items-center gap-2 pt-2"><Loader2 size={14} className="animate-spin" /> Cargando pólizas…</p>
            ) : query.error ? (
              <p className="text-sm text-red-500 pt-2">{query.error instanceof Error ? query.error.message : 'Error cargando pólizas'}</p>
            ) : policies.length === 0 ? (
              <p className="text-sm text-gray-400 italic pt-2">Sin pólizas registradas</p>
            ) : !selectedPolicy ? null : (
              <>
                {policies.length === 1 && (
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="w-9 h-9 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xs font-bold shrink-0">
                      {initialsOf(displayName)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-text-primary truncate">{displayName}</p>
                      <p className="text-[10px] text-gray-400">{row.rut}</p>
                    </div>
                    <span className={`ml-auto inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${statusBadge.cls}`}>
                      {statusBadge.icon} {statusBadge.label}
                    </span>
                  </div>
                )}

                <div className="flex items-start justify-between gap-3 mb-5 pr-6">
                  <div>
                    <p className="text-[15px] font-bold text-text-primary">{selectedPolicy.company}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Póliza {selectedPolicy.policy_number}
                      {selectedPolicy.endorsement ? ` · Endoso ${selectedPolicy.endorsement}` : ''}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Vigencia <span className="font-semibold text-gray-700">{formatExpiry(selectedPolicy.valid_from)} – {formatExpiry(selectedPolicy.valid_to)}</span>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xl font-bold text-accent leading-none">
                      {installments.length === 0 ? '—' : `${Math.round(100 * installments.filter(i => i.status === 'pagada').length / installments.length)}%`}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">cuotas pagadas</p>
                  </div>
                </div>

                {spotlight && (
                  <div className="mb-2">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Próxima cuota</p>
                    <InstallmentRow
                      installment={spotlight}
                      canAdmin={canAdmin}
                      onChanged={updated => handleInstallmentChanged(selectedPolicy.id, updated)}
                    />
                  </div>
                )}

                {installments.length > 0 && (
                  <button
                    onClick={() => setShowAll(v => !v)}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 mb-5 mt-1"
                  >
                    {showAll ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    Ver todas las cuotas ({installments.length})
                  </button>
                )}

                {showAll && (
                  <div className="flex flex-col gap-1.5 mb-6">
                    {sortedInstallments.map(inst => (
                      <div key={inst.id} className={spotlight?.id === inst.id ? 'ring-2 ring-accent/30 rounded-lg' : ''}>
                        <InstallmentRow
                          installment={inst}
                          canAdmin={canAdmin}
                          onChanged={updated => handleInstallmentChanged(selectedPolicy.id, updated)}
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div className="pt-4 border-t border-border/60">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Documentos</p>
                  {docsQuery.isPending ? (
                    <p className="text-xs text-gray-400">Cargando documentos…</p>
                  ) : (
                    <DocumentChecklist
                      items={docsQuery.data ?? []}
                      canEdit={canEdit}
                      onUpload={handleDocUpload}
                    />
                  )}
                  {docUploadErr && <p className="text-xs text-red-500 mt-2">{docUploadErr}</p>}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/InsurancePolicyModal.test.tsx
```
Esperado: PASS (7/7).

- [ ] **Step 5: Borrar el slide-over anterior**

```bash
rm monitor-app/frontend/components/dashboard/InsurancePolicySlideOver.tsx
rm monitor-app/frontend/components/dashboard/InsurancePolicySlideOver.test.tsx
```

(Task 7 actualiza `PolizasTab.tsx` para dejar de importarlo — hasta entonces `tsc`/build fallarán, es esperado dentro de este task; se resuelve en el siguiente.)

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/components/dashboard/InsurancePolicyModal.tsx monitor-app/frontend/components/dashboard/InsurancePolicyModal.test.tsx
git add monitor-app/frontend/components/dashboard/InsurancePolicySlideOver.tsx monitor-app/frontend/components/dashboard/InsurancePolicySlideOver.test.tsx
git commit -m "feat(seguros): InsurancePolicyModal — detalle inmersivo de 2 columnas, reemplaza el slide-over"
```

---

### Task 7: Frontend — `PolizasTab.tsx`: usa el modal nuevo + panel único

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/PolizasTab.tsx`
- Test: crear `monitor-app/frontend/components/dashboard/PolizasTab.test.tsx` (no existía antes)

**Interfaces:**
- Consumes: `InsurancePolicyModal` (Task 6, reemplaza `InsurancePolicySlideOver`).
- Produces: mismo comportamiento externo de `PolizasTab` (props `canAdmin`/`canEdit`, deep-link `?rut=`) — el cambio es de composición visual interna y el componente de detalle usado.

- [ ] **Step 1: Escribir el test que falla primero**

```typescript
// components/dashboard/PolizasTab.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import { PolizasTab } from './PolizasTab'
import { insuranceApi } from '@/lib/api/insurance'

vi.mock('next/navigation', () => ({ useSearchParams: vi.fn() }))
vi.mock('@/lib/api/insurance', () => ({
  insuranceApi: {
    summary: vi.fn(),
    kpis: vi.fn(),
    getForTransporter: vi.fn(),
    listPolicyDocuments: vi.fn(),
  },
}))

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PolizasTab canAdmin={true} canEdit={true} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as ReturnType<typeof useSearchParams>)
  vi.mocked(insuranceApi.summary).mockReset().mockResolvedValue({
    data: [{
      rut: '11111111-1', business_name: 'Transportes Al Día', transporter_id: 't1',
      policies_count: 1, next_due: null, overdue_count: 0, paid_pct: 100, insurance_ok: true,
    }],
  })
  vi.mocked(insuranceApi.kpis).mockReset().mockResolvedValue({ expiring_30d: 1, without_policies: 3, incomplete_docs: 2 })
})

describe('PolizasTab', () => {
  it('renders the donut, the actionable KPIs and the informational stats inside one panel', async () => {
    renderTab()
    await waitFor(() => expect(screen.getByText('Transportes Al Día')).toBeInTheDocument())
    expect(screen.getByText('Empresas con seguro al día')).toBeInTheDocument()
    expect(screen.getByText(/pólizas vencen en 30 días/)).toBeInTheDocument()
  })

  it('opens the InsurancePolicyModal when a company row is clicked', async () => {
    vi.mocked(insuranceApi.getForTransporter).mockResolvedValue({ rut: '11111111-1', transporter_id: 't1', policies: [] })
    renderTab()
    const row = await screen.findByText('Transportes Al Día')
    row.click()
    await waitFor(() => expect(insuranceApi.getForTransporter).toHaveBeenCalledWith('t1'))
  })
})
```

- [ ] **Step 2: Correr el test, confirmar que falla**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/PolizasTab.test.tsx
```
Esperado: FAIL (el test de "un solo panel" no encuentra la agrupación esperada porque el componente actual todavía usa 4 piezas separadas — y `getForTransporter` sigue apuntando al slide-over borrado).

- [ ] **Step 3: Reescribir el componente**

Reemplazar el contenido completo de `monitor-app/frontend/components/dashboard/PolizasTab.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Search, Loader2, X, CalendarClock, ShieldOff, FileWarning } from 'lucide-react'
import { insuranceApi } from '@/lib/api/insurance'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { InsuranceCompanyCard } from '@/components/dashboard/InsuranceCompanyCard'
import { InsurancePolicyModal } from '@/components/dashboard/InsurancePolicyModal'
import type { InsuranceSummaryRow } from '@/lib/types'
import {
  deriveInsuranceKpis, matchesInsuranceFilter, type InsuranceFilterId,
} from '@/lib/utils/insuranceFilters'

const KPI_CARDS: { id: InsuranceFilterId; label: string; countCls: string; activeCls: string }[] = [
  { id: 'ok',             label: 'Empresas con seguro al día',      countCls: 'text-green-600', activeCls: 'border-green-400 ring-2 ring-green-100 bg-green-50' },
  { id: 'overdue',        label: 'Con cuotas vencidas',              countCls: 'text-red-600',   activeCls: 'border-red-400 ring-2 ring-red-100 bg-red-50' },
  { id: 'due_this_month', label: 'Cuotas que vencen este mes',      countCls: 'text-amber-600', activeCls: 'border-amber-400 ring-2 ring-amber-100 bg-amber-50' },
]

const FILTER_CHIPS: { id: InsuranceFilterId; label: string }[] = [
  { id: 'overdue',        label: 'Vencidas' },
  { id: 'due_this_month', label: 'Vence este mes' },
  { id: 'ok',              label: 'Al día' },
]

// ── Donut de estado (CSS conic-gradient, sin dependencia de gráficos) ───────

function StatusDonut({ rows }: { rows: InsuranceSummaryRow[] }) {
  const total = rows.length
  const overdue = rows.filter(r => r.overdue_count > 0).length
  const noInfo  = rows.filter(r => r.overdue_count === 0 && r.policies_count === 0).length
  const ok      = total - overdue - noInfo

  if (total === 0) return null

  const okPct      = (ok / total) * 100
  const overduePct = (overdue / total) * 100
  const gradient = `conic-gradient(#22c55e 0% ${okPct}%, #ef4444 ${okPct}% ${okPct + overduePct}%, #d1d5db ${okPct + overduePct}% 100%)`

  return (
    <div className="flex items-center gap-4 shrink-0">
      <div className="relative w-16 h-16 shrink-0 rounded-full" style={{ background: gradient }}>
        <div className="absolute inset-[5px] bg-white rounded-full flex items-center justify-center">
          <span className="text-sm font-bold text-text-primary tabular-nums">{total}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1 text-xs">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 shrink-0" /> <strong className="tabular-nums">{ok}</strong> al día</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 shrink-0" /> <strong className="tabular-nums">{overdue}</strong> con cuotas vencidas</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gray-300 shrink-0" /> <strong className="tabular-nums">{noInfo}</strong> sin información</span>
      </div>
    </div>
  )
}

interface Props {
  canAdmin: boolean
  canEdit:  boolean
}

export function PolizasTab({ canAdmin, canEdit }: Props) {
  const searchParams = useSearchParams()
  const rutParam = searchParams.get('rut')

  const [q, setQ]                       = useState(rutParam ?? '')
  const [activeFilter, setActiveFilter] = useState<InsuranceFilterId | null>(null)
  const [selectedRut, setSelectedRut]   = useState<string | null>(rutParam)
  const qDebounced = useDebouncedValue(q, 300)

  const kpisQuery = useQuery({
    queryKey: ['insurance', 'kpis'],
    queryFn: () => insuranceApi.kpis(),
  })

  const query = useQuery({
    queryKey: ['insurance', 'summary', qDebounced],
    queryFn: () => insuranceApi.summary({ q: qDebounced }),
  })
  const rows = useMemo(() => query.data?.data ?? [], [query.data])
  const loading = query.isPending
  const error = query.error ? (query.error instanceof Error ? query.error.message : 'Error cargando seguros') : null

  const kpis = useMemo(() => deriveInsuranceKpis(rows), [rows])
  const visibleRows = useMemo(
    () => activeFilter ? rows.filter(r => matchesInsuranceFilter(r, activeFilter)) : rows,
    [rows, activeFilter],
  )
  const selectedRow = useMemo(() => rows.find(r => r.rut === selectedRut) ?? null, [rows, selectedRut])

  function toggleFilter(id: InsuranceFilterId) {
    setActiveFilter(prev => prev === id ? null : id)
  }

  const emptyLabel = q || activeFilter ? 'Sin resultados' : 'Sin empresas con pólizas registradas'

  return (
    <div className="p-4 md:p-6 space-y-5">
      <p className="text-xs text-gray-400">
        {loading ? '…' : `${rows.length.toLocaleString('es-CL')} empresa${rows.length !== 1 ? 's' : ''} con pólizas`}
      </p>

      {/* ── Panel único: donut + KPIs accionables + estadísticas + búsqueda ── */}
      <div className="border border-border rounded-2xl overflow-hidden bg-white">
        {!loading && (
          <div className="flex items-center gap-6 flex-wrap p-4 border-b border-border">
            <StatusDonut rows={rows} />
            <div className="flex gap-2.5 flex-wrap">
              {KPI_CARDS.map(card => {
                const count  = kpis[card.id]
                const active = activeFilter === card.id
                return (
                  <button
                    key={card.id}
                    onClick={() => toggleFilter(card.id)}
                    disabled={count === 0 && !active}
                    aria-pressed={active}
                    className={`flex items-center gap-2.5 bg-white border rounded-2xl px-4 py-2.5 transition-all disabled:opacity-40 disabled:cursor-default hover:shadow-sm ${
                      active ? card.activeCls : 'border-border hover:border-gray-300'
                    }`}
                  >
                    <span className={`text-xl font-bold leading-none tabular-nums ${count > 0 ? card.countCls : 'text-gray-300'}`}>{count}</span>
                    <span className="text-xs font-semibold text-gray-500 text-left leading-tight">{card.label}</span>
                    {active && <X size={12} className="text-gray-400" />}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {kpisQuery.data && (
          <div className="flex items-center gap-5 flex-wrap px-4 py-3 bg-gray-50/70 border-b border-border text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <CalendarClock size={13} className="text-amber-500 shrink-0" />
              <strong className="font-bold text-gray-700 tabular-nums">{kpisQuery.data.expiring_30d}</strong> pólizas vencen en 30 días
            </span>
            <span className="flex items-center gap-1.5">
              <ShieldOff size={13} className="text-gray-400 shrink-0" />
              <strong className="font-bold text-gray-700 tabular-nums">{kpisQuery.data.without_policies}</strong> empresas activas sin pólizas
            </span>
            <span className="flex items-center gap-1.5">
              <FileWarning size={13} className="text-red-400 shrink-0" />
              <strong className="font-bold text-gray-700 tabular-nums">{kpisQuery.data.incomplete_docs}</strong> pólizas con documentos incompletos
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap p-4">
          <div className="relative shrink-0">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Nombre o RUT…"
              className="pl-8 pr-3 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 w-60 bg-white placeholder:text-gray-400 transition-all"
            />
          </div>

          {FILTER_CHIPS.map(chip => {
            const active = activeFilter === chip.id
            return (
              <button
                key={chip.id}
                onClick={() => toggleFilter(chip.id)}
                aria-pressed={active}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
                  active ? 'bg-accent border-accent text-white' : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                {chip.label}
              </button>
            )
          })}

          {activeFilter && (
            <button
              onClick={() => setActiveFilter(null)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-300 rounded-lg bg-white transition-colors ml-auto"
            >
              <X size={11} /> Limpiar
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400 gap-2 text-sm">
          <Loader2 size={16} className="animate-spin" /> Cargando…
        </div>
      ) : visibleRows.length === 0 ? (
        <p className="bg-white rounded-2xl border border-border px-4 py-16 text-center text-sm text-gray-400">{emptyLabel}</p>
      ) : (
        <div className="space-y-3">
          {visibleRows.map(row => (
            <InsuranceCompanyCard
              key={row.rut}
              row={row}
              active={selectedRut === row.rut}
              onOpen={() => setSelectedRut(row.rut)}
            />
          ))}
        </div>
      )}

      <InsurancePolicyModal
        row={selectedRow}
        onClose={() => setSelectedRut(null)}
        canAdmin={canAdmin}
        canEdit={canEdit}
      />
    </div>
  )
}
```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/PolizasTab.test.tsx
```
Esperado: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/PolizasTab.tsx monitor-app/frontend/components/dashboard/PolizasTab.test.tsx
git commit -m "redesign(seguros): PolizasTab — panel único + InsurancePolicyModal"
```

---

### Task 8: Frontend — `CobranzaTab.tsx`: antigüedad de mora reemplaza el gráfico de barras

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/CobranzaTab.tsx`
- Test: `monitor-app/frontend/components/dashboard/CobranzaTab.test.tsx`

**Interfaces:**
- Consumes: `agingBucket`/`AgingBand` (Task 3), `dueRelative` (Task 2, reemplaza la copia local).
- Produces: mismo comportamiento externo de `CobranzaTab` (prop `canAdmin`) — el widget de barras top-8 desaparece, se agrega el filtro por antigüedad (composable con el agrupamiento existente).

- [ ] **Step 1: Escribir los tests que fallan primero**

Agregar al final de `monitor-app/frontend/components/dashboard/CobranzaTab.test.tsx` (reusa `renderWithClient`/`ROWS` ya definidos arriba en el archivo — `ROWS[0]` vence `2020-01-01` y está vencida, cae en la banda `90+`; `ROWS[1]` vence `2099-01-01` y no está vencida):

```typescript
describe('CobranzaTab — antigüedad de mora', () => {
  it('shows the aging bars for overdue amounts, not the old bar-by-group chart', async () => {
    renderWithClient(<CobranzaTab canAdmin={false} />)
    await waitFor(() => expect(screen.getByText('Antigüedad de lo vencido')).toBeInTheDocument())
    expect(screen.getByText('0–30 días')).toBeInTheDocument()
    expect(screen.getByText('+90 días')).toBeInTheDocument()
    expect(screen.queryByText(/grupos de mayor monto/)).not.toBeInTheDocument()
  })

  it('filters the list to only the selected aging band', async () => {
    renderWithClient(<CobranzaTab canAdmin={false} />)
    await waitFor(() => expect(screen.getByText('Empresa A')).toBeInTheDocument())
    expect(screen.getByText('Empresa B')).toBeInTheDocument()
    fireEvent.click(screen.getByText('+90 días'))
    await waitFor(() => expect(screen.queryByText('Empresa B')).not.toBeInTheDocument())
    expect(screen.getByText('Empresa A')).toBeInTheDocument()
  })

  it('clicking the same band again clears the filter', async () => {
    renderWithClient(<CobranzaTab canAdmin={false} />)
    await waitFor(() => expect(screen.getByText('Empresa A')).toBeInTheDocument())
    fireEvent.click(screen.getByText('+90 días'))
    await waitFor(() => expect(screen.queryByText('Empresa B')).not.toBeInTheDocument())
    fireEvent.click(screen.getByText('+90 días'))
    await waitFor(() => expect(screen.getByText('Empresa B')).toBeInTheDocument())
  })

  it('filters to only non-overdue rows when clicking the "no vencidas aún" stat', async () => {
    renderWithClient(<CobranzaTab canAdmin={false} />)
    await waitFor(() => expect(screen.getByText('Empresa A')).toBeInTheDocument())
    fireEvent.click(screen.getByText(/no vencidas aún/))
    await waitFor(() => expect(screen.queryByText('Empresa A')).not.toBeInTheDocument())
    expect(screen.getByText('Empresa B')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/CobranzaTab.test.tsx
```
Esperado: FAIL (el widget de antigüedad no existe todavía).

- [ ] **Step 3: Reescribir el componente**

Reemplazar el contenido completo de `monitor-app/frontend/components/dashboard/CobranzaTab.tsx`:

```tsx
'use client'

import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Check, ChevronRight, AlertTriangle, Receipt } from 'lucide-react'
import { insuranceApi } from '@/lib/api/insurance'
import { groupInstallments, agingBucket, type GroupBy, type AgingBand } from '@/lib/utils/insuranceGrouping'
import { dueRelative } from '@/lib/utils/installments'
import { formatExpiry } from '@/lib/compliance'
import type { InsuranceInstallmentFlat } from '@/lib/types'

const GROUP_OPTIONS: { id: GroupBy; label: string }[] = [
  { id: 'week',         label: 'Semana' },
  { id: 'month',        label: 'Mes' },
  { id: 'quarter',       label: 'Trimestre' },
  { id: 'transporter',  label: 'Empresa' },
  { id: 'company',      label: 'Aseguradora' },
  { id: 'client_group', label: 'Cliente GC' },
]

const AGING_BANDS: { id: AgingBand; label: string; color: string }[] = [
  { id: '0-30',  label: '0–30 días',  color: '#fbbf24' },
  { id: '31-60', label: '31–60 días', color: '#f97316' },
  { id: '61-90', label: '61–90 días', color: '#ef4444' },
  { id: '90+',   label: '+90 días',   color: '#991b1b' },
]

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

type AgingFilter = AgingBand | 'not_overdue' | null

// ── Antigüedad de mora: 4 mini-barras verticales + "no vencidas aún" ───────

function AgingBars({
  rows, activeFilter, onSelect,
}: {
  rows:         InsuranceInstallmentFlat[]
  activeFilter: AgingFilter
  onSelect:     (band: AgingBand | 'not_overdue') => void
}) {
  const totals = useMemo(() => {
    const t: Record<AgingBand, { uf: number; count: number }> = {
      '0-30': { uf: 0, count: 0 }, '31-60': { uf: 0, count: 0 }, '61-90': { uf: 0, count: 0 }, '90+': { uf: 0, count: 0 },
    }
    let notOverdueUf = 0, notOverdueCount = 0
    for (const row of rows) {
      const band = agingBucket(row)
      if (band) {
        t[band].uf += row.amount_uf ?? 0
        t[band].count += 1
      } else {
        notOverdueUf += row.amount_uf ?? 0
        notOverdueCount += 1
      }
    }
    return { bands: t, notOverdueUf, notOverdueCount }
  }, [rows])

  const max = Math.max(1, ...AGING_BANDS.map(b => totals.bands[b.id].uf))

  return (
    <div className="bg-white border border-border rounded-2xl px-5 py-4">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Antigüedad de lo vencido</span>
        <button
          onClick={() => onSelect('not_overdue')}
          className={`text-xs transition-colors ${activeFilter === 'not_overdue' ? 'font-bold text-accent' : 'text-gray-400 hover:text-gray-600'}`}
        >
          {totals.notOverdueUf.toFixed(1)} UF no vencidas aún · {totals.notOverdueCount} cuota{totals.notOverdueCount === 1 ? '' : 's'}
        </button>
      </div>
      <div className="flex items-end gap-4 h-24">
        {AGING_BANDS.map(band => {
          const { uf } = totals.bands[band.id]
          const heightPct = Math.max(4, (uf / max) * 100)
          const active = activeFilter === band.id
          return (
            <button
              key={band.id}
              onClick={() => onSelect(band.id)}
              className={`flex-1 flex flex-col items-center justify-end gap-1.5 h-full transition-opacity ${
                activeFilter && !active ? 'opacity-40' : ''
              }`}
            >
              <span className="text-[11px] font-bold text-text-primary tabular-nums">{uf.toFixed(1)}</span>
              <div className="w-full rounded" style={{ height: `${heightPct}%`, backgroundColor: band.color }} />
              <span className="text-[10px] text-gray-400">{band.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface Props {
  canAdmin: boolean
}

export function CobranzaTab({ canAdmin }: Props) {
  const [groupBy, setGroupBy] = useState<GroupBy>('week')
  const [agingFilter, setAgingFilter] = useState<AgingFilter>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const groupRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const query = useQuery({
    queryKey: ['insurance', 'installments-flat'],
    queryFn: () => insuranceApi.installmentsFlat(),
  })

  const allRows = query.data ?? []
  const filteredRows = useMemo(() => {
    if (!agingFilter) return allRows
    if (agingFilter === 'not_overdue') return allRows.filter(r => !agingBucket(r))
    return allRows.filter(r => agingBucket(r) === agingFilter)
  }, [allRows, agingFilter])

  const groups = useMemo(() => groupInstallments(filteredRows, groupBy), [filteredRows, groupBy])

  function toggleCollapsed(key: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function selectAging(band: AgingBand | 'not_overdue') {
    setAgingFilter(prev => prev === band ? null : band)
  }

  if (query.isPending) {
    return <div className="flex items-center justify-center py-24 text-gray-400 gap-2 text-sm">
      <Loader2 size={18} className="animate-spin" /> Cargando cuotas…
    </div>
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="inline-flex items-center gap-1 bg-gray-100/80 rounded-xl p-1">
        {GROUP_OPTIONS.map(opt => (
          <button
            key={opt.id}
            aria-pressed={groupBy === opt.id}
            onClick={() => setGroupBy(opt.id)}
            className={`px-3.5 py-1.5 text-[13px] font-semibold rounded-lg transition-all ${
              groupBy === opt.id
                ? 'bg-white text-text-primary shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {allRows.length > 0 && (
        <AgingBars rows={allRows} activeFilter={agingFilter} onSelect={selectAging} />
      )}

      <div className="space-y-5">
        {groups.map(group => {
          const isOverdue = group.key === 'overdue'
          const isCollapsed = collapsed.has(group.key)
          return (
            <div
              key={group.key}
              ref={el => { if (el) groupRefs.current.set(group.key, el); else groupRefs.current.delete(group.key) }}
              className={`rounded-2xl overflow-hidden border transition-shadow ${
                isOverdue ? 'border-red-200 bg-red-50/40 shadow-sm shadow-red-100' : 'border-border bg-white'
              }`}
            >
              <button
                onClick={() => toggleCollapsed(group.key)}
                className={`w-full flex items-center justify-between gap-3 px-5 py-4 text-left transition-colors ${
                  isOverdue ? 'hover:bg-red-50' : 'hover:bg-gray-50/70'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                    isOverdue ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {isOverdue ? <AlertTriangle size={16} /> : <Receipt size={16} />}
                  </div>
                  <div className="min-w-0">
                    <p className={`text-[15px] font-bold truncate ${isOverdue ? 'text-red-700' : 'text-text-primary'}`}>
                      {group.label}
                    </p>
                    <p className="text-xs text-gray-400">{group.rows.length} cuota{group.rows.length === 1 ? '' : 's'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-lg font-bold tabular-nums ${isOverdue ? 'text-red-600' : 'text-text-primary'}`}>
                    {group.totalUf.toFixed(1)} <span className="text-xs font-semibold text-gray-400">UF</span>
                  </span>
                  <ChevronRight size={16} className={`text-gray-400 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
                </div>
              </button>

              {!isCollapsed && (
                <div className={`divide-y ${isOverdue ? 'divide-red-100 border-t border-red-100' : 'divide-border/60 border-t border-border'}`}>
                  {group.rows.map(row => {
                    const relative = dueRelative(row.due_date, row.is_overdue)
                    const name = row.business_name ?? row.rut
                    return (
                      <div
                        key={row.installment_id}
                        className="flex items-center gap-4 px-5 py-3.5 hover:bg-black/[0.02] transition-colors"
                      >
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                          row.is_overdue ? 'bg-red-100 text-red-600' : 'bg-accent/10 text-accent'
                        }`}>
                          {initialsOf(name)}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-semibold text-text-primary truncate">{name}</p>
                          <p className="text-xs text-gray-400 truncate">
                            {row.company} · Póliza {row.policy_number} · cuota {row.installment_number}
                          </p>
                        </div>

                        <div className="hidden sm:block text-right shrink-0 w-32">
                          <p className={`text-[13px] font-semibold tabular-nums ${row.is_overdue ? 'text-red-600' : 'text-gray-600'}`}>
                            {formatExpiry(row.due_date)}
                          </p>
                          {relative && (
                            <p className={`text-[11px] ${row.is_overdue ? 'text-red-500' : 'text-gray-400'}`}>{relative}</p>
                          )}
                        </div>

                        <p className="text-[15px] font-bold text-text-primary tabular-nums shrink-0 w-20 text-right">
                          {row.amount_uf != null ? row.amount_uf.toFixed(1) : '—'}
                          <span className="text-[11px] font-semibold text-gray-400 ml-1">UF</span>
                        </p>

                        {row.status !== 'pagada' && canAdmin && (
                          <button
                            disabled
                            title="Marcar como pagada desde Cobranza — próximamente"
                            className="shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border border-border text-gray-500 hover:text-accent hover:border-accent disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-500 disabled:hover:border-border transition-colors"
                          >
                            <Check size={12} /> Pagar
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {groups.length === 0 && (
          <p className="bg-white rounded-2xl border border-border px-4 py-16 text-center text-sm text-gray-400">
            Sin cuotas registradas
          </p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/CobranzaTab.test.tsx
```
Esperado: PASS (8/8 — 4 previos + 4 nuevos).

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/CobranzaTab.tsx monitor-app/frontend/components/dashboard/CobranzaTab.test.tsx
git commit -m "redesign(seguros): CobranzaTab — antigüedad de mora reemplaza el gráfico de barras"
```

---

### Task 9: Verificación final

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Suite completa de backend**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest -v
```
Esperado: todos los tests pasan, incluidos los 6 nuevos de `revert`.

- [ ] **Step 2: Suite completa de frontend**

```bash
cd monitor-app/frontend && npx vitest run
```
Esperado: todos los tests pasan (los existentes + los nuevos de Tasks 2, 3, 4, 5, 6, 7, 8). Confirmar que no queda ningún archivo de test huérfano referenciando `InsurancePolicySlideOver` (debe seguir borrado desde Task 6).

- [ ] **Step 3: Type-check y build**

```bash
cd monitor-app/frontend && npx tsc --noEmit && npm run build
```
Esperado: ambos limpios, sin referencias colgantes a `GroupBarChart` ni `InsurancePolicySlideOver`.

- [ ] **Step 4: Smoke visual manual en navegador (backend + frontend corriendo)**

Con `venv/bin/python -m uvicorn app.main:app --port 8001` (backend) y `next dev` (frontend) corriendo:

1. `/dashboard/seguros` → tab Pólizas: donut + 3 KPI + 3 estadísticas + búsqueda deben verse dentro de un solo panel con borde, sin huecos de fondo gris entre piezas.
2. Click en una empresa con 1 sola póliza → el modal abre sin columna izquierda (detalle a ancho completo).
3. Click en una empresa con 2+ pólizas → columna izquierda visible, click en la otra póliza cambia el detalle de la derecha.
4. Confirmar que la cuota destacada dice "Cuota N de M" (nunca "#N").
5. Click "Ver todas las cuotas" expande la lista completa in situ; la cuota destacada aparece también ahí, resaltada.
6. En una cuota pagada: hacer hover → aparece "revertir"; click → popover de confirmación; "Sí" revierte y el estado se actualiza sin recargar.
7. Documentos: confirmar que se ven como lista vertical con contador "X de N completos" (no nodos circulares en tira horizontal), y que ningún contenido se corta en el borde del modal.
8. Tab Cobranza: confirmar que el gráfico de barras top-8 ya no existe; el widget "Antigüedad de lo vencido" muestra 4 barras + el dato de "no vencidas aún".
9. Click en una banda de antigüedad filtra la lista de abajo; click de nuevo la quita.
10. Cambiar el selector de agrupamiento (Semana/Mes/.../Cliente GC) sigue funcionando igual que antes, ahora compuesto con el filtro de antigüedad si hay uno activo.

- [ ] **Step 5: Commit final si hubo ajustes del smoke test**

Si el Step 4 no encuentra problemas, no hay commit — el trabajo ya quedó commiteado en cada task anterior. Si se encuentra algo, corregir y commitear con un mensaje descriptivo del fix puntual.

