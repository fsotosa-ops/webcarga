# Rediseño del módulo Empresas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar la ficha de detalle de empresa (roster compacto + panel de detalle por conductor/vehículo, reemplazando filas siempre-densas con formularios inline) y pulir visualmente el listado, alineando ambos al lenguaje visual ya validado en el rediseño de Seguros.

**Architecture:** La ficha (`empresa/[id]/page.tsx`, ~1900 líneas) se descompone en componentes chicos y enfocados. Conductores/Equipos pasan de una tabla con expand-inline-de-formulario a un roster de tarjetas compactas + un panel de detalle lateral (mismo patrón de accesibilidad que `TransporterSlideOver`). El checklist de documentos por conductor/vehículo reusa `DocumentChecklist` (ya rediseñado en Seguros) extendido con un modo "cambiar estado" (sin archivo) para los campos `ComplianceStatus` de `governance`; las fechas de vencimiento (que no son estados discretos) quedan como inputs de fecha separados, fuera del checklist. Los documentos de la empresa (`TransporterDocumentsPanel`) conservan TODAS sus funciones actuales (link, upload, versiones, revertir) — solo se reestilizan para verse como filas de `DocumentChecklist`.

**Tech Stack:** Next.js 16 + TanStack Query (donde ya se usa) + Tailwind v4 + lucide-react. Sin dependencias nuevas.

## Global Constraints

- Spec de referencia: `docs/superpowers/specs/2026-07-12-empresas-redesign-design.md`.
- Fuera de alcance: modelo de datos/pipeline/API (solo frontend), fusionar Seguros en Empresas, modal de "Editar Datos Empresa" y `TransferModal` (sin cambios), notificaciones/campana Topbar.
- Gates de permisos existentes se preservan exactamente: campos editables → `canEdit || canAdmin`; botón "Transferir" → `canAdmin`.
- El botón "Transferir" abre el `TransferModal` existente sin cambios — el panel de detalle solo dispara el callback `onTransferClick` que ya existe hoy en `DriverRow`/`VehicleRow`.
- No se cambia ningún endpoint de `transportersApi` ni ningún tipo en `lib/types.ts`.

---

### Task 1: `lib/utils/transporterDocs.ts` — adaptadores governance ↔ ChecklistItem

**Files:**
- Create: `monitor-app/frontend/lib/utils/transporterDocs.ts`
- Test: `monitor-app/frontend/lib/utils/transporterDocs.test.ts`

**Interfaces:**
- Produces: `DRIVER_DOC_LABELS`, `VEHICLE_DOC_LABELS` (mismo contenido que hoy vive inline en `empresa/[id]/page.tsx`, ahora la fuente única); `driverGovernanceToChecklistItems(driver: TransporterDriver): ChecklistItem[]`; `vehicleGovernanceToChecklistItems(vehicle: TransporterVehicle): ChecklistItem[]`; `withDriverGovernanceField(current: DriverGovernance | null, docCode: string, status: ComplianceStatus): DriverGovernance`; `withVehicleGovernanceField(current: VehicleGovernance | null, docCode: string, status: ComplianceStatus): VehicleGovernance`. Consumidos por Task 5 (`DriverDetailPanel`) y Task 6 (`VehicleDetailPanel`).
- Consumes: `ChecklistItem` de `@/components/dashboard/DocumentChecklist` (ya existe, sin cambios de tipo en este task).

- [ ] **Step 1: Escribir los tests que fallan primero**

```typescript
// lib/utils/transporterDocs.test.ts
import { describe, it, expect } from 'vitest'
import {
  driverGovernanceToChecklistItems, vehicleGovernanceToChecklistItems,
  withDriverGovernanceField, withVehicleGovernanceField,
} from './transporterDocs'
import type { TransporterDriver, TransporterVehicle } from '@/lib/types'

const DRIVER: TransporterDriver = {
  id: 'd1', rut: '11111111-1', name: 'Juan Pérez',
  governance: {
    id_expiry: '2026-01-01', license_expiry: '2026-02-01',
    anexo_3_gc: 'ok', epp: null, das_odi: 'pendiente', hoja_de_vida: 'ok',
    cert_antecedentes: 'ok', validado_gc_driver: 'ok', contrato_trabajo: 'ok',
    creacion_gc_driver: 'ok', avance_total: 90,
  },
}

const VEHICLE: TransporterVehicle = {
  id: 'v1', type: 'Tractocamión', plate: 'ABCD12',
  governance: {
    year: 2020, circ_permit_expiry: '2026-01-01', tech_inspection_expiry: '2026-02-01',
    gas_emissions_expiry: '2026-03-01', soap_insurance_expiry: '2026-04-01',
    padron: 'ok', poliza_rc: null, gps: 'ok', seguro_carga: 'pendiente',
    mantencion_camara_frio: 'n_a', creacion_gc_vehicle: 'ok',
  },
}

describe('driverGovernanceToChecklistItems', () => {
  it('produces one item per documentation field (not the expiry dates)', () => {
    const items = driverGovernanceToChecklistItems(DRIVER)
    expect(items).toHaveLength(8)
    expect(items.map(i => i.doc_code)).not.toContain('id_expiry')
    expect(items.map(i => i.doc_code)).not.toContain('license_expiry')
  })

  it('maps status and label correctly, with has_expiry always false', () => {
    const items = driverGovernanceToChecklistItems(DRIVER)
    const anexo = items.find(i => i.doc_code === 'anexo_3_gc')!
    expect(anexo.label).toBe('Anexo 3 GC')
    expect(anexo.status).toBe('ok')
    expect(anexo.has_expiry).toBe(false)
    expect(anexo.expiry_date).toBeNull()
    const epp = items.find(i => i.doc_code === 'epp')!
    expect(epp.status).toBeNull()
  })

  it('handles a driver with no governance at all', () => {
    const items = driverGovernanceToChecklistItems({ ...DRIVER, governance: null })
    expect(items).toHaveLength(8)
    expect(items.every(i => i.status === null)).toBe(true)
  })
})

describe('vehicleGovernanceToChecklistItems', () => {
  it('produces one item per documentation field (not the expiry dates)', () => {
    const items = vehicleGovernanceToChecklistItems(VEHICLE)
    expect(items).toHaveLength(6)
    expect(items.map(i => i.doc_code)).not.toContain('circ_permit_expiry')
  })

  it('maps status correctly', () => {
    const items = vehicleGovernanceToChecklistItems(VEHICLE)
    expect(items.find(i => i.doc_code === 'padron')!.status).toBe('ok')
    expect(items.find(i => i.doc_code === 'poliza_rc')!.status).toBeNull()
  })
})

describe('withDriverGovernanceField', () => {
  it('sets one field while preserving the rest', () => {
    const updated = withDriverGovernanceField(DRIVER.governance, 'epp', 'ok')
    expect(updated.epp).toBe('ok')
    expect(updated.anexo_3_gc).toBe('ok')
    expect(updated.id_expiry).toBe('2026-01-01')
  })

  it('works when current governance is null', () => {
    const updated = withDriverGovernanceField(null, 'epp', 'pendiente')
    expect(updated.epp).toBe('pendiente')
  })
})

describe('withVehicleGovernanceField', () => {
  it('sets one field while preserving the rest', () => {
    const updated = withVehicleGovernanceField(VEHICLE.governance, 'poliza_rc', 'ok')
    expect(updated.poliza_rc).toBe('ok')
    expect(updated.padron).toBe('ok')
    expect(updated.circ_permit_expiry).toBe('2026-01-01')
  })
})
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

```bash
cd monitor-app/frontend && npx vitest run lib/utils/transporterDocs.test.ts
```
Esperado: FAIL (`transporterDocs.ts` no existe).

- [ ] **Step 3: Implementar**

```typescript
// lib/utils/transporterDocs.ts
import type { ChecklistItem } from '@/components/dashboard/DocumentChecklist'
import type {
  ComplianceStatus, DriverGovernance, TransporterDriver, TransporterVehicle, VehicleGovernance,
} from '@/lib/types'

/** Documentación de conductor sin fecha de vencimiento propia (las fechas
 *  —C.I., licencia— se editan aparte, no encajan en un ChecklistItem de
 *  estado discreto). Única fuente — antes vivía duplicado en el page. */
export const DRIVER_DOC_LABELS: { key: keyof DriverGovernance; label: string }[] = [
  { key: 'anexo_3_gc',         label: 'Anexo 3 GC' },
  { key: 'epp',                label: 'EPP' },
  { key: 'das_odi',            label: 'DAS / ODI' },
  { key: 'hoja_de_vida',       label: 'Hoja de Vida' },
  { key: 'cert_antecedentes',  label: 'Cert. Antecedentes' },
  { key: 'validado_gc_driver', label: 'Validado GC' },
  { key: 'contrato_trabajo',   label: 'Contrato Trabajo' },
  { key: 'creacion_gc_driver', label: 'Creación GC' },
]

export const VEHICLE_DOC_LABELS: { key: keyof VehicleGovernance; label: string }[] = [
  { key: 'padron',                 label: 'Padrón' },
  { key: 'poliza_rc',              label: 'Póliza RC' },
  { key: 'gps',                    label: 'GPS' },
  { key: 'seguro_carga',           label: 'Seguro Carga' },
  { key: 'mantencion_camara_frio', label: 'Cámara Frío' },
  { key: 'creacion_gc_vehicle',    label: 'Creación GC' },
]

export function driverGovernanceToChecklistItems(driver: TransporterDriver): ChecklistItem[] {
  return DRIVER_DOC_LABELS.map(({ key, label }) => ({
    doc_code:    key,
    label,
    status:      driver.governance?.[key] ?? null,
    expiry_date: null,
    has_expiry:  false,
  }))
}

export function vehicleGovernanceToChecklistItems(vehicle: TransporterVehicle): ChecklistItem[] {
  return VEHICLE_DOC_LABELS.map(({ key, label }) => ({
    doc_code:    key,
    label,
    status:      vehicle.governance?.[key] ?? null,
    expiry_date: null,
    has_expiry:  false,
  }))
}

export function withDriverGovernanceField(
  current: DriverGovernance | null, docCode: string, status: ComplianceStatus,
): DriverGovernance {
  return { ...(current ?? {}), [docCode]: status } as DriverGovernance
}

export function withVehicleGovernanceField(
  current: VehicleGovernance | null, docCode: string, status: ComplianceStatus,
): VehicleGovernance {
  return { ...(current ?? {}), [docCode]: status } as VehicleGovernance
}
```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

```bash
cd monitor-app/frontend && npx vitest run lib/utils/transporterDocs.test.ts
```
Esperado: PASS (8/8).

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/lib/utils/transporterDocs.ts monitor-app/frontend/lib/utils/transporterDocs.test.ts
git commit -m "feat(empresas): adaptadores governance ↔ ChecklistItem"
```

---

### Task 2: `DocumentChecklist.tsx` — modo "cambiar estado" (sin archivo)

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/DocumentChecklist.tsx`
- Test: `monitor-app/frontend/components/dashboard/DocumentChecklist.test.tsx`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: nueva prop opcional `onStatusChange?: (docCode: string, status: ComplianceStatus) => void`. Cuando está presente, cada fila muestra un `<select>` de estado en vez del control de subir archivo (`onUpload` pasa a ser opcional). Task 5 y 6 (paneles de detalle) la consumen; Seguros (`InsurancePolicyModal.tsx`) sigue pasando solo `onUpload` — sin cambios de comportamiento para ese caso, todos sus tests existentes deben seguir pasando sin tocarlos.

- [ ] **Step 1: Escribir los tests que fallan primero**

Agregar al final de `monitor-app/frontend/components/dashboard/DocumentChecklist.test.tsx` (reusa `ITEMS` ya definido arriba en el archivo):

```typescript
  it('shows a status select instead of an upload control when onStatusChange is provided', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={true} onStatusChange={vi.fn()} />)
    expect(screen.queryByLabelText('Subir Endoso')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Estado de Endoso')).toBeInTheDocument()
  })

  it('calls onStatusChange with the doc_code and the new status', () => {
    const onStatusChange = vi.fn()
    render(<DocumentChecklist items={ITEMS} canEdit={true} onStatusChange={onStatusChange} />)
    fireEvent.change(screen.getByLabelText('Estado de Endoso'), { target: { value: 'ok' } })
    expect(onStatusChange).toHaveBeenCalledWith('endoso', 'ok')
  })

  it('does not show a status select when canEdit is false, even with onStatusChange provided', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onStatusChange={vi.fn()} />)
    expect(screen.queryByLabelText('Estado de Endoso')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/DocumentChecklist.test.tsx
```
Esperado: FAIL (3 nuevos tests fallan, `onStatusChange` no existe todavía; los 6 anteriores siguen pasando).

- [ ] **Step 3: Implementar**

Reemplazar el contenido completo de `monitor-app/frontend/components/dashboard/DocumentChecklist.tsx`:

```tsx
'use client'

import { Check, Circle, AlertTriangle, Upload } from 'lucide-react'
import type { ComplianceStatus } from '@/lib/types'

export type ChecklistItem = {
  doc_code:     string
  label:        string
  status:       ComplianceStatus | null
  expiry_date:  string | null
  has_expiry:   boolean
}

interface Props {
  items:           ChecklistItem[]
  canEdit:         boolean
  onUpload?:       (docCode: string, file: File) => void
  onStatusChange?: (docCode: string, status: ComplianceStatus) => void
}

const STATUS_OPTIONS: { value: ComplianceStatus; label: string }[] = [
  { value: 'ok',         label: 'OK' },
  { value: 'pendiente',  label: 'Pendiente' },
  { value: 'actualizar', label: 'Actualizar' },
  { value: 'n_a',        label: 'N/A' },
  { value: 'factible',   label: 'Factible' },
]

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

/** Checklist de documentos — lista vertical de filas (icono + nombre +
 *  acción). Genérico: no importa nada específico de un módulo. La acción
 *  por fila es una de dos (mutuamente excluyentes en la práctica, cada
 *  llamador pasa una sola): subir archivo (Seguros, documentos con
 *  respaldo de archivo) o cambiar estado (Empresas, campos `governance`
 *  sin archivo — un `<select>` en vez del control de subir). */
export function DocumentChecklist({ items, canEdit, onUpload, onStatusChange }: Props) {
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
              {canEdit && onStatusChange && (
                <select
                  aria-label={`Estado de ${item.label}`}
                  value={item.status ?? ''}
                  onChange={e => onStatusChange(item.doc_code, e.target.value as ComplianceStatus)}
                  className="text-[11px] font-semibold border border-border rounded-md px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white shrink-0"
                >
                  <option value="">—</option>
                  {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
              {canEdit && !onStatusChange && onUpload && (
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
Esperado: PASS (9/9 — 6 previos + 3 nuevos).

- [ ] **Step 5: Correr también los tests de Seguros que consumen este componente (no deben romperse)**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/InsurancePolicyModal.test.tsx
```
Esperado: PASS (8/8) — `InsurancePolicyModal` solo pasa `onUpload`, nunca `onStatusChange`, así que su comportamiento no cambia.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/components/dashboard/DocumentChecklist.tsx monitor-app/frontend/components/dashboard/DocumentChecklist.test.tsx
git commit -m "feat(empresas): DocumentChecklist — modo cambiar-estado sin archivo"
```

---

### Task 3: `DriverRosterCard.tsx` — tarjeta compacta de conductor

**Files:**
- Create: `monitor-app/frontend/lib/utils/avatar.ts`
- Modify: `monitor-app/frontend/lib/utils/transporterDocs.ts` (agrega `driverRosterStatus`)
- Create: `monitor-app/frontend/components/dashboard/DriverRosterCard.tsx`
- Test: `monitor-app/frontend/lib/utils/transporterDocs.test.ts` (agrega casos), `monitor-app/frontend/components/dashboard/DriverRosterCard.test.tsx`

**Interfaces:**
- Produces: `getInitials(name: string | null): string`, `getInitialColor(name: string | null): string` (movidos desde `empresa/[id]/page.tsx`, única fuente ahora); `driverRosterStatus(driver: TransporterDriver): { label: string; tone: 'ok' | 'warn' | 'danger' }`; `<DriverRosterCard driver={TransporterDriver} onOpen={() => void} />`. Consumido por Task 9 (ficha).
- Consumes: `driverGovernanceToChecklistItems` (Task 1), `getDriverAlertStatus` (ya existe en `@/lib/compliance`).

- [ ] **Step 1: Escribir los tests que fallan primero**

```typescript
// lib/utils/avatar.test.ts
import { describe, it, expect } from 'vitest'
import { getInitials, getInitialColor } from './avatar'

describe('getInitials', () => {
  it('takes first letter of first and last name', () => {
    expect(getInitials('Juan Pérez')).toBe('JP')
  })
  it('falls back to first 2 letters for a single-word name', () => {
    expect(getInitials('Madonna')).toBe('MA')
  })
  it('returns ? for a null name', () => {
    expect(getInitials(null)).toBe('?')
  })
})

describe('getInitialColor', () => {
  it('returns a stable color for the same name', () => {
    expect(getInitialColor('Juan Pérez')).toBe(getInitialColor('Juan Pérez'))
  })
  it('returns a fallback color for a null name', () => {
    expect(getInitialColor(null)).toBe('#64748b')
  })
})
```

Agregar al final de `lib/utils/transporterDocs.test.ts`:

```typescript
import { driverRosterStatus } from './transporterDocs'

describe('driverRosterStatus', () => {
  it('reports the expiry alert first when a date is expired', () => {
    const driver = { ...DRIVER, governance: { ...DRIVER.governance!, id_expiry: '2020-01-01' } }
    const status = driverRosterStatus(driver)
    expect(status.tone).toBe('danger')
  })

  it('reports "Docs OK" when nothing is pending and dates are fine', () => {
    const driver = {
      ...DRIVER,
      governance: {
        ...DRIVER.governance!, id_expiry: '2099-01-01', license_expiry: '2099-01-01',
        epp: 'ok' as const, das_odi: 'ok' as const,
      },
    }
    const status = driverRosterStatus(driver)
    expect(status).toEqual({ label: 'Docs OK', tone: 'ok' })
  })

  it('counts pending/null/actualizar documentation fields when dates are fine', () => {
    const driver = {
      ...DRIVER,
      governance: {
        ...DRIVER.governance!, id_expiry: '2099-01-01', license_expiry: '2099-01-01',
        epp: null, das_odi: 'pendiente' as const,
      },
    }
    const status = driverRosterStatus(driver)
    expect(status.tone).toBe('warn')
    expect(status.label).toMatch(/pendiente/)
  })
})
```

- [ ] **Step 2: Escribir el test que falla para el componente**

```typescript
// components/dashboard/DriverRosterCard.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DriverRosterCard } from './DriverRosterCard'
import type { TransporterDriver } from '@/lib/types'

const DRIVER: TransporterDriver = {
  id: 'd1', rut: '11111111-1', name: 'Juan Pérez',
  governance: {
    id_expiry: '2099-01-01', license_expiry: '2099-01-01',
    anexo_3_gc: 'ok', epp: 'ok', das_odi: 'ok', hoja_de_vida: 'ok',
    cert_antecedentes: 'ok', validado_gc_driver: 'ok', contrato_trabajo: 'ok',
    creacion_gc_driver: 'ok', avance_total: 100,
  },
}

describe('DriverRosterCard', () => {
  it('renders the name, rut and a status label', () => {
    render(<DriverRosterCard driver={DRIVER} onOpen={vi.fn()} />)
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('Docs OK')).toBeInTheDocument()
  })

  it('calls onOpen when clicked', () => {
    const onOpen = vi.fn()
    render(<DriverRosterCard driver={DRIVER} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalled()
  })

  it('shows a danger status when license is expired', () => {
    const expired = { ...DRIVER, governance: { ...DRIVER.governance!, license_expiry: '2020-01-01' } }
    render(<DriverRosterCard driver={expired} onOpen={vi.fn()} />)
    expect(screen.getByText('Vencimiento vencido')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Correr los tests, confirmar que fallan**

```bash
cd monitor-app/frontend && npx vitest run lib/utils/avatar.test.ts lib/utils/transporterDocs.test.ts components/dashboard/DriverRosterCard.test.tsx
```
Esperado: FAIL (`avatar.ts` y `DriverRosterCard.tsx` no existen; `driverRosterStatus` no existe).

- [ ] **Step 4: Implementar `lib/utils/avatar.ts`**

```typescript
// lib/utils/avatar.ts
const INITIAL_COLORS = [
  '#0A66C2', '#10b981', '#8b5cf6', '#f59e0b',
  '#ef4444', '#06b6d4', '#64748b', '#e11d48',
]

export function getInitialColor(name: string | null): string {
  if (!name) return '#64748b'
  return INITIAL_COLORS[name.charCodeAt(0) % INITIAL_COLORS.length]
}

export function getInitials(name: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
}
```

- [ ] **Step 5: Agregar `driverRosterStatus` a `lib/utils/transporterDocs.ts`**

Agregar al final del archivo (import adicional al inicio: `import { getDriverAlertStatus } from '@/lib/compliance'` y `import type { TransporterDriver } from '@/lib/types'` si no están ya):

```typescript
export function driverRosterStatus(driver: TransporterDriver): { label: string; tone: 'ok' | 'warn' | 'danger' } {
  const alert = getDriverAlertStatus(driver)
  if (alert === 'expired') return { label: 'Vencimiento vencido', tone: 'danger' }
  if (alert === 'expiring_soon') return { label: 'Vencimiento próximo', tone: 'warn' }
  const pending = driverGovernanceToChecklistItems(driver)
    .filter(i => i.status === null || i.status === 'pendiente' || i.status === 'actualizar').length
  if (pending === 0) return { label: 'Docs OK', tone: 'ok' }
  return { label: `${pending} pendiente${pending > 1 ? 's' : ''}`, tone: 'warn' }
}
```

- [ ] **Step 6: Implementar `DriverRosterCard.tsx`**

```tsx
// components/dashboard/DriverRosterCard.tsx
'use client'

import type { TransporterDriver } from '@/lib/types'
import { getInitials, getInitialColor } from '@/lib/utils/avatar'
import { driverRosterStatus } from '@/lib/utils/transporterDocs'

const TONE_CLS: Record<'ok' | 'warn' | 'danger', string> = {
  ok:     'text-green-600',
  warn:   'text-amber-600',
  danger: 'text-red-600',
}

interface Props {
  driver: TransporterDriver
  onOpen: () => void
}

/** Tarjeta compacta del roster de conductores — solo lo escaneable
 *  (avatar + nombre + un estado resumen). El detalle completo vive en
 *  DriverDetailPanel, abierto al hacer click. */
export function DriverRosterCard({ driver, onOpen }: Props) {
  const status = driverRosterStatus(driver)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-2.5 border border-border rounded-xl px-3 py-2.5 text-left hover:border-gray-300 hover:shadow-sm transition-all bg-white"
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
        style={{ backgroundColor: getInitialColor(driver.name) }}
      >
        {getInitials(driver.name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-text-primary truncate">{driver.name}</p>
        <p className={`text-[10px] font-semibold ${TONE_CLS[status.tone]}`}>{status.label}</p>
      </div>
    </button>
  )
}
```

- [ ] **Step 7: Correr los tests, confirmar que pasan**

```bash
cd monitor-app/frontend && npx vitest run lib/utils/avatar.test.ts lib/utils/transporterDocs.test.ts components/dashboard/DriverRosterCard.test.tsx
```
Esperado: PASS (5 + 6 + 3 = 14 tests entre los tres archivos).

- [ ] **Step 8: Commit**

```bash
git add monitor-app/frontend/lib/utils/avatar.ts monitor-app/frontend/lib/utils/avatar.test.ts monitor-app/frontend/lib/utils/transporterDocs.ts monitor-app/frontend/lib/utils/transporterDocs.test.ts monitor-app/frontend/components/dashboard/DriverRosterCard.tsx monitor-app/frontend/components/dashboard/DriverRosterCard.test.tsx
git commit -m "feat(empresas): DriverRosterCard — tarjeta compacta de conductor"
```

---

### Task 4: `VehicleRosterCard.tsx` — tarjeta compacta de equipo

**Files:**
- Modify: `monitor-app/frontend/lib/utils/transporterDocs.ts` (agrega `vehicleRosterStatus`, `vehicleCategory`, `VEHICLE_CATEGORY_LABELS`)
- Create: `monitor-app/frontend/components/dashboard/VehicleRosterCard.tsx`
- Test: `monitor-app/frontend/lib/utils/transporterDocs.test.ts` (agrega casos), `monitor-app/frontend/components/dashboard/VehicleRosterCard.test.tsx`

**Interfaces:**
- Produces: `vehicleRosterStatus(vehicle: TransporterVehicle): { label: string; tone: 'ok' | 'warn' | 'danger' }`; `type VehicleCategory = 'tracto' | 'rampla' | 'camion' | 'furgon' | 'otro'`; `vehicleCategory(type: string | null | undefined): VehicleCategory`; `VEHICLE_CATEGORY_LABELS: Record<VehicleCategory, string>` (movidos desde `empresa/[id]/page.tsx`, única fuente ahora); `<VehicleRosterCard vehicle={TransporterVehicle} onOpen={() => void} />`. Consumido por Task 9 (ficha, incluido el filtro tracto/rampla).
- Consumes: `getInitials`/`getInitialColor` no aplican aquí (los equipos no usan iniciales de nombre) — usa la patente directamente. `getVehicleAlertStatus` (`@/lib/compliance`), `vehicleGovernanceToChecklistItems` (Task 1).

- [ ] **Step 1: Escribir los tests que fallan primero**

Agregar al final de `lib/utils/transporterDocs.test.ts`:

```typescript
import { vehicleRosterStatus, vehicleCategory, VEHICLE_CATEGORY_LABELS } from './transporterDocs'

describe('vehicleCategory', () => {
  it('classifies by keyword in the free-text type', () => {
    expect(vehicleCategory('Tractocamión')).toBe('tracto')
    expect(vehicleCategory('Rampla Semirremolque')).toBe('rampla')
    expect(vehicleCategory('Camión Furgón')).toBe('furgon')
    expect(vehicleCategory('Camión Rígido')).toBe('camion')
    expect(vehicleCategory(null)).toBe('otro')
  })
})

describe('VEHICLE_CATEGORY_LABELS', () => {
  it('has a label for every category', () => {
    expect(VEHICLE_CATEGORY_LABELS.tracto).toBe('Tracto')
    expect(VEHICLE_CATEGORY_LABELS.rampla).toBe('Rampla')
  })
})

describe('vehicleRosterStatus', () => {
  it('reports the expiry alert first when a date is expired', () => {
    const vehicle = { ...VEHICLE, governance: { ...VEHICLE.governance!, circ_permit_expiry: '2020-01-01' } }
    const status = vehicleRosterStatus(vehicle)
    expect(status.tone).toBe('danger')
  })

  it('reports "Docs OK" when nothing is pending and dates are fine', () => {
    const vehicle = {
      ...VEHICLE,
      governance: {
        ...VEHICLE.governance!,
        circ_permit_expiry: '2099-01-01', tech_inspection_expiry: '2099-01-01',
        gas_emissions_expiry: '2099-01-01', soap_insurance_expiry: '2099-01-01',
        poliza_rc: 'ok' as const, seguro_carga: 'ok' as const,
      },
    }
    const status = vehicleRosterStatus(vehicle)
    expect(status).toEqual({ label: 'Docs OK', tone: 'ok' })
  })
})
```

```typescript
// components/dashboard/VehicleRosterCard.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VehicleRosterCard } from './VehicleRosterCard'
import type { TransporterVehicle } from '@/lib/types'

const VEHICLE: TransporterVehicle = {
  id: 'v1', type: 'Tractocamión', plate: 'ABCD12',
  governance: {
    year: 2020, circ_permit_expiry: '2099-01-01', tech_inspection_expiry: '2099-01-01',
    gas_emissions_expiry: '2099-01-01', soap_insurance_expiry: '2099-01-01',
    padron: 'ok', poliza_rc: 'ok', gps: 'ok', seguro_carga: 'ok',
    mantencion_camara_frio: 'n_a', creacion_gc_vehicle: 'ok',
  },
}

describe('VehicleRosterCard', () => {
  it('renders the plate, category and a status label', () => {
    render(<VehicleRosterCard vehicle={VEHICLE} onOpen={vi.fn()} />)
    expect(screen.getByText('ABCD12')).toBeInTheDocument()
    expect(screen.getByText('Tracto')).toBeInTheDocument()
    expect(screen.getByText('Docs OK')).toBeInTheDocument()
  })

  it('calls onOpen when clicked', () => {
    const onOpen = vi.fn()
    render(<VehicleRosterCard vehicle={VEHICLE} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

```bash
cd monitor-app/frontend && npx vitest run lib/utils/transporterDocs.test.ts components/dashboard/VehicleRosterCard.test.tsx
```
Esperado: FAIL (`VehicleRosterCard.tsx` no existe; `vehicleRosterStatus`/`vehicleCategory`/`VEHICLE_CATEGORY_LABELS` no existen).

- [ ] **Step 3: Agregar a `lib/utils/transporterDocs.ts`**

Agregar al final del archivo (import adicional: `import { getVehicleAlertStatus } from '@/lib/compliance'` y `TransporterVehicle` al import de tipos si no está ya):

```typescript
export type VehicleCategory = 'tracto' | 'rampla' | 'camion' | 'furgon' | 'otro'

export const VEHICLE_CATEGORY_LABELS: Record<VehicleCategory, string> = {
  tracto: 'Tracto', rampla: 'Rampla', camion: 'Camión', furgon: 'Furgón', otro: 'Otro',
}

/** Clasificación heurística de equipo por texto libre — el contrato de
 *  TransporterVehicle solo trae `type` como texto, sin un enum. */
export function vehicleCategory(type: string | null | undefined): VehicleCategory {
  const t = (type ?? '').toLowerCase()
  if (t.includes('rampla') || t.includes('remolque')) return 'rampla'
  if (t.includes('tracto')) return 'tracto'
  if (t.includes('furg')) return 'furgon'
  if (t.includes('cami')) return 'camion'
  return 'otro'
}

export function vehicleRosterStatus(vehicle: TransporterVehicle): { label: string; tone: 'ok' | 'warn' | 'danger' } {
  const alert = getVehicleAlertStatus(vehicle)
  if (alert === 'expired') return { label: 'Vencimiento vencido', tone: 'danger' }
  if (alert === 'expiring_soon') return { label: 'Vencimiento próximo', tone: 'warn' }
  const pending = vehicleGovernanceToChecklistItems(vehicle)
    .filter(i => i.status === null || i.status === 'pendiente' || i.status === 'actualizar').length
  if (pending === 0) return { label: 'Docs OK', tone: 'ok' }
  return { label: `${pending} pendiente${pending > 1 ? 's' : ''}`, tone: 'warn' }
}
```

- [ ] **Step 4: Implementar `VehicleRosterCard.tsx`**

```tsx
// components/dashboard/VehicleRosterCard.tsx
'use client'

import { Truck } from 'lucide-react'
import type { TransporterVehicle } from '@/lib/types'
import { vehicleRosterStatus, vehicleCategory, VEHICLE_CATEGORY_LABELS } from '@/lib/utils/transporterDocs'

const TONE_CLS: Record<'ok' | 'warn' | 'danger', string> = {
  ok:     'text-green-600',
  warn:   'text-amber-600',
  danger: 'text-red-600',
}

interface Props {
  vehicle: TransporterVehicle
  onOpen:  () => void
}

/** Tarjeta compacta del roster de equipos — patente + categoría + estado
 *  resumen. El detalle completo vive en VehicleDetailPanel. */
export function VehicleRosterCard({ vehicle, onOpen }: Props) {
  const status = vehicleRosterStatus(vehicle)
  const category = vehicleCategory(vehicle.type)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-2.5 border border-border rounded-xl px-3 py-2.5 text-left hover:border-gray-300 hover:shadow-sm transition-all bg-white"
    >
      <div className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 text-slate-500 shrink-0">
        <Truck size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-bold text-text-primary font-mono truncate">{vehicle.plate}</p>
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">
            {VEHICLE_CATEGORY_LABELS[category]}
          </span>
        </div>
        <p className={`text-[10px] font-semibold ${TONE_CLS[status.tone]}`}>{status.label}</p>
      </div>
    </button>
  )
}
```

- [ ] **Step 5: Correr los tests, confirmar que pasan**

```bash
cd monitor-app/frontend && npx vitest run lib/utils/transporterDocs.test.ts components/dashboard/VehicleRosterCard.test.tsx
```
Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/lib/utils/transporterDocs.ts monitor-app/frontend/lib/utils/transporterDocs.test.ts monitor-app/frontend/components/dashboard/VehicleRosterCard.tsx monitor-app/frontend/components/dashboard/VehicleRosterCard.test.tsx
git commit -m "feat(empresas): VehicleRosterCard — tarjeta compacta de equipo"
```

---

### Task 5: `DriverDetailPanel.tsx` — panel de detalle lateral de conductor

**Files:**
- Create: `monitor-app/frontend/components/dashboard/DriverDetailPanel.tsx`
- Test: `monitor-app/frontend/components/dashboard/DriverDetailPanel.test.tsx`

**Interfaces:**
- Consumes: `DocumentChecklist` (modo `onStatusChange`, Task 2), `driverGovernanceToChecklistItems`/`withDriverGovernanceField` (Task 1).
- Produces: `<DriverDetailPanel driver={TransporterDriver | null} canEdit={boolean} canAdmin={boolean} onClose={() => void} onPatch={(did, body) => Promise<void>} onRemove={() => Promise<void>} onTransferClick={() => void} />`. `onRemove` reemplaza el botón "eliminar" (ícono `Trash2`) que hoy vive en `DriverRow` — mismo gate `canEdit`. Consumido por Task 9 (ficha). Mismo contrato de accesibilidad que `TransporterSlideOver.tsx` (referencia exacta: `role="dialog"`, `aria-modal`, foco atrapado, Escape cierra, foco vuelve al elemento que abrió el panel al cerrar).

- [ ] **Step 1: Escribir los tests que fallan primero**

```typescript
// components/dashboard/DriverDetailPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DriverDetailPanel } from './DriverDetailPanel'
import type { TransporterDriver } from '@/lib/types'

const DRIVER: TransporterDriver = {
  id: 'd1', rut: '11111111-1', name: 'Juan Pérez',
  governance: {
    id_expiry: '2099-01-01', license_expiry: '2099-01-01',
    anexo_3_gc: 'ok', epp: null, das_odi: 'ok', hoja_de_vida: 'ok',
    cert_antecedentes: 'ok', validado_gc_driver: 'ok', contrato_trabajo: 'ok',
    creacion_gc_driver: 'ok', avance_total: 90,
  },
}

function renderPanel(driver: TransporterDriver | null, opts: {
  canEdit?: boolean; canAdmin?: boolean
  onPatch?: (did: string, body: unknown) => Promise<void>
  onRemove?: () => Promise<void>
} = {}) {
  return render(
    <DriverDetailPanel
      driver={driver}
      canEdit={opts.canEdit ?? true}
      canAdmin={opts.canAdmin ?? true}
      onClose={vi.fn()}
      onPatch={opts.onPatch ?? vi.fn().mockResolvedValue(undefined)}
      onRemove={opts.onRemove ?? vi.fn().mockResolvedValue(undefined)}
      onTransferClick={vi.fn()}
    />,
  )
}

describe('DriverDetailPanel', () => {
  it('renders nothing meaningful when driver is null', () => {
    renderPanel(null)
    expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument()
  })

  it('shows the driver name, rut and document checklist', () => {
    renderPanel(DRIVER)
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('11111111-1')).toBeInTheDocument()
    expect(screen.getByText('Anexo 3 GC')).toBeInTheDocument()
  })

  it('calls onPatch with the updated governance field when a status select changes', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    renderPanel(DRIVER, { onPatch })
    fireEvent.change(screen.getByLabelText('Estado de EPP'), { target: { value: 'ok' } })
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith('d1', {
      governance: expect.objectContaining({ epp: 'ok', anexo_3_gc: 'ok' }),
    }))
  })

  it('does not show the status select when canEdit is false', () => {
    renderPanel(DRIVER, { canEdit: false })
    expect(screen.queryByLabelText('Estado de EPP')).not.toBeInTheDocument()
  })

  it('saves edited expiry dates when "Guardar" is clicked', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    renderPanel(DRIVER, { onPatch })
    fireEvent.change(screen.getByLabelText('Vencimiento cédula de identidad'), { target: { value: '2030-05-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith('d1', {
      rut: '11111111-1', name: 'Juan Pérez',
      governance: expect.objectContaining({ id_expiry: '2030-05-01', license_expiry: '2099-01-01' }),
    }))
  })

  it('shows a "Transferir a otra empresa" button only for canAdmin', () => {
    renderPanel(DRIVER, { canAdmin: false })
    expect(screen.queryByRole('button', { name: /Transferir/ })).not.toBeInTheDocument()
  })

  it('calls onTransferClick when the transfer button is clicked', () => {
    const onTransferClick = vi.fn()
    render(
      <DriverDetailPanel
        driver={DRIVER} canEdit={true} canAdmin={true}
        onClose={vi.fn()} onPatch={vi.fn().mockResolvedValue(undefined)}
        onRemove={vi.fn().mockResolvedValue(undefined)}
        onTransferClick={onTransferClick}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Transferir/ }))
    expect(onTransferClick).toHaveBeenCalled()
  })

  it('shows "Eliminar conductor" only when canEdit, and calls onRemove when clicked', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined)
    renderPanel(DRIVER, { onRemove, canEdit: false })
    expect(screen.queryByRole('button', { name: /Eliminar conductor/ })).not.toBeInTheDocument()

    renderPanel(DRIVER, { onRemove, canEdit: true })
    fireEvent.click(screen.getByRole('button', { name: /Eliminar conductor/ }))
    await waitFor(() => expect(onRemove).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/DriverDetailPanel.test.tsx
```
Esperado: FAIL (`DriverDetailPanel.tsx` no existe).

- [ ] **Step 3: Implementar**

```tsx
// components/dashboard/DriverDetailPanel.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, X, ArrowRightLeft, Trash2 } from 'lucide-react'
import type { DriverGovernance, TransporterDriver, ComplianceStatus } from '@/lib/types'
import { DocumentChecklist } from './DocumentChecklist'
import { driverGovernanceToChecklistItems, withDriverGovernanceField } from '@/lib/utils/transporterDocs'
import { getInitials, getInitialColor } from '@/lib/utils/avatar'

interface Props {
  driver:          TransporterDriver | null
  canEdit:         boolean
  canAdmin:        boolean
  onClose:         () => void
  onPatch:         (did: string, body: { rut?: string; name?: string; governance?: DriverGovernance }) => Promise<void>
  onRemove:        () => Promise<void>
  onTransferClick: () => void
}

/** Panel de detalle de un conductor — se abre al hacer click en su tarjeta
 *  del roster. Mismo contrato de accesibilidad que TransporterSlideOver:
 *  Escape cierra, Tab atrapado, foco inicial y retorno al cerrar. */
export function DriverDetailPanel({ driver, canEdit, canAdmin, onClose, onPatch, onRemove, onTransferClick }: Props) {
  const open = !!driver
  const panelRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState({ rut: '', name: '', id_expiry: '', license_expiry: '' })
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [statusErr, setStatusErr] = useState<string | null>(null)

  useEffect(() => {
    if (!driver) return
    setDraft({
      rut: driver.rut, name: driver.name,
      id_expiry: driver.governance?.id_expiry ?? '',
      license_expiry: driver.governance?.license_expiry ?? '',
    })
    setErr(null); setStatusErr(null)
  }, [driver])

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

  async function handleSaveDatos() {
    if (!driver) return
    setSaving(true); setErr(null)
    try {
      await onPatch(driver.id, {
        rut: draft.rut, name: draft.name,
        governance: {
          ...(driver.governance ?? {}),
          id_expiry: draft.id_expiry || null,
          license_expiry: draft.license_expiry || null,
        } as DriverGovernance,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(docCode: string, status: ComplianceStatus) {
    if (!driver) return
    setStatusErr(null)
    try {
      await onPatch(driver.id, { governance: withDriverGovernanceField(driver.governance, docCode, status) })
    } catch (e) {
      setStatusErr(e instanceof Error ? e.message : 'Error al guardar')
    }
  }

  async function handleRemove() {
    setRemoving(true); setErr(null)
    try {
      await onRemove()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al eliminar')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={driver ? `Detalle de ${driver.name}` : 'Detalle de conductor'}
        tabIndex={-1}
        className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] bg-white border-l border-border shadow-2xl flex flex-col transition-transform duration-300 focus:outline-none ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {driver && (
          <>
            <div className="px-5 py-4 bg-slate-900 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                  style={{ backgroundColor: getInitialColor(driver.name) }}
                >
                  {getInitials(driver.name)}
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-white truncate">{driver.name}</h3>
                  <p className="text-[11px] text-white/50 font-mono">{driver.rut}</p>
                </div>
              </div>
              <button onClick={onClose} aria-label="Cerrar detalle" className="text-white/50 hover:text-white transition-colors shrink-0">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <section>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Datos y vencimientos</p>
                <div className="space-y-2">
                  <input
                    aria-label="Nombre"
                    value={draft.name}
                    disabled={!canEdit}
                    onChange={e => setDraft(v => ({ ...v, name: e.target.value }))}
                    className="w-full text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:bg-gray-50"
                  />
                  <input
                    aria-label="RUT"
                    value={draft.rut}
                    disabled={!canEdit}
                    onChange={e => setDraft(v => ({ ...v, rut: e.target.value }))}
                    className="w-full text-sm font-mono border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:bg-gray-50"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-gray-400 block mb-0.5">Vencimiento cédula de identidad</label>
                      <input
                        aria-label="Vencimiento cédula de identidad"
                        type="date"
                        value={draft.id_expiry}
                        disabled={!canEdit}
                        onChange={e => setDraft(v => ({ ...v, id_expiry: e.target.value }))}
                        className="w-full text-xs border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:bg-gray-50"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400 block mb-0.5">Vencimiento licencia</label>
                      <input
                        aria-label="Vencimiento licencia"
                        type="date"
                        value={draft.license_expiry}
                        disabled={!canEdit}
                        onChange={e => setDraft(v => ({ ...v, license_expiry: e.target.value }))}
                        className="w-full text-xs border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:bg-gray-50"
                      />
                    </div>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={handleSaveDatos}
                      disabled={saving}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 disabled:opacity-50"
                    >
                      {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                      Guardar
                    </button>
                  )}
                  {err && <p className="text-xs text-red-500">{err}</p>}
                </div>
              </section>

              <section>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Documentación</p>
                <DocumentChecklist
                  items={driverGovernanceToChecklistItems(driver)}
                  canEdit={canEdit}
                  onStatusChange={handleStatusChange}
                />
                {statusErr && <p className="text-xs text-red-500 mt-2">{statusErr}</p>}
              </section>

              {canAdmin && (
                <button
                  type="button"
                  onClick={onTransferClick}
                  className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-gray-600 border border-border hover:border-accent hover:text-accent rounded-lg px-4 py-2.5 transition-colors"
                >
                  <ArrowRightLeft size={14} /> Transferir a otra empresa
                </button>
              )}

              {canEdit && (
                <button
                  type="button"
                  onClick={handleRemove}
                  disabled={removing}
                  className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-red-500 border border-red-200 hover:bg-red-50 rounded-lg px-4 py-2.5 transition-colors disabled:opacity-50"
                >
                  {removing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Eliminar conductor
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/DriverDetailPanel.test.tsx
```
Esperado: PASS (8/8).

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/DriverDetailPanel.tsx monitor-app/frontend/components/dashboard/DriverDetailPanel.test.tsx
git commit -m "feat(empresas): DriverDetailPanel — panel de detalle lateral de conductor"
```

---

### Task 6: `VehicleDetailPanel.tsx` — panel de detalle lateral de equipo

**Files:**
- Create: `monitor-app/frontend/components/dashboard/VehicleDetailPanel.tsx`
- Test: `monitor-app/frontend/components/dashboard/VehicleDetailPanel.test.tsx`

**Interfaces:**
- Consumes: `DocumentChecklist` (modo `onStatusChange`, Task 2), `vehicleGovernanceToChecklistItems`/`withVehicleGovernanceField` (Task 1/4).
- Produces: `<VehicleDetailPanel vehicle={TransporterVehicle | null} canEdit={boolean} canAdmin={boolean} onClose={() => void} onPatch={(vid, body) => Promise<void>} onRemove={() => Promise<void>} onTransferClick={() => void} />` — `onTransferClick` es **opcional**: en Task 9 las ramplas (`isTrailer: true`, sin `governance`) se pasan sin este callback, igual que hoy `VehicleRow` recibe `onTransferClick={undefined}` para ramplas y oculta el botón (`canAdmin && onTransferClick`). `onRemove` reemplaza el botón "eliminar" que hoy vive en `VehicleRow` (para ramplas llama `removeTrailer`, para el resto `removeVehicle` — mismo criterio `isTrailer` que ya usa el `onRemove` original del page). Consumido por Task 9. Mismo contrato de accesibilidad que `DriverDetailPanel`/`TransporterSlideOver`.

- [ ] **Step 1: Escribir los tests que fallan primero**

```typescript
// components/dashboard/VehicleDetailPanel.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { VehicleDetailPanel } from './VehicleDetailPanel'
import type { TransporterVehicle } from '@/lib/types'

const VEHICLE: TransporterVehicle = {
  id: 'v1', type: 'Tractocamión', plate: 'ABCD12',
  governance: {
    year: 2020, circ_permit_expiry: '2099-01-01', tech_inspection_expiry: '2099-01-01',
    gas_emissions_expiry: '2099-01-01', soap_insurance_expiry: '2099-01-01',
    padron: 'ok', poliza_rc: null, gps: 'ok', seguro_carga: 'ok',
    mantencion_camara_frio: 'n_a', creacion_gc_vehicle: 'ok',
  },
}

function renderPanel(vehicle: TransporterVehicle | null, opts: {
  canEdit?: boolean; canAdmin?: boolean
  onPatch?: (vid: string, body: unknown) => Promise<void>
  onRemove?: () => Promise<void>
} = {}) {
  return render(
    <VehicleDetailPanel
      vehicle={vehicle}
      canEdit={opts.canEdit ?? true}
      canAdmin={opts.canAdmin ?? true}
      onClose={vi.fn()}
      onPatch={opts.onPatch ?? vi.fn().mockResolvedValue(undefined)}
      onRemove={opts.onRemove ?? vi.fn().mockResolvedValue(undefined)}
      onTransferClick={vi.fn()}
    />,
  )
}

describe('VehicleDetailPanel', () => {
  it('renders nothing meaningful when vehicle is null', () => {
    renderPanel(null)
    expect(screen.queryByText('ABCD12')).not.toBeInTheDocument()
  })

  it('shows the plate, type and document checklist', () => {
    renderPanel(VEHICLE)
    expect(screen.getByText('ABCD12')).toBeInTheDocument()
    expect(screen.getByText('Padrón')).toBeInTheDocument()
  })

  it('calls onPatch with the updated governance field when a status select changes', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    renderPanel(VEHICLE, { onPatch })
    fireEvent.change(screen.getByLabelText('Estado de Póliza RC'), { target: { value: 'ok' } })
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith('v1', {
      governance: expect.objectContaining({ poliza_rc: 'ok', padron: 'ok' }),
    }))
  })

  it('saves edited plate/type/expiry dates when "Guardar" is clicked', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    renderPanel(VEHICLE, { onPatch })
    fireEvent.change(screen.getByLabelText('Vencimiento permiso de circulación'), { target: { value: '2030-05-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith('v1', {
      type: 'Tractocamión', plate: 'ABCD12',
      governance: expect.objectContaining({ circ_permit_expiry: '2030-05-01' }),
    }))
  })

  it('shows a "Transferir a otra empresa" button only for canAdmin', () => {
    renderPanel(VEHICLE, { canAdmin: false })
    expect(screen.queryByRole('button', { name: /Transferir/ })).not.toBeInTheDocument()
  })

  it('does not show the transfer button when onTransferClick is not provided (trailers)', () => {
    render(
      <VehicleDetailPanel
        vehicle={VEHICLE} canEdit={true} canAdmin={true}
        onClose={vi.fn()} onPatch={vi.fn().mockResolvedValue(undefined)}
        onRemove={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    expect(screen.queryByRole('button', { name: /Transferir/ })).not.toBeInTheDocument()
  })

  it('shows "Eliminar equipo" only when canEdit, and calls onRemove when clicked', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined)
    renderPanel(VEHICLE, { onRemove, canEdit: false })
    expect(screen.queryByRole('button', { name: /Eliminar equipo/ })).not.toBeInTheDocument()

    renderPanel(VEHICLE, { onRemove, canEdit: true })
    fireEvent.click(screen.getByRole('button', { name: /Eliminar equipo/ }))
    await waitFor(() => expect(onRemove).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/VehicleDetailPanel.test.tsx
```
Esperado: FAIL (`VehicleDetailPanel.tsx` no existe).

- [ ] **Step 3: Implementar**

```tsx
// components/dashboard/VehicleDetailPanel.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, X, ArrowRightLeft, Truck, Trash2 } from 'lucide-react'
import type { VehicleGovernance, TransporterVehicle, ComplianceStatus } from '@/lib/types'
import { DocumentChecklist } from './DocumentChecklist'
import { vehicleGovernanceToChecklistItems, withVehicleGovernanceField } from '@/lib/utils/transporterDocs'

interface Props {
  vehicle:         TransporterVehicle | null
  canEdit:         boolean
  canAdmin:        boolean
  onClose:         () => void
  onPatch:         (vid: string, body: { type?: string; plate?: string; governance?: VehicleGovernance }) => Promise<void>
  onRemove:        () => Promise<void>
  onTransferClick?: () => void
}

const EXPIRY_FIELDS = [
  { key: 'circ_permit_expiry' as const,     label: 'Vencimiento permiso de circulación' },
  { key: 'tech_inspection_expiry' as const, label: 'Vencimiento revisión técnica' },
  { key: 'gas_emissions_expiry' as const,   label: 'Vencimiento gases' },
  { key: 'soap_insurance_expiry' as const,  label: 'Vencimiento SOAP' },
]

/** Panel de detalle de un equipo — mismo contrato de accesibilidad que
 *  DriverDetailPanel/TransporterSlideOver. */
export function VehicleDetailPanel({ vehicle, canEdit, canAdmin, onClose, onPatch, onRemove, onTransferClick }: Props) {
  const open = !!vehicle
  const panelRef = useRef<HTMLDivElement>(null)
  const [removing, setRemoving] = useState(false)
  const [draft, setDraft] = useState({
    type: '', plate: '',
    circ_permit_expiry: '', tech_inspection_expiry: '', gas_emissions_expiry: '', soap_insurance_expiry: '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [statusErr, setStatusErr] = useState<string | null>(null)

  useEffect(() => {
    if (!vehicle) return
    setDraft({
      type: vehicle.type, plate: vehicle.plate,
      circ_permit_expiry: vehicle.governance?.circ_permit_expiry ?? '',
      tech_inspection_expiry: vehicle.governance?.tech_inspection_expiry ?? '',
      gas_emissions_expiry: vehicle.governance?.gas_emissions_expiry ?? '',
      soap_insurance_expiry: vehicle.governance?.soap_insurance_expiry ?? '',
    })
    setErr(null); setStatusErr(null)
  }, [vehicle])

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

  async function handleSaveDatos() {
    if (!vehicle) return
    setSaving(true); setErr(null)
    try {
      await onPatch(vehicle.id, {
        type: draft.type, plate: draft.plate,
        governance: {
          ...(vehicle.governance ?? {}),
          circ_permit_expiry: draft.circ_permit_expiry || null,
          tech_inspection_expiry: draft.tech_inspection_expiry || null,
          gas_emissions_expiry: draft.gas_emissions_expiry || null,
          soap_insurance_expiry: draft.soap_insurance_expiry || null,
        } as VehicleGovernance,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(docCode: string, status: ComplianceStatus) {
    if (!vehicle) return
    setStatusErr(null)
    try {
      await onPatch(vehicle.id, { governance: withVehicleGovernanceField(vehicle.governance, docCode, status) })
    } catch (e) {
      setStatusErr(e instanceof Error ? e.message : 'Error al guardar')
    }
  }

  async function handleRemove() {
    setRemoving(true); setErr(null)
    try {
      await onRemove()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al eliminar')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={vehicle ? `Detalle de ${vehicle.plate}` : 'Detalle de equipo'}
        tabIndex={-1}
        className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] bg-white border-l border-border shadow-2xl flex flex-col transition-transform duration-300 focus:outline-none ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {vehicle && (
          <>
            <div className="px-5 py-4 bg-slate-900 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white shrink-0">
                  <Truck size={16} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-white font-mono truncate">{vehicle.plate}</h3>
                  <p className="text-[11px] text-white/50 truncate">{vehicle.type}</p>
                </div>
              </div>
              <button onClick={onClose} aria-label="Cerrar detalle" className="text-white/50 hover:text-white transition-colors shrink-0">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <section>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Datos y vencimientos</p>
                <div className="space-y-2">
                  <input
                    aria-label="Tipo de equipo"
                    value={draft.type}
                    disabled={!canEdit}
                    onChange={e => setDraft(v => ({ ...v, type: e.target.value }))}
                    className="w-full text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:bg-gray-50"
                  />
                  <input
                    aria-label="Patente"
                    value={draft.plate}
                    disabled={!canEdit}
                    onChange={e => setDraft(v => ({ ...v, plate: e.target.value }))}
                    className="w-full text-sm font-mono border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:bg-gray-50"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    {EXPIRY_FIELDS.map(({ key, label }) => (
                      <div key={key}>
                        <label className="text-[10px] text-gray-400 block mb-0.5">{label.replace('Vencimiento ', '')}</label>
                        <input
                          aria-label={label}
                          type="date"
                          value={draft[key]}
                          disabled={!canEdit}
                          onChange={e => setDraft(v => ({ ...v, [key]: e.target.value }))}
                          className="w-full text-xs border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:bg-gray-50"
                        />
                      </div>
                    ))}
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={handleSaveDatos}
                      disabled={saving}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 disabled:opacity-50"
                    >
                      {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                      Guardar
                    </button>
                  )}
                  {err && <p className="text-xs text-red-500">{err}</p>}
                </div>
              </section>

              <section>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Documentación</p>
                <DocumentChecklist
                  items={vehicleGovernanceToChecklistItems(vehicle)}
                  canEdit={canEdit}
                  onStatusChange={handleStatusChange}
                />
                {statusErr && <p className="text-xs text-red-500 mt-2">{statusErr}</p>}
              </section>

              {canAdmin && onTransferClick && (
                <button
                  type="button"
                  onClick={onTransferClick}
                  className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-gray-600 border border-border hover:border-accent hover:text-accent rounded-lg px-4 py-2.5 transition-colors"
                >
                  <ArrowRightLeft size={14} /> Transferir a otra empresa
                </button>
              )}

              {canEdit && (
                <button
                  type="button"
                  onClick={handleRemove}
                  disabled={removing}
                  className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-red-500 border border-red-200 hover:bg-red-50 rounded-lg px-4 py-2.5 transition-colors disabled:opacity-50"
                >
                  {removing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Eliminar equipo
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/VehicleDetailPanel.test.tsx
```
Esperado: PASS (7/7).

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/VehicleDetailPanel.tsx monitor-app/frontend/components/dashboard/VehicleDetailPanel.test.tsx
git commit -m "feat(empresas): VehicleDetailPanel — panel de detalle lateral de equipo"
```

---

### Task 7: `TransporterAlertBanner.tsx` — sección de alertas prominente

**Files:**
- Create: `monitor-app/frontend/components/dashboard/TransporterAlertBanner.tsx`
- Test: `monitor-app/frontend/components/dashboard/TransporterAlertBanner.test.tsx`

**Interfaces:**
- Consumes: `describeBlockingReason` (ya existe en `@/lib/utils/eligibility`, produce el texto legible por motivo — "Documentación bajo el umbral (82% < 90%)" / "Cuota de seguro vencida" / "Empresa inactiva").
- Produces: `<TransporterAlertBanner eligible={boolean} blockingReasons={BlockingReason[]} compliancePct={number | null} />`. Consumido por Task 9.

- [ ] **Step 1: Escribir los tests que fallan primero**

```typescript
// components/dashboard/TransporterAlertBanner.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TransporterAlertBanner } from './TransporterAlertBanner'

describe('TransporterAlertBanner', () => {
  it('renders nothing when the company is eligible', () => {
    const { container } = render(
      <TransporterAlertBanner eligible={true} blockingReasons={[]} compliancePct={100} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('lists each blocking reason with readable text', () => {
    render(
      <TransporterAlertBanner
        eligible={false}
        blockingReasons={['docs_below_threshold', 'insurance_overdue']}
        compliancePct={82}
      />,
    )
    expect(screen.getByText(/Documentación bajo el umbral \(82% < 90%\)/)).toBeInTheDocument()
    expect(screen.getByText('Cuota de seguro vencida')).toBeInTheDocument()
  })

  it('shows an unknown reason code verbatim rather than hiding it', () => {
    render(
      <TransporterAlertBanner eligible={false} blockingReasons={['new_future_reason']} compliancePct={null} />,
    )
    expect(screen.getByText('new_future_reason')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/TransporterAlertBanner.test.tsx
```
Esperado: FAIL (`TransporterAlertBanner.tsx` no existe).

- [ ] **Step 3: Implementar**

```tsx
// components/dashboard/TransporterAlertBanner.tsx
'use client'

import { AlertTriangle } from 'lucide-react'
import type { BlockingReason } from '@/lib/types'
import { describeBlockingReason } from '@/lib/utils/eligibility'

interface Props {
  eligible:        boolean
  blockingReasons: BlockingReason[]
  compliancePct:   number | null
}

/** Motivo concreto de bloqueo, siempre visible — reemplaza el ícono con
 *  tooltip que antes enterraba el motivo. */
export function TransporterAlertBanner({ eligible, blockingReasons, compliancePct }: Props) {
  if (eligible || blockingReasons.length === 0) return null

  return (
    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
      <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
      <div>
        <p className="text-xs font-bold text-red-700 mb-1">No habilitada para asignar</p>
        <ul className="space-y-0.5">
          {blockingReasons.map(reason => (
            <li key={reason} className="text-xs text-red-600">
              {describeBlockingReason(reason, compliancePct)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/TransporterAlertBanner.test.tsx
```
Esperado: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/TransporterAlertBanner.tsx monitor-app/frontend/components/dashboard/TransporterAlertBanner.test.tsx
git commit -m "feat(empresas): TransporterAlertBanner — motivo de bloqueo siempre visible"
```

---

### Task 8: `TransporterDocumentsPanel.tsx` — reestilo a fila (conserva TODA la funcionalidad)

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/TransporterDocumentsPanel.tsx`
- Test: `monitor-app/frontend/components/dashboard/TransporterDocumentsPanel.test.tsx` (nuevo — no existía antes)

**Interfaces:**
- Consumes: nada nuevo — mismos endpoints (`transportersApi.patchDocument`/`uploadDocumentFile`/`listDocumentFiles`), mismo tipo `TransporterDocument`.
- Produces: mismo contrato público `<TransporterDocumentsPanel tid canEdit documents onDocumentsChange />` — **sin cambios de props**. Cambia el layout interno: filas verticales (como `DocumentChecklist`) en vez de una grilla de tarjetas, y se elimina el toggle "colapsado por defecto" (ahora vive como una sección siempre visible de la ficha, ya no necesita ocultarse). Conserva: cambiar estado, pegar link, subir archivo, ver versiones, revertir edición manual — nada de esto se pierde.

- [ ] **Step 1: Escribir los tests que fallan primero**

```typescript
// components/dashboard/TransporterDocumentsPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TransporterDocumentsPanel } from './TransporterDocumentsPanel'
import { transportersApi } from '@/lib/api/transporters'
import type { TransporterDocument } from '@/lib/types'

vi.mock('@/lib/api/transporters', () => ({
  transportersApi: {
    patchDocument:      vi.fn(),
    uploadDocumentFile: vi.fn(),
    listDocumentFiles:  vi.fn(),
  },
}))

const DOCS: TransporterDocument[] = [
  {
    doc_code: 'rol_sii', label: 'Rol SII', status: 'ok', expiry_date: null,
    file_url: null, storage_path: null, manual_override: false, updated_at: '2026-07-01T00:00:00Z',
  },
  {
    doc_code: 'f30', label: 'F30', status: 'pendiente', expiry_date: '2026-01-01',
    file_url: null, storage_path: null, manual_override: true, updated_at: '2026-07-01T00:00:00Z',
  },
]

beforeEach(() => {
  vi.mocked(transportersApi.patchDocument).mockReset()
  vi.mocked(transportersApi.uploadDocumentFile).mockReset()
  vi.mocked(transportersApi.listDocumentFiles).mockReset().mockResolvedValue([])
})

describe('TransporterDocumentsPanel', () => {
  it('shows every document as a row, always visible (no collapse toggle)', () => {
    render(<TransporterDocumentsPanel tid="t1" documents={DOCS} canEdit={false} onDocumentsChange={vi.fn()} />)
    expect(screen.getByText('Rol SII')).toBeInTheDocument()
    expect(screen.getByText('F30')).toBeInTheDocument()
  })

  it('shows a manual-override badge for documents edited by hand', () => {
    render(<TransporterDocumentsPanel tid="t1" documents={DOCS} canEdit={false} onDocumentsChange={vi.fn()} />)
    expect(screen.getByTitle('Editado manualmente — el pipeline no lo sobreescribe')).toBeInTheDocument()
  })

  it('changes status via the select and reports the update', async () => {
    vi.mocked(transportersApi.patchDocument).mockResolvedValue({
      id: 'x', entity_type: 'transporter', entity_id: 't1', doc_code: 'rol_sii',
      status: 'pendiente', expiry_date: null, file_url: null, storage_path: null,
      manual_override: true, updated_at: '2026-07-10T00:00:00Z',
    })
    const onDocumentsChange = vi.fn()
    render(<TransporterDocumentsPanel tid="t1" documents={DOCS} canEdit={true} onDocumentsChange={onDocumentsChange} />)
    fireEvent.change(screen.getByLabelText('Estado de Rol SII'), { target: { value: 'pendiente' } })
    await waitFor(() => expect(transportersApi.patchDocument).toHaveBeenCalledWith('t1', 'rol_sii', { status: 'pendiente' }))
    await waitFor(() => expect(onDocumentsChange).toHaveBeenCalled())
  })

  it('uploads a file via the upload control', async () => {
    vi.mocked(transportersApi.uploadDocumentFile).mockResolvedValue({
      id: 's1', storage_path: 'x/y', file_name: 'f30.pdf', mime_type: 'application/pdf',
      size_bytes: 100, version: 1, uploaded_by: null, uploaded_at: '2026-07-10T00:00:00Z',
    })
    render(<TransporterDocumentsPanel tid="t1" documents={DOCS} canEdit={true} onDocumentsChange={vi.fn()} />)
    const file = new File(['x'], 'f30.pdf', { type: 'application/pdf' })
    // Ambos docs tienen su propio input[type=file] oculto; el primero corresponde a "Rol SII".
    const fileInputs = document.querySelectorAll('input[type="file"]')
    fireEvent.change(fileInputs[0], { target: { files: [file] } })
    await waitFor(() => expect(transportersApi.uploadDocumentFile).toHaveBeenCalledWith('t1', 'rol_sii', file))
  })

  it('shows a "Ver link" anchor for a non-editor when file_url is set', () => {
    const withLink = [{ ...DOCS[0], file_url: 'https://example.com/doc.pdf' }]
    render(<TransporterDocumentsPanel tid="t1" documents={withLink} canEdit={false} onDocumentsChange={vi.fn()} />)
    expect(screen.getByRole('link', { name: /Ver link/ })).toHaveAttribute('href', 'https://example.com/doc.pdf')
  })

  it('shows a revert control only for documents with manual_override', () => {
    render(<TransporterDocumentsPanel tid="t1" documents={DOCS} canEdit={true} onDocumentsChange={vi.fn()} />)
    expect(screen.getAllByTitle('Revertir a valor del pipeline')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/TransporterDocumentsPanel.test.tsx
```
Esperado: FAIL (el layout actual no tiene `aria-label="Estado de ..."` ni filas verticales — no existe el archivo de test previamente, así que todos los casos son nuevos).

- [ ] **Step 3: Reescribir el componente**

Reemplazar el contenido completo de `monitor-app/frontend/components/dashboard/TransporterDocumentsPanel.tsx`:

```tsx
'use client'

import { useRef, useState } from 'react'
import { Link2, Upload, FileText, RotateCcw, Loader2, Check, X } from 'lucide-react'
import { transportersApi } from '@/lib/api/transporters'
import type { ComplianceStatus, StoredFile, TransporterDocument } from '@/lib/types'
import { ComplianceBadge } from './ComplianceBadge'
import { getAlertStatus, formatExpiry } from '@/lib/compliance'

const STATUS_OPTIONS: { value: ComplianceStatus; label: string }[] = [
  { value: 'ok',         label: 'OK' },
  { value: 'pendiente',  label: 'Pendiente' },
  { value: 'actualizar', label: 'Actualizar' },
  { value: 'n_a',        label: 'N/A' },
  { value: 'factible',   label: 'Factible' },
]

// ── Una fila por documento — mismo lenguaje visual que DocumentChecklist,
//    pero con más acciones (link/upload/versiones/revertir) porque estos
//    documentos sí tienen archivo y edición manual detrás. ──────────────
function DocumentRow({
  tid, doc, canEdit, onUpdated,
}: {
  tid: string
  doc: TransporterDocument
  canEdit: boolean
  onUpdated: (patch: Partial<TransporterDocument>) => void
}) {
  const [busy, setBusy]           = useState(false)
  const [err, setErr]             = useState<string | null>(null)
  const [linkOpen, setLinkOpen]   = useState(false)
  const [linkDraft, setLinkDraft] = useState(doc.file_url ?? '')
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [versions, setVersions]   = useState<StoredFile[] | null>(null)
  const [versionsLoading, setVersionsLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function changeStatus(status: ComplianceStatus) {
    setBusy(true); setErr(null)
    try {
      const res = await transportersApi.patchDocument(tid, doc.doc_code, { status })
      onUpdated({ status: res.status, manual_override: res.manual_override, updated_at: res.updated_at })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setBusy(false)
    }
  }

  async function saveLink() {
    setBusy(true); setErr(null)
    try {
      const res = await transportersApi.patchDocument(tid, doc.doc_code, { file_url: linkDraft })
      onUpdated({ file_url: res.file_url, manual_override: res.manual_override, updated_at: res.updated_at })
      setLinkOpen(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar el link')
    } finally {
      setBusy(false)
    }
  }

  async function handleUpload(file: File) {
    setBusy(true); setErr(null)
    try {
      const stored = await transportersApi.uploadDocumentFile(tid, doc.doc_code, file)
      onUpdated({ storage_path: stored.storage_path, manual_override: true })
      if (versionsOpen) await loadVersions()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al subir el archivo')
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function loadVersions() {
    setVersionsLoading(true); setErr(null)
    try {
      setVersions(await transportersApi.listDocumentFiles(tid, doc.doc_code))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al cargar versiones')
    } finally {
      setVersionsLoading(false)
    }
  }

  async function toggleVersions() {
    const next = !versionsOpen
    setVersionsOpen(next)
    if (next && versions === null) await loadVersions()
  }

  async function revertOverride() {
    setBusy(true); setErr(null)
    try {
      const res = await transportersApi.patchDocument(tid, doc.doc_code, { manual_override: false })
      onUpdated({ manual_override: res.manual_override })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al revertir')
    } finally {
      setBusy(false)
    }
  }

  const alert = doc.expiry_date ? getAlertStatus(doc.expiry_date) : null
  const iconCls = doc.status === 'ok'
    ? 'bg-green-500 border-green-500 text-white'
    : doc.status === 'actualizar'
      ? 'bg-red-500 border-red-500 text-white'
      : 'bg-white border-amber-400 text-amber-500'

  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="flex items-center gap-2.5">
        <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${iconCls}`}>
          <Check size={11} className={doc.status === 'ok' ? '' : 'opacity-0'} />
        </span>
        <span className="text-xs font-semibold text-text-primary flex-1 truncate">{doc.label}</span>

        {doc.expiry_date && (
          <span className="flex items-center gap-1 text-[10px] font-mono text-gray-500 shrink-0">
            {formatExpiry(doc.expiry_date)} <ComplianceBadge status={alert} compact />
          </span>
        )}

        {doc.manual_override && (
          <span
            title="Editado manualmente — el pipeline no lo sobreescribe"
            className="text-[9px] font-semibold text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-full shrink-0"
          >
            manual
          </span>
        )}

        {canEdit ? (
          <select
            aria-label={`Estado de ${doc.label}`}
            value={doc.status ?? ''}
            disabled={busy}
            onChange={e => changeStatus(e.target.value as ComplianceStatus)}
            className="text-[11px] font-semibold border border-border rounded-md px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:opacity-50 shrink-0"
          >
            <option value="">—</option>
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : doc.file_url ? (
          <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:underline flex items-center gap-1 shrink-0">
            <Link2 size={10} /> Ver link
          </a>
        ) : null}

        {canEdit && (
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" onClick={() => setLinkOpen(v => !v)} title="Pegar link"
              className="p-1 rounded border border-border/60 text-gray-400 hover:text-accent hover:border-accent transition-colors">
              <Link2 size={11} />
            </button>
            <button type="button" onClick={() => fileInputRef.current?.click()} title="Subir archivo" disabled={busy}
              className="p-1 rounded border border-border/60 text-gray-400 hover:text-accent hover:border-accent transition-colors disabled:opacity-50">
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            </button>
            <input ref={fileInputRef} type="file" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f) }} />
            <button type="button" onClick={toggleVersions} title="Ver archivo / versiones"
              className="p-1 rounded border border-border/60 text-gray-400 hover:text-accent hover:border-accent transition-colors">
              <FileText size={11} />
            </button>
            {doc.manual_override && (
              <button type="button" onClick={revertOverride} title="Revertir a valor del pipeline" disabled={busy}
                className="p-1 rounded border border-border/60 text-gray-400 hover:text-amber-500 hover:border-amber-300 transition-colors disabled:opacity-50">
                <RotateCcw size={11} />
              </button>
            )}
          </div>
        )}
      </div>

      {linkOpen && (
        <div className="flex items-center gap-1 mt-2 pl-7">
          <input
            value={linkDraft}
            onChange={e => setLinkDraft(e.target.value)}
            placeholder="https://…"
            className="flex-1 min-w-0 text-[11px] border border-border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <button onClick={saveLink} disabled={busy} className="p-1 rounded bg-accent text-white disabled:opacity-50">
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          </button>
          <button onClick={() => setLinkOpen(false)} className="p-1 rounded text-gray-400 hover:text-gray-600">
            <X size={11} />
          </button>
        </div>
      )}

      {versionsOpen && (
        <div className="mt-2 pl-7 space-y-1">
          {versionsLoading ? (
            <p className="text-[10px] text-gray-400 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Cargando…</p>
          ) : (versions?.length ?? 0) === 0 ? (
            <p className="text-[10px] text-gray-300 italic">Sin archivos</p>
          ) : (
            versions!.map(v => (
              <a key={v.id} href={v.url ?? undefined} target="_blank" rel="noreferrer"
                className={`flex items-center justify-between text-[10px] gap-2 ${v.url ? 'text-accent hover:underline' : 'text-gray-400 pointer-events-none'}`}>
                <span className="truncate">v{v.version} · {v.file_name}</span>
                {!v.url && <span className="text-gray-300 shrink-0">(sin URL)</span>}
              </a>
            ))
          )}
        </div>
      )}

      {err && <p className="text-[10px] text-red-500 mt-1 pl-7">{err}</p>}
    </div>
  )
}

interface Props {
  tid: string
  documents: TransporterDocument[]
  canEdit: boolean
  onDocumentsChange: (docs: TransporterDocument[]) => void
}

/** Documentos de la empresa — sección siempre visible de la ficha (ya no
 *  colapsada por defecto: como sección propia de la nueva estructura de
 *  una sola página, no necesita ocultarse). Conserva todas las funciones
 *  (link, upload, versiones, revertir) — solo cambia el layout a filas. */
export function TransporterDocumentsPanel({ tid, documents, canEdit, onDocumentsChange }: Props) {
  const okCount = documents.filter(d => d.status === 'ok').length

  function handleUpdated(docCode: string, patch: Partial<TransporterDocument>) {
    onDocumentsChange(documents.map(d => d.doc_code === docCode ? { ...d, ...patch } : d))
  }

  if (documents.length === 0) {
    return <p className="text-xs text-gray-300 italic">Sin datos</p>
  }

  return (
    <div>
      <p className="text-xs text-gray-400 mb-2">{okCount} de {documents.length} completos</p>
      <div className="flex flex-col gap-1.5">
        {documents.map(doc => (
          <DocumentRow
            key={doc.doc_code}
            tid={tid}
            doc={doc}
            canEdit={canEdit}
            onUpdated={patch => handleUpdated(doc.doc_code, patch)}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/TransporterDocumentsPanel.test.tsx
```
Esperado: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/TransporterDocumentsPanel.tsx monitor-app/frontend/components/dashboard/TransporterDocumentsPanel.test.tsx
git commit -m "redesign(empresas): TransporterDocumentsPanel — filas estilo DocumentChecklist, sin perder funciones"
```

---

### Task 9: `empresa/[id]/page.tsx` — ensamblar la nueva ficha de una sola página

**Files:**
- Modify: `monitor-app/frontend/app/dashboard/transportistas/empresa/[id]/page.tsx` (reescritura completa — de ~1900 líneas monolíticas a una composición de los componentes de Tasks 1-8)
- Test: `monitor-app/frontend/app/dashboard/transportistas/empresa/[id]/page.test.tsx` (nuevo — no existía antes)

**Interfaces:**
- Consumes: `TransporterAlertBanner` (Task 7), `DriverRosterCard`/`VehicleRosterCard` (Tasks 3/4), `DriverDetailPanel`/`VehicleDetailPanel` (Tasks 5/6), `TransporterDocumentsPanel` restyled (Task 8), `VEHICLE_CATEGORY_LABELS`/`vehicleCategory` (Task 4).
- Elimina de este archivo (ya no se usan, movidos o superados): `DriverRow`, `MobileDriverCard`, `VehicleRow`, `MobileVehicleCard`, `GovernanceStatusBadge`, `GovernanceSelect`, `DRIVER_DOC_LABELS`, `VEHICLE_DOC_LABELS`, `VEHICLE_CATEGORY_LABELS`, `vehicleCategory`, `getInitialColor`, `getInitials`, `INITIAL_COLORS`, `type Tab`, `TABS`, el estado `activeTab`/`expandedDriver`/`expandedVehicle` y el `<table>` de cada tab.
- Mantiene sin cambios: `EditableField`, `CONTACT_ROLE_LABELS`, `ContactsSection`, el modal "Editar Datos Empresa", `TransferModal`, `InsuranceSummaryCard`, y los handlers `handleSaveField`, `handleResetField`, `handleAddDriver`, `handlePatchDriver`, `handleAddVehicle`, `handlePatchVehicle`, `handleConfirmTransfer`.
- Ajusta (no elimina) `handleRemoveDriver`/`handleRemoveVehicle`/`handleRemoveTrailer`: se les quita el `try/catch` propio que tenían estos dos últimos (que reemplazaba TODA la ficha por un mensaje de error ante un fallo al eliminar un equipo — demasiado destructivo ahora que la acción vive dentro de un panel) y se agrega `setSelectedDriverId(null)`/`setSelectedVehicleId(null)` para cerrar el panel tras eliminar. El error, si ocurre, ahora se muestra inline dentro del panel (`DriverDetailPanel`/`VehicleDetailPanel`, Tasks 5/6), no reemplazando la página.

- [ ] **Step 1: Escribir los tests que fallan primero**

```typescript
// app/dashboard/transportistas/empresa/[id]/page.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useParams } from 'next/navigation'
import EmpresaDetailPage from './page'
import { transportersApi } from '@/lib/api/transporters'
import { createClient } from '@/lib/supabase/client'

vi.mock('next/navigation', () => ({ useParams: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/api/transporters', () => ({
  transportersApi: {
    get: vi.fn(), patch: vi.fn(), resetField: vi.fn(),
    addDriver: vi.fn(), patchDriver: vi.fn(), removeDriver: vi.fn(),
    addVehicle: vi.fn(), patchVehicle: vi.fn(), removeVehicle: vi.fn(),
    addTrailer: vi.fn(), removeTrailer: vi.fn(),
    transferDriver: vi.fn(), transferVehicle: vi.fn(),
  },
}))
vi.mock('@/components/dashboard/InsuranceSummaryCard', () => ({ InsuranceSummaryCard: () => null }))

const PROFILE = {
  id: 't1', admin_id: '123', business_name: 'Transportes Test', rut: '11111111-1',
  account_stage: 'Operational', contactability: null, contacts: [],
  drivers: [{
    id: 'd1', rut: '22222222-2', name: 'Juan Pérez',
    governance: {
      id_expiry: '2099-01-01', license_expiry: '2099-01-01',
      anexo_3_gc: 'ok', epp: 'ok', das_odi: 'ok', hoja_de_vida: 'ok',
      cert_antecedentes: 'ok', validado_gc_driver: 'ok', contrato_trabajo: 'ok',
      creacion_gc_driver: 'ok', avance_total: 100,
    },
  }],
  vehicles: [{
    id: 'v1', type: 'Tractocamión', plate: 'ABCD12',
    governance: {
      year: 2020, circ_permit_expiry: '2099-01-01', tech_inspection_expiry: '2099-01-01',
      gas_emissions_expiry: '2099-01-01', soap_insurance_expiry: '2099-01-01',
      padron: 'ok', poliza_rc: 'ok', gps: 'ok', seguro_carga: 'ok',
      mantencion_camara_frio: 'n_a', creacion_gc_vehicle: 'ok',
    },
  }],
  trailers: [],
  manually_edited_fields: [], edited_at: null, in_admin: true, clients: ['Walmart'],
  eligibility: { eligible: false, compliance_pct: 82, insurance_ok: true, blocking_reasons: ['docs_below_threshold'] },
  documents: [],
}

beforeEach(() => {
  vi.mocked(useParams).mockReturnValue({ id: 't1' })
  vi.mocked(createClient).mockReturnValue({
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  } as unknown as ReturnType<typeof createClient>)
  vi.mocked(transportersApi.get).mockReset().mockResolvedValue(PROFILE as never)
})

describe('EmpresaDetailPage', () => {
  it('shows the alert banner with the blocking reason', async () => {
    render(<EmpresaDetailPage />)
    expect(await screen.findByText(/Documentación bajo el umbral \(82% < 90%\)/)).toBeInTheDocument()
  })

  it('shows the driver and vehicle rosters', async () => {
    render(<EmpresaDetailPage />)
    expect(await screen.findByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('ABCD12')).toBeInTheDocument()
  })

  it('opens the driver detail panel when a roster card is clicked', async () => {
    render(<EmpresaDetailPage />)
    fireEvent.click(await screen.findByText('Juan Pérez'))
    expect(await screen.findByLabelText('Estado de EPP')).toBeInTheDocument()
  })

  it('filters the driver roster by search', async () => {
    render(<EmpresaDetailPage />)
    await screen.findByText('Juan Pérez')
    fireEvent.change(screen.getByPlaceholderText('Filtrar por nombre o RUT…'), { target: { value: 'nadie' } })
    await waitFor(() => expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument())
  })

  it('filters the equipment roster by category (tracto/rampla)', async () => {
    render(<EmpresaDetailPage />)
    await screen.findByText('ABCD12')
    fireEvent.click(screen.getByRole('button', { name: 'Rampla' }))
    await waitFor(() => expect(screen.queryByText('ABCD12')).not.toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

```bash
cd monitor-app/frontend && npx vitest run "app/dashboard/transportistas/empresa/[id]/page.test.tsx"
```
Esperado: FAIL (el archivo actual no tiene roster de tarjetas ni banner de alertas).

- [ ] **Step 3: Reescribir el componente**

Reemplazar el contenido completo de `monitor-app/frontend/app/dashboard/transportistas/empresa/[id]/page.tsx`:

```tsx
'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronRight, PenLine, Check, X, RotateCcw,
  Loader2, ShieldCheck, Search,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { transportersApi } from '@/lib/api/transporters'
import type {
  TransporterProfile, TransporterDriver, TransporterVehicle, TransporterContact,
  DriverGovernance, VehicleGovernance,
} from '@/lib/types'
import { EligibilityDot } from '@/components/dashboard/EligibilityDot'
import { InsuranceSummaryCard } from '@/components/dashboard/InsuranceSummaryCard'
import { TransporterDocumentsPanel } from '@/components/dashboard/TransporterDocumentsPanel'
import { TransporterAlertBanner } from '@/components/dashboard/TransporterAlertBanner'
import { DriverRosterCard } from '@/components/dashboard/DriverRosterCard'
import { VehicleRosterCard } from '@/components/dashboard/VehicleRosterCard'
import { DriverDetailPanel } from '@/components/dashboard/DriverDetailPanel'
import { VehicleDetailPanel } from '@/components/dashboard/VehicleDetailPanel'
import { TransferModal } from '@/components/dashboard/TransferModal'
import { describeEligibility } from '@/lib/utils/eligibility'
import { getDriverAlertStatus, getVehicleAlertStatus } from '@/lib/compliance'
import { vehicleCategory, VEHICLE_CATEGORY_LABELS, type VehicleCategory } from '@/lib/utils/transporterDocs'

const ACCOUNT_STAGES = ['Lead', 'Operational']
const EDITOR_ROLES = new Set(['editor', 'admin', 'owner'])
const ADMIN_ROLES  = new Set(['admin', 'owner'])

const VEHICLE_TYPES = [
  'Tractocamión', 'Camión Rígido', 'Camión Furgón', 'Camión Refrigerado', 'Plataforma', 'Cisterna',
]

// ── Editable field (modal "Editar Datos Empresa") — sin cambios ────
function EditableField({
  label, value, field, isProtected, canEdit, onSave, onReset, options,
}: {
  label: string; value: string | null; field: string
  isProtected: boolean; canEdit: boolean
  onSave: (field: string, val: string) => Promise<void>
  onReset: (field: string) => Promise<void>
  options?: string[]
}) {
  const [editing, setEditing]   = useState(false)
  const [draft, setDraft]       = useState(value ?? '')
  const [saving, setSaving]     = useState(false)
  const [fieldErr, setFieldErr] = useState<string | null>(null)

  const handleSave = async () => {
    if (draft === (value ?? '')) { setEditing(false); return }
    setSaving(true); setFieldErr(null)
    try { await onSave(field, draft); setEditing(false) }
    catch (e) { setFieldErr(e instanceof Error ? e.message : 'Error') }
    finally { setSaving(false) }
  }

  return (
    <div className="py-3 border-b border-border/60 last:border-0">
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-400 w-32 shrink-0">{label}</span>
        {editing ? (
          <div className="flex items-center gap-2 flex-1">
            {options ? (
              <select
                className="flex-1 text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                autoFocus
              >
                {options.map(o => <option key={o}>{o}</option>)}
              </select>
            ) : (
              <input
                className="flex-1 text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false) }}
                autoFocus
              />
            )}
            <button onClick={handleSave} disabled={saving}
              className="p-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            </button>
            <button onClick={() => { setEditing(false); setFieldErr(null) }}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-sm text-text-primary flex-1 truncate">
              {value || <span className="text-gray-300 italic">sin datos</span>}
            </span>
            {isProtected && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-500 shrink-0">Protegido</span>
            )}
            {canEdit && (
              <button
                onClick={() => { setDraft(value ?? ''); setEditing(true) }}
                className="p-1.5 rounded-lg border border-border/60 text-gray-400 hover:text-accent hover:border-accent hover:bg-accent/5 shrink-0"
              >
                <PenLine size={13} />
              </button>
            )}
            {isProtected && canEdit && (
              <button
                onClick={async () => { setSaving(true); try { await onReset(field) } finally { setSaving(false) } }}
                className="p-1.5 rounded-lg border border-border/60 text-gray-400 hover:text-amber-500 hover:border-amber-300 shrink-0"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              </button>
            )}
          </div>
        )}
      </div>
      {fieldErr && <p className="text-xs text-red-500 mt-1 pl-[9.5rem]">{fieldErr}</p>}
    </div>
  )
}

// ── Contactos (app.transporter_contacts) — sin cambios ─────────────
const CONTACT_ROLE_LABELS: Record<TransporterContact['role'], string> = {
  rep_legal:   'Representante legal',
  operacional: 'Operacional',
  finanzas:    'Finanzas',
  documentos:  'Documentos',
}

function ContactsSection({ contacts, tp }: { contacts: TransporterContact[]; tp: TransporterProfile }) {
  const byRole = new Map(contacts.map(c => [c.role, c]))
  return (
    <div className="bg-white rounded-xl border border-border p-4 md:p-5">
      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Contactos</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {(Object.keys(CONTACT_ROLE_LABELS) as TransporterContact['role'][]).map(role => {
          const c = byRole.get(role)
          return (
            <div key={role} className="border border-border/60 rounded-lg p-3">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">{CONTACT_ROLE_LABELS[role]}</p>
              {c?.name || c?.phone || c?.email ? (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-text-primary truncate">{c.name ?? <span className="text-gray-300 italic">sin nombre</span>}</p>
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-accent">
                      {c.phone}
                    </a>
                  )}
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-accent truncate">
                      <span className="truncate">{c.email}</span>
                    </a>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-gray-300 italic">Sin datos</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────
export default function EmpresaDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [tp, setTp]               = useState<TransporterProfile | null>(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [canEdit, setCanEdit]     = useState(false)
  const [canAdmin, setCanAdmin]   = useState(false)
  const [editOpen, setEditOpen]   = useState(false)

  const [selectedDriverId,  setSelectedDriverId]  = useState<string | null>(null)
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [driverQ,         setDriverQ]         = useState('')
  const [driverAlertOnly, setDriverAlertOnly] = useState(false)
  const [vehicleQ,        setVehicleQ]        = useState('')
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState<VehicleCategory | 'todos'>('todos')
  const [vehicleAlertOnly, setVehicleAlertOnly] = useState(false)

  const [addDriverOpen,  setAddDriverOpen]  = useState(false)
  const [driverForm,     setDriverForm]     = useState({ rut: '', name: '' })
  const [addVehicleOpen, setAddVehicleOpen] = useState(false)
  const [vehicleForm,    setVehicleForm]    = useState({ type: '', plate: '' })
  const [submitting,     setSubmitting]     = useState(false)

  const [transferTarget, setTransferTarget] = useState<
    { kind: 'driver' | 'vehicle'; id: string; label: string } | null
  >(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single()
      if (profile && EDITOR_ROLES.has(profile.role)) setCanEdit(true)
      if (profile && ADMIN_ROLES.has(profile.role)) setCanAdmin(true)
    })
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setTp(await transportersApi.get(id)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Error cargando datos') }
    finally { setLoading(false) }
  }, [id])

  useEffect(() => { load() }, [load])

  const handleSaveField = async (field: string, value: string) => {
    setTp(await transportersApi.patch(id, { [field]: value }))
  }
  const handleResetField = async (field: string) => {
    await transportersApi.resetField(id, field); await load()
  }

  const handleAddDriver = async () => {
    if (!driverForm.rut || !driverForm.name) return
    setSubmitting(true)
    try {
      await transportersApi.addDriver(id, driverForm)
      setDriverForm({ rut: '', name: '' })
      setAddDriverOpen(false)
      await load()
    } finally { setSubmitting(false) }
  }

  const handlePatchDriver = async (did: string, body: { rut?: string; name?: string; governance?: DriverGovernance }) => {
    const res = await transportersApi.patchDriver(id, did, body)
    setTp(prev => prev ? { ...prev, drivers: prev.drivers.map(d => d.id === did ? res.data : d) } : prev)
  }

  // Sin try/catch propio (a diferencia del page original, donde
  // handleRemoveVehicle/handleRemoveTrailer sí lo tenían): el error ahora
  // se muestra inline dentro del panel de detalle (Tasks 5/6), no
  // reemplazando toda la página — evita que un fallo al eliminar un
  // conductor/equipo borre el resto de la ficha.
  const handleRemoveDriver = async (did: string) => {
    await transportersApi.removeDriver(id, did)
    setSelectedDriverId(null)
    await load()
  }

  const handleAddVehicle = async () => {
    if (!vehicleForm.plate) return
    setSubmitting(true)
    try {
      await transportersApi.addVehicle(id, vehicleForm)
      setVehicleForm({ type: '', plate: '' })
      setAddVehicleOpen(false)
      await load()
    } finally { setSubmitting(false) }
  }

  const handlePatchVehicle = async (vid: string, body: { type?: string; plate?: string; governance?: VehicleGovernance }) => {
    const res = await transportersApi.patchVehicle(id, vid, body)
    setTp(prev => prev ? { ...prev, vehicles: prev.vehicles.map(v => v.id === vid ? res.data : v) } : prev)
  }

  const handleRemoveVehicle = async (vid: string) => {
    await transportersApi.removeVehicle(id, vid)
    setSelectedVehicleId(null)
    await load()
  }

  const handleRemoveTrailer = async (trid: string) => {
    await transportersApi.removeTrailer(id, trid)
    setSelectedVehicleId(null)
    await load()
  }

  const handleConfirmTransfer = async (toTransporterId: string) => {
    if (!transferTarget) return
    try {
      if (transferTarget.kind === 'driver') {
        await transportersApi.transferDriver(id, transferTarget.id, toTransporterId)
      } else {
        await transportersApi.transferVehicle(id, transferTarget.id, toTransporterId)
      }
      setTransferTarget(null)
      await load()
    } catch (e) {
      // Se relanza para que TransferModal muestre el error junto a la acción
      throw e
    }
  }

  const filteredDrivers = useMemo(() => {
    if (!tp) return []
    return tp.drivers.filter(d => {
      const matchesQ = !driverQ || d.name.toLowerCase().includes(driverQ.toLowerCase()) || d.rut.includes(driverQ)
      const matchesAlert = !driverAlertOnly || getDriverAlertStatus(d) !== 'ok'
      return matchesQ && matchesAlert
    })
  }, [tp, driverQ, driverAlertOnly])

  // Equipos: tractos/camiones/furgones (con gobernanza completa) + ramplas
  // (sin gobernanza en el contrato actual) unificados para el filtro de Tipo.
  const allEquipment = useMemo((): (TransporterVehicle & { isTrailer: boolean })[] => tp ? [
    ...tp.vehicles.map(v => ({ ...v, isTrailer: false })),
    ...tp.trailers.map(t => ({ id: t.id, type: 'Rampla', plate: t.plate, governance: null, isTrailer: true })),
  ] : [], [tp])

  const filteredVehicles = useMemo(() => allEquipment.filter(v => {
    const matchesQ = !vehicleQ ||
      v.plate.toLowerCase().includes(vehicleQ.toLowerCase()) ||
      (v.type ?? '').toLowerCase().includes(vehicleQ.toLowerCase())
    const matchesType = vehicleTypeFilter === 'todos' || vehicleCategory(v.type) === vehicleTypeFilter
    const matchesAlert = !vehicleAlertOnly || v.isTrailer || getVehicleAlertStatus(v) !== 'ok'
    return matchesQ && matchesType && matchesAlert
  }), [allEquipment, vehicleQ, vehicleTypeFilter, vehicleAlertOnly])

  const selectedDriver  = tp?.drivers.find(d => d.id === selectedDriverId) ?? null
  const selectedVehicle = allEquipment.find(v => v.id === selectedVehicleId) ?? null

  if (loading) return (
    <div className="p-6 flex items-center gap-2 text-sm text-gray-400">
      <Loader2 size={16} className="animate-spin" /> Cargando…
    </div>
  )
  if (error || !tp) return (
    <div className="p-6 text-sm text-red-500">
      {error ?? 'No encontrado'}
      <Link href="/dashboard/transportistas" className="block mt-2 text-accent hover:underline text-xs">← Volver</Link>
    </div>
  )

  const protected_ = new Set(tp.manually_edited_fields)

  return (
    <div className="p-4 md:p-6 space-y-5 relative">
      {editOpen && (
        <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setEditOpen(false)} />
      )}

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-400">
        <Link href="/dashboard/transportistas" className="hover:text-accent transition-colors shrink-0">Empresas</Link>
        <ChevronRight size={13} />
        <span className="text-text-primary font-medium truncate">{tp.business_name ?? id}</span>
      </nav>

      {/* Header + Seguros */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 items-start">
        <div className="bg-white rounded-xl border border-border p-4 md:p-5">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <EligibilityDot
                  eligible={tp.eligibility.eligible}
                  blockingReasons={tp.eligibility.blocking_reasons}
                  compliancePct={tp.eligibility.compliance_pct}
                  size="md"
                />
                <h1 className="font-mulish font-black text-xl md:text-2xl text-text-primary leading-tight">
                  {tp.business_name ?? '—'}
                </h1>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5 pl-4">
                {describeEligibility(tp.eligibility.eligible, tp.eligibility.blocking_reasons, tp.eligibility.compliance_pct)}
              </p>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {tp.rut && (
                  <p className="text-xs text-gray-500">
                    RUT: <span className="font-mono text-gray-700 bg-gray-50 px-1.5 py-0.5 rounded border border-border/60">{tp.rut}</span>
                  </p>
                )}
                {tp.account_stage && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                    {tp.account_stage}
                  </span>
                )}
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  tp.in_admin ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'
                }`}>
                  {tp.in_admin ? 'En admin' : 'No registrada en admin'}
                </span>
                {tp.clients.map(c => (
                  <span key={c} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{c}</span>
                ))}
                {tp.eligibility.eligible && (
                  <span className="inline-flex items-center gap-1 text-xs text-green-600 bg-green-50 border border-green-100 rounded-lg px-2 py-0.5">
                    <ShieldCheck size={11} /> Documentación al día
                  </span>
                )}
              </div>
            </div>

            {canEdit && (
              <button
                onClick={() => setEditOpen(true)}
                className="bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-bold transition border border-border shadow-sm shrink-0"
              >
                Editar Empresa
              </button>
            )}
          </div>
        </div>

        <InsuranceSummaryCard transporterId={tp.id} rut={tp.rut} />
      </div>

      <TransporterAlertBanner
        eligible={tp.eligibility.eligible}
        blockingReasons={tp.eligibility.blocking_reasons}
        compliancePct={tp.eligibility.compliance_pct}
      />

      <ContactsSection contacts={tp.contacts} tp={tp} />

      {/* ── Conductores ── */}
      <div className="bg-white rounded-xl border border-border p-4 md:p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Conductores ({tp.drivers.length})</h3>
          {canEdit && (
            <button
              onClick={() => setAddDriverOpen(v => !v)}
              className="text-xs bg-accent hover:bg-accent/90 text-white font-bold px-3 py-1.5 rounded-lg shadow-sm transition"
            >
              + Conductor
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={driverQ}
              onChange={e => setDriverQ(e.target.value)}
              placeholder="Filtrar por nombre o RUT…"
              className="pl-8 pr-4 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/30 w-56 bg-white"
            />
          </div>
          <button
            onClick={() => setDriverAlertOnly(v => !v)}
            aria-pressed={driverAlertOnly}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
              driverAlertOnly ? 'bg-accent border-accent text-white' : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            Con alertas
          </button>
        </div>

        {addDriverOpen && (
          <div className="mb-3 p-3 rounded-lg bg-gray-50/80 flex items-center gap-2 flex-wrap">
            <input
              placeholder="RUT"
              value={driverForm.rut}
              onChange={e => setDriverForm(v => ({ ...v, rut: e.target.value }))}
              className="text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 w-32"
            />
            <input
              placeholder="Nombre completo"
              value={driverForm.name}
              onChange={e => setDriverForm(v => ({ ...v, name: e.target.value }))}
              className="text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 flex-1"
            />
            <button
              onClick={handleAddDriver}
              disabled={submitting || !driverForm.rut || !driverForm.name}
              className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50"
            >
              {submitting ? <Loader2 size={13} className="animate-spin" /> : 'Guardar'}
            </button>
            <button onClick={() => setAddDriverOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          </div>
        )}

        {filteredDrivers.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-300">
            {driverQ || driverAlertOnly ? 'Sin resultados' : 'Sin conductores registrados'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {filteredDrivers.map(d => (
              <DriverRosterCard key={d.id} driver={d} onOpen={() => setSelectedDriverId(d.id)} />
            ))}
          </div>
        )}
      </div>

      {/* ── Equipos ── */}
      <div className="bg-white rounded-xl border border-border p-4 md:p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Equipos ({tp.vehicles.length + tp.trailers.length})</h3>
          {canEdit && (
            <button
              onClick={() => setAddVehicleOpen(v => !v)}
              className="text-xs bg-accent hover:bg-accent/90 text-white font-bold px-3 py-1.5 rounded-lg shadow-sm transition"
            >
              + Equipo
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={vehicleQ}
              onChange={e => setVehicleQ(e.target.value)}
              placeholder="Filtrar por patente o tipo…"
              className="pl-8 pr-4 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/30 w-56 bg-white"
            />
          </div>
          <button
            onClick={() => setVehicleTypeFilter('todos')}
            aria-pressed={vehicleTypeFilter === 'todos'}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
              vehicleTypeFilter === 'todos' ? 'bg-accent border-accent text-white' : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            Todos
          </button>
          {(Object.keys(VEHICLE_CATEGORY_LABELS) as VehicleCategory[]).map(cat => (
            <button
              key={cat}
              onClick={() => setVehicleTypeFilter(cat)}
              aria-pressed={vehicleTypeFilter === cat}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
                vehicleTypeFilter === cat ? 'bg-accent border-accent text-white' : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              {VEHICLE_CATEGORY_LABELS[cat]}
            </button>
          ))}
          <button
            onClick={() => setVehicleAlertOnly(v => !v)}
            aria-pressed={vehicleAlertOnly}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
              vehicleAlertOnly ? 'bg-accent border-accent text-white' : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            Con alertas
          </button>
        </div>

        {addVehicleOpen && (
          <div className="mb-3 p-3 rounded-lg bg-gray-50/80 flex items-center gap-2 flex-wrap">
            <select
              value={vehicleForm.type}
              onChange={e => setVehicleForm(v => ({ ...v, type: e.target.value }))}
              className="text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 w-36 bg-white"
            >
              <option value="">Tipo…</option>
              {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input
              placeholder="Patente"
              value={vehicleForm.plate}
              onChange={e => setVehicleForm(v => ({ ...v, plate: e.target.value }))}
              className="text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 w-24 font-mono uppercase"
            />
            <button
              onClick={handleAddVehicle}
              disabled={submitting || !vehicleForm.plate}
              className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50"
            >
              {submitting ? <Loader2 size={13} className="animate-spin" /> : 'Guardar'}
            </button>
            <button onClick={() => setAddVehicleOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          </div>
        )}

        {filteredVehicles.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-300">
            {vehicleQ || vehicleAlertOnly ? 'Sin resultados' : 'Sin equipos registrados'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {filteredVehicles.map(v => (
              <VehicleRosterCard key={v.id} vehicle={v} onOpen={() => setSelectedVehicleId(v.id)} />
            ))}
          </div>
        )}
      </div>

      {/* ── Documentos de la empresa ── */}
      <div className="bg-white rounded-xl border border-border p-4 md:p-5">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Documentos de la Empresa</h3>
        <TransporterDocumentsPanel
          tid={tp.id}
          documents={tp.documents}
          canEdit={canEdit}
          onDocumentsChange={docs => setTp(prev => prev ? { ...prev, documents: docs } : prev)}
        />
      </div>

      <DriverDetailPanel
        driver={selectedDriver}
        canEdit={canEdit}
        canAdmin={canAdmin}
        onClose={() => setSelectedDriverId(null)}
        onPatch={handlePatchDriver}
        onRemove={() => handleRemoveDriver(selectedDriver!.id)}
        onTransferClick={() => selectedDriver && setTransferTarget({ kind: 'driver', id: selectedDriver.id, label: `conductor ${selectedDriver.name}` })}
      />

      <VehicleDetailPanel
        vehicle={selectedVehicle}
        canEdit={canEdit}
        canAdmin={canAdmin}
        onClose={() => setSelectedVehicleId(null)}
        onPatch={handlePatchVehicle}
        onRemove={() => selectedVehicle!.isTrailer ? handleRemoveTrailer(selectedVehicle!.id) : handleRemoveVehicle(selectedVehicle!.id)}
        onTransferClick={selectedVehicle && !selectedVehicle.isTrailer
          ? () => setTransferTarget({ kind: 'vehicle', id: selectedVehicle.id, label: `equipo ${selectedVehicle.plate}` })
          : undefined}
      />

      {/* ── Edit Slide-Over ── */}
      <div
        className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] bg-white border-l border-border shadow-2xl flex flex-col transition-transform duration-300 ${
          editOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="px-5 py-4 bg-slate-900 flex items-center justify-between shrink-0">
          <h3 className="text-base font-bold text-white">Editar Datos Empresa</h3>
          <button onClick={() => setEditOpen(false)} className="text-white/50 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="py-2.5 border-b border-border/60 flex items-center gap-3">
            <span className="text-xs text-gray-400 w-32 shrink-0">Admin ID</span>
            <span className="text-sm font-mono text-gray-500">{tp.admin_id ?? '—'}</span>
          </div>
          <div className="py-2.5 border-b border-border/60 flex items-center gap-3">
            <span className="text-xs text-gray-400 w-32 shrink-0">Transporter ID</span>
            <span className="text-xs font-mono text-gray-400 select-all break-all">{tp.id}</span>
          </div>

          {([
            { label: 'Razón Social', field: 'business_name', value: tp.business_name },
            { label: 'RUT',          field: 'rut',           value: tp.rut },
            { label: 'Estado',       field: 'account_stage', value: tp.account_stage, options: ACCOUNT_STAGES },
          ] as const).map(f => (
            <EditableField
              key={f.field}
              label={f.label}
              value={f.value ?? null}
              field={f.field}
              isProtected={protected_.has(f.field)}
              canEdit={canEdit}
              onSave={handleSaveField}
              onReset={handleResetField}
              options={'options' in f ? f.options : undefined}
            />
          ))}

          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-2">Contactabilidad</h2>
          <div className="space-y-2">
            <div>
              <p className="text-xs text-gray-400 mb-1">Emails</p>
              <div className="flex flex-wrap gap-1.5">
                {(tp.contactability?.emails ?? []).length > 0
                  ? tp.contactability!.emails.map(e => (
                      <span key={e} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{e}</span>
                    ))
                  : <span className="text-xs text-gray-300 italic">sin emails</span>}
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Teléfonos</p>
              <div className="flex flex-wrap gap-1.5">
                {(tp.contactability?.phones ?? []).length > 0
                  ? tp.contactability!.phones.map(p => (
                      <span key={p} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{p}</span>
                    ))
                  : <span className="text-xs text-gray-300 italic">sin teléfonos</span>}
              </div>
            </div>
          </div>
        </div>
      </div>

      <TransferModal
        open={!!transferTarget}
        title={transferTarget ? `Transferir ${transferTarget.label}` : 'Transferir'}
        currentTransporterId={id}
        onClose={() => setTransferTarget(null)}
        onTransfer={handleConfirmTransfer}
      />
    </div>
  )
}
```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

```bash
cd monitor-app/frontend && npx vitest run "app/dashboard/transportistas/empresa/[id]/page.test.tsx"
```
Esperado: PASS (5/5).

- [ ] **Step 5: `tsc` y suite completa**

```bash
cd monitor-app/frontend && npx tsc --noEmit && npx vitest run
```
Esperado: ambos limpios. Si `tsc` señala un import no usado o un tipo que no calza (ej. `TransporterVehicle & { isTrailer }` vs. la prop `vehicle` de `VehicleDetailPanel`), ajustar el tipo del prop en ese archivo (Task 6) a aceptar el campo `isTrailer` opcional en vez de cambiar la forma de `allEquipment` aquí.

- [ ] **Step 6: Commit**

```bash
git add "monitor-app/frontend/app/dashboard/transportistas/empresa/[id]/page.tsx" "monitor-app/frontend/app/dashboard/transportistas/empresa/[id]/page.test.tsx"
git commit -m "redesign(empresas): ficha de detalle — roster compacto + panel lateral, reemplaza tablas siempre-densas"
```

---

### Task 10: Listado de Empresas — pulido visual (sin cambios de comportamiento)

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/TransporterCard.tsx`
- Modify: `monitor-app/frontend/app/dashboard/transportistas/page.tsx`

**Interfaces:** ninguna — mismos props, mismo comportamiento. Solo cambian nombres de clases Tailwind (radio de borde `rounded-xl` → `rounded-2xl`, consistente con el radio ya usado en Seguros — `InsuranceCompanyCard`, `InsurancePolicyModal`). No hay tests nuevos: no existían tests previos para estos dos archivos y este task no cambia comportamiento, solo estilo — verificar con `tsc`/`build` (Task 12) es suficiente.

- [ ] **Step 1: `TransporterCard.tsx` — radio de borde**

En `monitor-app/frontend/components/dashboard/TransporterCard.tsx`, línea 28, cambiar:
```tsx
      className={`text-left bg-white border rounded-xl p-4 space-y-3 cursor-pointer transition-all hover:shadow-md hover:border-gray-300 ${
```
por:
```tsx
      className={`text-left bg-white border rounded-2xl p-4 space-y-3 cursor-pointer transition-all hover:shadow-md hover:border-gray-300 ${
```

- [ ] **Step 2: `page.tsx` (listado) — radio de borde en KPIs, buscador y tabla**

En `monitor-app/frontend/app/dashboard/transportistas/page.tsx`:

Línea ~100 (botones de KPI), cambiar:
```tsx
                className={`flex items-center gap-2 bg-white border rounded-xl px-3.5 py-2 transition-all disabled:opacity-40 disabled:cursor-default ${
```
por:
```tsx
                className={`flex items-center gap-2 bg-white border rounded-2xl px-3.5 py-2 transition-all disabled:opacity-40 disabled:cursor-default ${
```

Línea ~114 (barra de búsqueda + chips), cambiar:
```tsx
      <div className="bg-white border border-border rounded-xl px-3.5 py-2.5 flex items-center gap-2 flex-wrap">
```
por:
```tsx
      <div className="bg-white border border-border rounded-2xl px-3.5 py-2.5 flex items-center gap-2 flex-wrap">
```

Línea ~160 (estado vacío), cambiar:
```tsx
        <p className="bg-white rounded-xl border border-border px-4 py-14 text-center text-sm text-gray-400">{emptyLabel}</p>
```
por:
```tsx
        <p className="bg-white rounded-2xl border border-border px-4 py-14 text-center text-sm text-gray-400">{emptyLabel}</p>
```

Línea ~177 (contenedor de la tabla), cambiar:
```tsx
          <div className="hidden md:block bg-white rounded-xl border border-border overflow-hidden">
```
por:
```tsx
          <div className="hidden md:block bg-white rounded-2xl border border-border overflow-hidden">
```

- [ ] **Step 3: Verificar visualmente**

```bash
cd monitor-app/frontend && npx tsc --noEmit
```
Esperado: limpio (cambios de solo texto en `className`, no hay riesgo de tipo). La verificación visual real ocurre en el smoke test del Task 12.

- [ ] **Step 4: Commit**

```bash
git add monitor-app/frontend/components/dashboard/TransporterCard.tsx monitor-app/frontend/app/dashboard/transportistas/page.tsx
git commit -m "style(empresas): listado — radio de borde consistente con Seguros"
```

---

### Task 11: `TransporterSlideOver.tsx` — pulido visual (sin cambios de comportamiento)

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/TransporterSlideOver.tsx`

**Interfaces:** ninguna — mismos props, mismo comportamiento, mismo contrato de accesibilidad (no se toca). Solo radio de borde en 3 elementos internos para consistencia con Seguros. `TransporterSlideOver.test.tsx` ya existe y no debe requerir cambios (no hay asserts sobre clases CSS).

- [ ] **Step 1: Radio de borde de las tarjetas de contacto**

En `monitor-app/frontend/components/dashboard/TransporterSlideOver.tsx`, en el bloque de contactos, cambiar:
```tsx
                      <div key={c.role} className="border border-border/60 rounded-lg p-2">
```
por:
```tsx
                      <div key={c.role} className="border border-border/60 rounded-xl p-2">
```

- [ ] **Step 2: Radio de borde de la lista de documentos con problema**

Cambiar:
```tsx
                            <li key={d.doc_code} className="flex items-center justify-between gap-2 text-[11px] bg-gray-50 rounded-lg px-2.5 py-1.5">
```
por:
```tsx
                            <li key={d.doc_code} className="flex items-center justify-between gap-2 text-[11px] bg-gray-50 rounded-xl px-2.5 py-1.5">
```

- [ ] **Step 3: Radio de borde del botón "Ver ficha completa"**

Cambiar:
```tsx
                href={`/dashboard/transportistas/empresa/${item.id}`}
                className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-white bg-accent hover:bg-accent/90 rounded-lg px-4 py-2.5 transition-colors"
```
por:
```tsx
                href={`/dashboard/transportistas/empresa/${item.id}`}
                className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-white bg-accent hover:bg-accent/90 rounded-xl px-4 py-2.5 transition-colors"
```

- [ ] **Step 4: Correr los tests existentes, confirmar que siguen pasando**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/TransporterSlideOver.test.tsx
```
Esperado: PASS (sin regresiones — cambios de solo `className`).

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/TransporterSlideOver.tsx
git commit -m "style(empresas): TransporterSlideOver — radio de borde consistente con Seguros"
```

---

### Task 12: Verificación final

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Suite completa de frontend**

```bash
cd monitor-app/frontend && npx vitest run
```
Esperado: todos los tests pasan, incluidos los nuevos de Tasks 1-9 (ningún test de backend se toca en este plan — es 100% frontend).

- [ ] **Step 2: Type-check y build**

```bash
cd monitor-app/frontend && npx tsc --noEmit && npm run build
```
Esperado: ambos limpios, sin referencias colgantes a `DriverRow`, `MobileDriverCard`, `VehicleRow`, `MobileVehicleCard`, `GovernanceSelect`, `GovernanceStatusBadge`.

```bash
grep -rn "DriverRow\|MobileDriverCard\|VehicleRow\|MobileVehicleCard\|GovernanceSelect\|GovernanceStatusBadge" monitor-app/frontend/app monitor-app/frontend/components 2>/dev/null
```
Esperado: sin resultados (todo lo viejo fue removido en Task 9, no solo dejado de usar).

- [ ] **Step 3: Smoke visual manual en navegador**

Con `venv/bin/python -m uvicorn app.main:app --port 8001` (backend) y `next dev` (frontend) corriendo:

1. `/dashboard/transportistas` → confirmar radio de borde consistente (tarjetas/tabla/KPIs), comportamiento de filtros/toggle igual que antes.
2. Click en una tarjeta → `TransporterSlideOver` abre igual que antes, con el nuevo radio de borde en sus tarjetas internas.
3. Click en "Ver ficha completa" → entra a la ficha nueva.
4. Ficha: confirmar el banner de Alertas aparece cuando `blocking_reasons` no está vacío, con el motivo concreto (no solo un ícono).
5. Sección Conductores: roster de tarjetas compactas, buscador funciona, chip "Con alertas" filtra.
6. Click en una tarjeta de conductor → panel lateral abre con "Datos y vencimientos" + "Documentación" (checklist con selects de estado) + "Transferir" (solo si `canAdmin`).
7. Cambiar un estado de documento en el checklist → guarda inmediatamente, sin botón "Guardar" aparte.
8. Editar una fecha de vencimiento + click "Guardar" → se guarda, el panel no se cierra.
9. Sección Equipos: mismo patrón + filtro tracto/rampla — confirmar que una rampla (`isTrailer`) no muestra botón "Transferir".
10. Sección "Documentos de la Empresa": confirmar que sigue funcionando pegar link, subir archivo, ver versiones, revertir edición manual — ahora en formato de fila.
11. Confirmar que ninguna sección quedó oculta detrás de un tab — todo visible en una sola página con scroll.

- [ ] **Step 4: Commit final si hubo ajustes del smoke test**

Si el Step 3 no encuentra problemas, no hay commit — el trabajo ya quedó commiteado en cada task anterior. Si se encuentra algo, corregir y commitear con un mensaje descriptivo del fix puntual.
