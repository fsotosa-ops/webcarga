# Empresas/Seguros — Checkpoint C: frontend sobre el backend reparado Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adaptar el frontend de Empresas/Seguros a los cambios de Checkpoint A (schema) y Checkpoint B (backend, recién pusheado a `origin/dev`), y agregar las features nuevas ya planificadas: tabs Operativa/No operativa, alta/baja manual, contactos editables, `registry_url` en pólizas. La investigación previa a este plan encontró dos cosas que van primero, antes de las features nuevas: (1) un hueco real en el backend — `GET /transporters/{tid}` no expone `baja_override`/`baja_reason` de conductores/vehículos, necesario para que la UI de alta/baja sepa qué botón mostrar; (2) un **bug ya activo hoy** — la UI de "ver versiones" de documentos en `TransporterDocumentsPanel.tsx` renderiza `undefined` porque el backend de Checkpoint B cambió la forma de esa respuesta y nadie actualizó el frontend.

**Architecture:** Next.js/React/TypeScript, mismo patrón ya establecido en el proyecto (fetch centralizado en `lib/api/*.ts` vía `apiFetch`, tipos en `lib/types.ts`, componentes en `components/dashboard/`, sin librerías nuevas). Los dos issues de compatibilidad (Task 1) se resuelven primero porque todo lo demás depende de tipos correctos.

**Tech Stack:** Next.js 16, TypeScript, Tailwind, lucide-react (sin emojis — convención del proyecto).

## Global Constraints

- Sin emojis en la UI — solo lucide-react (feedback explícito del usuario, ya documentado en memoria del proyecto).
- Reusar patrones ya existentes en el código, no inventar nuevos: modal 2 columnas (`DriverDetailPanel`/`InsurancePolicyModal`), edición inline tipo "Pegar link" (`TransporterDocumentsPanel`), botones admin-gated junto a "Transferir"/"Eliminar" (mismo bloque, mismo estilo).
- `npm run build` antes de dar por cerrado el checkpoint (convención del proyecto, `/deploy` lo exige).
- Nada se pushea a remoto sin decisión explícita del usuario — commits locales en `dev`.
- No modificar `extraction_service` ni nada del pipeline de trips — fuera de alcance total.

---

### Task 1: Backend — exponer `baja_override`/`baja_reason` de drivers/vehicles en `GET /transporters/{tid}`

**Contexto**: `get_transporter`'s driver/vehicle SELECTs (Checkpoint B, `transporters.py`) no traen `baja_override`/`baja_reason` — las columnas existen (Checkpoint A Task 1) y los endpoints de alta/baja las escriben (Checkpoint B Task 8), pero nada las devuelve en la ficha. Sin esto, el frontend no puede saber si mostrar "Dar de baja" o "Reactivar". **Verificado además** (controller, antes de dispatchar este task): el mismo hueco existe para la EMPRESA misma — `t = await pool.fetchrow("SELECT * FROM app.transporters WHERE id = $1", tid)` sí trae `baja_override`/`baja_reason` en el objeto `t` (es `SELECT *`), pero el dict de respuesta final (`return {"id": str(t["id"]), ...}`, línea ~483-506) no los copia. Este task cierra los 3 (empresa + drivers + vehicles) de una vez.

**Files:**
- Modify: `monitor-app/backend/api/app/routers/transporters.py` (`get_transporter`: las 2 queries `driver_rows`/`vehicle_rows`, el armado de `drivers`/`vehicles`, y el dict de respuesta principal)
- Modify: `monitor-app/backend/api/tests/test_transporters_relational.py`

**Interfaces:**
- Produces: `baja_override: bool`, `baja_reason: string | null` en el nivel raíz de `GET /transporters/{tid}` (la empresa) Y en cada elemento de `drivers[]`/`vehicles[]`.

- [ ] **Step 1: Test que falla primero**

Agregar a `tests/test_transporters_relational.py` un test que mockea `t` (fila de `app.transporters`) con `baja_override=True, baja_reason='documentacion_vencida'`, y `driver_rows`/`vehicle_rows` con lo mismo, y confirma que `GET /transporters/{tid}` los devuelve en los 3 niveles (raíz, cada conductor, cada vehículo).

- [ ] **Step 2: Implementar**

En el dict de respuesta principal, agregar `"baja_override": t["baja_override"], "baja_reason": t["baja_reason"],`. En `get_transporter`, agregar `d.baja_override, d.baja_reason` al SELECT de `driver_rows` y `v.baja_override, v.baja_reason` al de `vehicle_rows`. En el armado de `drivers`/`vehicles` (donde se construye el dict de cada uno), agregar `"baja_override": r["baja_override"], "baja_reason": r["baja_reason"]`.

- [ ] **Step 3: Correr, confirmar que pasa. Verificar contra Supabase real** (proyecto `viclzoftiudkepqnhekv`) — un conductor/vehículo de prueba, dar de baja vía el endpoint ya existente de Checkpoint B, confirmar que `GET /transporters/{tid}` ahora sí refleja `baja_override=true`, revertir. Sin PII en el reporte.

- [ ] **Step 4: Correr toda la suite (`pytest tests/ -v`), confirmar verde.**

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/api/app/routers/transporters.py monitor-app/backend/api/tests/test_transporters_relational.py
git commit -m "fix(api): expone baja_override/baja_reason de drivers/vehicles en GET /transporters/{tid}"
```

---

### Task 2: Fix del bug activo — versiones de documentos + tipos desactualizados

**Contexto**: Checkpoint B (`document_storage.get_document_history`) cambió la forma de la respuesta de `GET .../documents/{doc_code}/files` de `{id, storage_path, file_name, mime_type, size_bytes, version, uploaded_by, uploaded_at, url}` (`StoredFile`, tabla `app.stored_files` ya dropeada) a `{storage_path, status, expiry_date, replaced_at, replaced_by, url}` (derivado de `app.audit_log`). El frontend nunca se actualizó — `TransporterDocumentsPanel.tsx` hoy renderiza `v{undefined} · {undefined}` en cuanto alguien abre "Ver archivo / versiones" de un documento con historial. Mismo problema en el equivalente de Seguros (`InsurancePolicyModal`/`insuranceApi`), aunque ahí no hay UI de versiones montada todavía (menor urgencia, mismo fix de tipo).

**Files:**
- Modify: `monitor-app/frontend/lib/types.ts` (nuevo tipo `DocumentVersion`, reemplaza `StoredFile` como tipo de retorno de los endpoints `.../files`; `TransporterDocumentPatchResult` pierde `id`/`entity_type`/`entity_id`; `InsuranceDocument.id` se retira)
- Modify: `monitor-app/frontend/lib/api/transporters.ts` (`listDocumentFiles` retorna `DocumentVersion[]`)
- Modify: `monitor-app/frontend/lib/api/insurance.ts` (`listPolicyFiles`/`listDocumentFiles` retornan `DocumentVersion[]`)
- Modify: `monitor-app/frontend/components/dashboard/TransporterDocumentsPanel.tsx` (la lista de versiones, líneas ~196-212)
- Test: `monitor-app/frontend/components/dashboard/TransporterDocumentsPanel.test.tsx` (si existe; si no, crear uno mínimo cubriendo el render de versiones)

**Interfaces:**
- Produces: `DocumentVersion = {storage_path: string; status: ComplianceStatus | null; expiry_date: string | null; replaced_at: string; replaced_by: string; url: string | null}`. `uploadDocumentFile`/`uploadPolicyFile`/`uploadPolicyDocumentFile` (el POST .../file, no el GET de historial) siguen devolviendo `{storage_path, file_name, mime_type, size_bytes}` fusionado con el documento serializado — mantener su tipo de retorno como está (ya funciona, solo lee `.storage_path`) pero **no** tipar ese retorno como `StoredFile` (que ya no existe) — usar `Record<string, unknown> & { storage_path: string }` o un tipo `DocumentUploadResult` nuevo si se quiere precisión, sin bloquear en esto.

- [ ] **Step 1: `lib/types.ts`**

Reemplazar (líneas 484-495):
```ts
export type StoredFile = {
  id:            string
  storage_path:  string
  file_name:     string
  mime_type:     string | null
  size_bytes:    number | null
  version:       number
  uploaded_by:   string | null
  uploaded_at:   string
  /** Solo presente en GET .../files (URL firmada, null si la firma falló) */
  url?:          string | null
}
```
por:
```ts
/** Entrada del historial de reemplazos de un documento — derivado de
 *  app.audit_log (Checkpoint B), no de una tabla de versiones dedicada.
 *  Reemplaza a StoredFile para GET .../documents/{doc_code}/files. */
export type DocumentVersion = {
  storage_path:  string | null
  status:        ComplianceStatus | null
  expiry_date:   string | null
  replaced_at:   string | null
  replaced_by:   string | null
  /** URL firmada, null si el storage_path es null o si la firma falló */
  url:           string | null
}
```
En `TransporterDocumentPatchResult` (líneas 463-475), quitar `id: string`, `entity_type: string`, `entity_id: string` (el backend ya no los devuelve, ver Checkpoint B Task 3).
En `InsuranceDocument` (línea 604-616), quitar `id: string | null` (el backend ya no lo devuelve, tablas angostas sin PK `id` propia).

- [ ] **Step 2: `lib/api/transporters.ts` y `lib/api/insurance.ts`**

Cambiar el import de `StoredFile` por `DocumentVersion`. `listDocumentFiles`/`listPolicyFiles`/`listDocumentFiles` (insurance) pasan de `apiFetch<StoredFile[]>` a `apiFetch<DocumentVersion[]>`. Los 3 `upload*File` (POST) que retornaban `apiFetch<StoredFile>` — dejar como `apiFetch<Record<string, unknown>>` o similar tipo laxo ya que el shape real es `{storage_path, file_name, mime_type, size_bytes, ...documento serializado}`, no vale la pena modelarlo con precisión para este task (solo se lee `.storage_path`, que está presente en ambos casos).

- [ ] **Step 3: `TransporterDocumentsPanel.tsx`**

Cambiar el import `StoredFile` → `DocumentVersion`, `const [versions, setVersions] = useState<StoredFile[] | null>(null)` → `useState<DocumentVersion[] | null>(null)`. Reemplazar el bloque de render (líneas 203-209):
```tsx
versions!.map(v => (
  <a key={v.id} href={v.url ?? undefined} target="_blank" rel="noreferrer"
    className={`flex items-center justify-between text-[10px] gap-2 ${v.url ? 'text-accent hover:underline' : 'text-gray-400 pointer-events-none'}`}>
    <span className="truncate">v{v.version} · {v.file_name}</span>
    {!v.url && <span className="text-gray-300 shrink-0">(sin URL)</span>}
  </a>
))
```
por (key ahora es `storage_path ?? replaced_at` ya que no hay `id`; muestra estado+fecha de reemplazo en vez de nombre de archivo/versión, que ya no existen):
```tsx
versions!.map((v, i) => (
  <a key={v.storage_path ?? v.replaced_at ?? i} href={v.url ?? undefined} target="_blank" rel="noreferrer"
    className={`flex items-center justify-between text-[10px] gap-2 ${v.url ? 'text-accent hover:underline' : 'text-gray-400 pointer-events-none'}`}>
    <span className="truncate">
      {v.status ?? '—'} · reemplazado {v.replaced_at ? formatExpiry(v.replaced_at) : '—'}
    </span>
    {!v.url && <span className="text-gray-300 shrink-0">(sin archivo)</span>}
  </a>
))
```
(`formatExpiry` ya está importado en este archivo — reusar, no importar un formateador nuevo.)

- [ ] **Step 4: Verificar manualmente contra Supabase real** (no hay servidor local corriendo necesariamente — si `/start-dev` está disponible, levantar el backend y probar `GET /transporters/{tid}/documents/{doc_code}/files` contra una empresa de prueba real con al menos un reemplazo de documento; si no, verificar con `execute_sql` que `get_document_history`'s shape coincide exactamente con el nuevo tipo `DocumentVersion`).

- [ ] **Step 5: `npx tsc --noEmit`, `npx vitest run`, confirmar limpio/verde.**

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/lib/types.ts monitor-app/frontend/lib/api/transporters.ts monitor-app/frontend/lib/api/insurance.ts monitor-app/frontend/components/dashboard/TransporterDocumentsPanel.tsx
git commit -m "fix(frontend): repunta UI de versiones de documentos a la forma de respuesta de Checkpoint B — estaba rota (renderizaba undefined)"
```

---

### Task 3: Tabs Operativa/No operativa en el listado de Empresas

**Files:**
- Modify: `monitor-app/frontend/lib/types.ts` (`TransporterListItem`, `TransporterProfile`)
- Modify: `monitor-app/frontend/lib/utils/transporterFilters.ts` (nueva función, `isTransporterActive` queda pero deja de usarse para el split principal)
- Modify: `monitor-app/frontend/app/dashboard/transportistas/page.tsx`
- Test: `monitor-app/frontend/lib/utils/transporterFilters.test.ts` (si existe un test file para este util — buscarlo primero)

**Interfaces:**
- Consumes: `operational_status`/`matched_by_upload` (Checkpoint B Task 10), ya presentes en `GET /transporters` y `GET /transporters/{tid}`.

- [ ] **Step 1: Tipos**

En `TransporterListItem` (línea 517-538) y `TransporterProfile` (línea 497-515), agregar:
```ts
operational_status: 'operativa' | 'no_operativa'
matched_by_upload:  boolean
admin_account_id:   string | null
```

- [ ] **Step 2: `transporterFilters.ts`**

Agregar:
```ts
export function isOperativa(item: Pick<TransporterListItem, 'operational_status'>): boolean {
  return item.operational_status === 'operativa'
}
```
No borrar `isTransporterActive`/`'active'`/`'inactive'` de `TransporterFilterId`/`matchesTransporterFilter`/`deriveTransporterKpis` todavía — Task 3 Step 3 los reemplaza en `page.tsx` directamente con el nuevo tab, dejar el util viejo intacto por si algo más lo usa (verificar con `grep -rn "isTransporterActive" monitor-app/frontend/` antes de tocar nada más — si el único caller queda en el archivo de test viejo, está bien dejarlo, no es este task el que lo retira).

- [ ] **Step 3: `page.tsx` — tabs reales**

Quitar `'active'`/`'inactive'` de `KPI_CARDS` y `FILTER_CHIPS` (quedan `eligible`/`alert_docs`/`alert_insurance`/`alert_any` como chips, aplicables dentro del tab activo). Agregar estado `const [tab, setTab] = useState<'operativa' | 'no_operativa'>('operativa')` y una barra de 2 tabs (mismo lenguaje visual que `ViewToggle`, pero como bar de tabs con conteo, no un switch binario de 2 iconos — ejemplo:
```tsx
{!loading && (
  <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
    {(['operativa', 'no_operativa'] as const).map(t => {
      const count = items.filter(i => i.operational_status === t).length
      const active = tab === t
      return (
        <button
          key={t}
          onClick={() => setTab(t)}
          aria-pressed={active}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            active ? 'bg-white text-text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {t === 'operativa' ? 'Operativas' : 'No operativas'} <span className="ml-1 text-gray-400">{count}</span>
        </button>
      )
    })}
  </div>
)}
```
`visibleItems` (línea 54-57) pasa a filtrar primero por `item.operational_status === tab`, y luego por `activeFilter` si hay uno seleccionado (los chips restantes siguen aplicando dentro del tab). `emptyLabel` (línea 73) se ajusta para mencionar el tab activo si no hay resultados.

- [ ] **Step 4: Test unitario de `isOperativa`** (mismo archivo/patrón que el resto de `transporterFilters.ts` si tiene tests, si no crear `transporterFilters.test.ts` mínimo).

- [ ] **Step 5: `npx tsc --noEmit`, `npx vitest run`, confirmar limpio/verde.**

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/lib/types.ts monitor-app/frontend/lib/utils/transporterFilters.ts monitor-app/frontend/app/dashboard/transportistas/page.tsx
git commit -m "feat(frontend): tabs Operativa/No operativa en listado de Empresas, reemplaza filtro active/inactive roto"
```

---

### Task 4: Alta/baja manual — UI (ficha header + DriverDetailPanel + VehicleDetailPanel)

**Files:**
- Modify: `monitor-app/frontend/lib/types.ts` (`TransporterDriver`, `TransporterVehicle` agregan `baja_override`/`baja_reason`)
- Modify: `monitor-app/frontend/lib/api/transporters.ts` (6 funciones nuevas)
- Modify: `monitor-app/frontend/app/dashboard/transportistas/empresa/[id]/page.tsx` (botón en header, handlers, modal de motivo)
- Modify: `monitor-app/frontend/components/dashboard/DriverDetailPanel.tsx`
- Modify: `monitor-app/frontend/components/dashboard/VehicleDetailPanel.tsx`

**Interfaces:**
- Consumes: `POST /transporters/{tid}/deactivate|reactivate`, `.../drivers|vehicles/{id}/deactivate|reactivate` (Checkpoint B Task 8). `baja_override`/`baja_reason` en `GET /transporters/{tid}` (Task 1 de este plan).

- [ ] **Step 1: Tipos** — en `TransporterDriver`/`TransporterVehicle` (líneas 411-423) agregar `baja_override: boolean; baja_reason: string | null`.

- [ ] **Step 2: `lib/api/transporters.ts`**

```ts
export type BajaBody = {
  reason: 'documentacion_vencida' | 'termino_mutuo_acuerdo' | 'termino_penalizacion' | 'otro'
  notes?: string
}

// dentro de transportersApi:
deactivate: (id: string, body: BajaBody) =>
  apiFetch<{ ok: boolean; id: string; action: string }>(`/api/v1/transporters/${id}/deactivate`, {
    method: 'POST', body: JSON.stringify(body),
  }),

reactivate: (id: string) =>
  apiFetch<{ ok: boolean; id: string; action: string }>(`/api/v1/transporters/${id}/reactivate`, {
    method: 'POST',
  }),

deactivateDriver: (id: string, did: string, body: BajaBody) =>
  apiFetch<{ ok: boolean; id: string; action: string }>(`/api/v1/transporters/${id}/drivers/${did}/deactivate`, {
    method: 'POST', body: JSON.stringify(body),
  }),

reactivateDriver: (id: string, did: string) =>
  apiFetch<{ ok: boolean; id: string; action: string }>(`/api/v1/transporters/${id}/drivers/${did}/reactivate`, {
    method: 'POST',
  }),

deactivateVehicle: (id: string, vid: string, body: BajaBody) =>
  apiFetch<{ ok: boolean; id: string; action: string }>(`/api/v1/transporters/${id}/vehicles/${vid}/deactivate`, {
    method: 'POST', body: JSON.stringify(body),
  }),

reactivateVehicle: (id: string, vid: string) =>
  apiFetch<{ ok: boolean; id: string; action: string }>(`/api/v1/transporters/${id}/vehicles/${vid}/reactivate`, {
    method: 'POST',
  }),
```

- [ ] **Step 3: Modal de motivo (nuevo componente pequeño, reusado por los 3 lugares)**

Crear `monitor-app/frontend/components/dashboard/BajaReasonModal.tsx` — modal chico (no el patrón de 2 columnas, es un formulario de 2 campos: select de motivo + textarea de notas), mismo lenguaje visual que `TransferModal` si existe uno (buscarlo — `grep -rn "TransferModal\|transferTarget" monitor-app/frontend/components/dashboard/` — reusar su patrón de overlay/estructura si aplica, no inventar uno nuevo si ya existe un modal de confirmación con motivo en este proyecto):
```tsx
'use client'
import { useState } from 'react'
import { Loader2, X } from 'lucide-react'
import type { BajaBody } from '@/lib/api/transporters'

const REASON_LABELS: Record<BajaBody['reason'], string> = {
  documentacion_vencida:  'Documentación vencida',
  termino_mutuo_acuerdo:  'Término de contrato — mutuo acuerdo',
  termino_penalizacion:   'Término de contrato — penalización',
  otro:                   'Otro',
}

interface Props {
  label: string
  onClose: () => void
  onConfirm: (body: BajaBody) => Promise<void>
}

export function BajaReasonModal({ label, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState<BajaBody['reason']>('documentacion_vencida')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleConfirm() {
    setBusy(true); setErr(null)
    try {
      await onConfirm({ reason, notes: notes || undefined })
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al dar de baja')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-[51] flex items-center justify-center p-4">
        <div role="dialog" aria-modal="true" className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
          <button onClick={onClose} aria-label="Cerrar" className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
          <h3 className="text-sm font-bold text-text-primary mb-3">Dar de baja: {label}</h3>
          <label className="text-[10px] text-gray-400 block mb-1">Motivo</label>
          <select
            value={reason}
            onChange={e => setReason(e.target.value as BajaBody['reason'])}
            className="w-full text-xs border border-border rounded-lg px-3 py-1.5 mb-3 focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            {(Object.keys(REASON_LABELS) as BajaBody['reason'][]).map(r => (
              <option key={r} value={r}>{REASON_LABELS[r]}</option>
            ))}
          </select>
          <label className="text-[10px] text-gray-400 block mb-1">Notas (opcional)</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            className="w-full text-xs border border-border rounded-lg px-3 py-1.5 mb-3 focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          {err && <p className="text-xs text-red-500 mb-2">{err}</p>}
          <button
            onClick={handleConfirm}
            disabled={busy}
            className="w-full flex items-center justify-center gap-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold rounded-lg px-4 py-2 disabled:opacity-50"
          >
            {busy && <Loader2 size={12} className="animate-spin" />} Confirmar baja
          </button>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 4: `empresa/[id]/page.tsx` — botón en header + handlers**

Task 1 de este plan ya deja `baja_override`/`baja_reason` de la empresa disponibles en `GET /transporters/{tid}`. Agregar a `TransporterProfile` (`lib/types.ts`) `baja_override: boolean; baja_reason: string | null`. Junto al botón "Editar Empresa" (línea 426-433), agregar (gated en `canAdmin`, no `canEdit` — el backend exige admin):
```tsx
{canAdmin && (
  <button
    onClick={() => tp.baja_override ? handleReactivate() : setBajaModalOpen(true)}
    className={`px-4 py-2 rounded-lg text-sm font-bold transition border shadow-sm shrink-0 ${
      tp.baja_override
        ? 'bg-white hover:bg-gray-50 text-gray-700 border-border'
        : 'bg-white hover:bg-red-50 text-red-500 border-red-200'
    }`}
  >
    {tp.baja_override ? 'Reactivar' : 'Dar de baja'}
  </button>
)}
{bajaModalOpen && (
  <BajaReasonModal
    label={tp.business_name ?? 'esta empresa'}
    onClose={() => setBajaModalOpen(false)}
    onConfirm={async body => { await transportersApi.deactivate(id, body); await load() }}
  />
)}
```
`handleReactivate`: `async () => { await transportersApi.reactivate(id); await load() }`.

- [ ] **Step 5: `DriverDetailPanel.tsx`/`VehicleDetailPanel.tsx`**

Agregar props `onDeactivate: (body: BajaBody) => Promise<void>` y `onReactivate: () => Promise<void>` a la interface. En el bloque de botones (líneas 204-225 de `DriverDetailPanel.tsx`, análogo en Vehicle), agregar junto a "Transferir"/"Eliminar" (gated en `canAdmin`, mismo nivel que "Transferir"):
```tsx
{canAdmin && (
  driver.baja_override ? (
    <button type="button" onClick={onReactivate}
      className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-gray-600 border border-border hover:border-accent hover:text-accent rounded-lg px-4 py-2.5 transition-colors">
      Reactivar
    </button>
  ) : (
    <button type="button" onClick={() => setBajaModalOpen(true)}
      className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-red-500 border border-red-200 hover:bg-red-50 rounded-lg px-4 py-2.5 transition-colors">
      Dar de baja
    </button>
  )
)}
```
Con su propio `bajaModalOpen` state local al panel y el `BajaReasonModal` renderizado condicionalmente, `onConfirm` delega a la prop `onDeactivate`.

- [ ] **Step 6: `empresa/[id]/page.tsx` — pasar las nuevas props a los paneles**

```tsx
<DriverDetailPanel
  ...
  onDeactivate={body => transportersApi.deactivateDriver(id, selectedDriver!.id, body).then(load)}
  onReactivate={() => transportersApi.reactivateDriver(id, selectedDriver!.id).then(load)}
/>
<VehicleDetailPanel
  ...
  onDeactivate={body => transportersApi.deactivateVehicle(id, selectedVehicle!.id, body).then(load)}
  onReactivate={() => transportersApi.reactivateVehicle(id, selectedVehicle!.id).then(load)}
/>
```

- [ ] **Step 7: `npx tsc --noEmit`, `npx vitest run`, confirmar limpio/verde. Smoke visual manual** (Playwright si hay sesión disponible, o revisión manual): dar de baja y reactivar una empresa/conductor/vehículo de prueba real, confirmar que el botón cambia de label y que el tab Operativa/No operativa (Task 3) refleja el cambio tras recargar.

- [ ] **Step 8: Commit**

```bash
git add monitor-app/frontend/lib/types.ts monitor-app/frontend/lib/api/transporters.ts monitor-app/frontend/components/dashboard/BajaReasonModal.tsx monitor-app/frontend/components/dashboard/DriverDetailPanel.tsx monitor-app/frontend/components/dashboard/VehicleDetailPanel.tsx monitor-app/frontend/app/dashboard/transportistas/empresa/\[id\]/page.tsx
git commit -m "feat(frontend): alta/baja manual — botones en ficha de empresa, conductor y vehículo"
```

---

### Task 5: Contactos editables

**Files:**
- Modify: `monitor-app/frontend/lib/types.ts` (nada nuevo, `TransporterContact` ya existe con la forma correcta)
- Modify: `monitor-app/frontend/lib/api/transporters.ts` (4 funciones nuevas)
- Modify: `monitor-app/frontend/app/dashboard/transportistas/empresa/[id]/page.tsx` (`ContactsSection`, líneas 133-167)

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /transporters/{tid}/contacts[/{role}]` (Checkpoint B Task 7).

- [ ] **Step 1: `lib/api/transporters.ts`**

```ts
listContacts: (id: string) =>
  apiFetch<{ data: TransporterContact[] }>(`/api/v1/transporters/${id}/contacts`),

upsertContact: (id: string, body: { role: TransporterContact['role']; name?: string; phone?: string; email?: string }) =>
  apiFetch<{ data: TransporterContact }>(`/api/v1/transporters/${id}/contacts`, {
    method: 'POST', body: JSON.stringify(body),
  }),

deleteContact: (id: string, role: TransporterContact['role']) =>
  apiFetch<{ ok: boolean }>(`/api/v1/transporters/${id}/contacts/${role}`, { method: 'DELETE' }),
```
(No hace falta una función `patchContact` separada — el backend hace que PATCH y POST ejecuten la misma lógica; `upsertContact` cubre ambos casos con POST.)

- [ ] **Step 2: `ContactsSection` — reemplazar el bloque "Sin datos" por edición inline**

Reescribir el componente (líneas 133-167) para que cada tarjeta de rol sea interactiva cuando `canEdit`:
```tsx
function ContactCard({ tid, role, contact, canEdit, onSaved }: {
  tid: string; role: TransporterContact['role']; contact: TransporterContact | undefined
  canEdit: boolean; onSaved: (c: TransporterContact) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ name: contact?.name ?? '', phone: contact?.phone ?? '', email: contact?.email ?? '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setBusy(true); setErr(null)
    try {
      const res = await transportersApi.upsertContact(tid, { role, ...draft })
      onSaved(res.data)
      setEditing(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally { setBusy(false) }
  }

  if (editing) {
    return (
      <div className="border border-accent/40 rounded-lg p-3 space-y-1.5">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">{CONTACT_ROLE_LABELS[role]}</p>
        <input value={draft.name} onChange={e => setDraft(v => ({ ...v, name: e.target.value }))} placeholder="Nombre"
          className="w-full text-xs border border-border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent/30" />
        <input value={draft.phone} onChange={e => setDraft(v => ({ ...v, phone: e.target.value }))} placeholder="Teléfono"
          className="w-full text-xs border border-border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent/30" />
        <input value={draft.email} onChange={e => setDraft(v => ({ ...v, email: e.target.value }))} placeholder="Email"
          className="w-full text-xs border border-border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent/30" />
        {err && <p className="text-[10px] text-red-500">{err}</p>}
        <div className="flex gap-1.5 pt-1">
          <button onClick={save} disabled={busy} className="flex items-center gap-1 text-[11px] font-semibold text-white bg-accent rounded px-2 py-1 disabled:opacity-50">
            {busy ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Guardar
          </button>
          <button onClick={() => setEditing(false)} className="text-[11px] text-gray-400 hover:text-gray-600 px-2 py-1">Cancelar</button>
        </div>
      </div>
    )
  }

  return (
    <div className="border border-border/60 rounded-lg p-3 group relative">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">{CONTACT_ROLE_LABELS[role]}</p>
      {contact?.name || contact?.phone || contact?.email ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-text-primary truncate">{contact.name ?? <span className="text-gray-300 italic">sin nombre</span>}</p>
          {contact.phone && <a href={`tel:${contact.phone}`} className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-accent">{contact.phone}</a>}
          {contact.email && <a href={`mailto:${contact.email}`} className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-accent truncate"><span className="truncate">{contact.email}</span></a>}
          {canEdit && (
            <button onClick={() => setEditing(true)} className="text-[10px] text-gray-400 hover:text-accent mt-1">Editar</button>
          )}
        </div>
      ) : canEdit ? (
        <button onClick={() => setEditing(true)} className="text-[11px] text-accent hover:underline">+ Agregar {CONTACT_ROLE_LABELS[role].toLowerCase()}</button>
      ) : (
        <p className="text-[11px] text-gray-300 italic">Sin datos</p>
      )}
    </div>
  )
}

function ContactsSection({ tid, contacts, canEdit, onContactsChange }: {
  tid: string; contacts: TransporterContact[]; canEdit: boolean
  onContactsChange: (contacts: TransporterContact[]) => void
}) {
  const byRole = new Map(contacts.map(c => [c.role, c]))
  function handleSaved(role: TransporterContact['role'], updated: TransporterContact) {
    const next = contacts.filter(c => c.role !== role)
    next.push(updated)
    onContactsChange(next)
  }
  return (
    <div className="bg-white rounded-xl border border-border p-4 md:p-5">
      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Contactos</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {(Object.keys(CONTACT_ROLE_LABELS) as TransporterContact['role'][]).map(role => (
          <ContactCard key={role} tid={tid} role={role} contact={byRole.get(role)} canEdit={canEdit}
            onSaved={updated => handleSaved(role, updated)} />
        ))}
      </div>
    </div>
  )
}
```
Nota: se retira el prop `tp` (dead prop, ya flagged en una revisión anterior) — el call site pasa `tid`/`contacts`/`canEdit`/`onContactsChange` explícitos.

- [ ] **Step 3: Call site**

```tsx
<ContactsSection
  tid={tp.id}
  contacts={tp.contacts}
  canEdit={canEdit}
  onContactsChange={contacts => setTp(prev => prev ? { ...prev, contacts } : prev)}
/>
```

- [ ] **Step 4: `npx tsc --noEmit`, `npx vitest run`, confirmar limpio/verde. Verificar manualmente**: agregar/editar un contacto en una empresa de prueba real, confirmar persistencia recargando la página.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/lib/api/transporters.ts monitor-app/frontend/app/dashboard/transportistas/empresa/\[id\]/page.tsx
git commit -m "feat(frontend): contactos editables en ficha de empresa"
```

---

### Task 6: `registry_url` en Seguros

**Files:**
- Modify: `monitor-app/frontend/lib/types.ts` (`InsurancePolicy`)
- Modify: `monitor-app/frontend/lib/api/insurance.ts` (`PolicyPatch`)
- Modify: `monitor-app/frontend/components/dashboard/InsurancePolicyModal.tsx` (nueva sección "Enlaces", editable)

**Interfaces:**
- Consumes: `PATCH /insurance/policies/{pid}` con `registry_url` (Checkpoint B Task 9).

- [ ] **Step 1: Tipos** — `InsurancePolicy` (línea 566-585) agrega `registry_url: string | null`. `PolicyPatch` (`lib/api/insurance.ts:23-27`) agrega `registry_url?: string`.

- [ ] **Step 2: `InsurancePolicyModal.tsx` — sección "Enlaces" editable**

Insertar después del bloque de header de la póliza (después de la línea ~240, antes de "Próxima cuota"), mismo patrón inline-edit que `TransporterDocumentsPanel`'s "Pegar link" (un input por URL, guardado individual):
```tsx
{(canEdit || selectedPolicy.payment_url || selectedPolicy.file_url || selectedPolicy.registry_url) && (
  <div className="mb-5 space-y-1.5">
    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Enlaces</p>
    <PolicyLinkRow label="Pago" field="payment_url" value={selectedPolicy.payment_url} policyId={selectedPolicy.id} canEdit={canEdit} onSaved={handlePolicyLinkSaved} />
    <PolicyLinkRow label="Documento" field="file_url" value={selectedPolicy.file_url} policyId={selectedPolicy.id} canEdit={canEdit} onSaved={handlePolicyLinkSaved} />
    <PolicyLinkRow label="Registro" field="registry_url" value={selectedPolicy.registry_url} policyId={selectedPolicy.id} canEdit={canEdit} onSaved={handlePolicyLinkSaved} />
  </div>
)}
```
Componente `PolicyLinkRow` (nuevo, mismo archivo o extraído a `components/dashboard/PolicyLinkRow.tsx` si se prefiere separar — decisión del implementador, el resto del archivo ya mezcla componentes chicos inline como `initialsOf`):
```tsx
function PolicyLinkRow({ label, field, value, policyId, canEdit, onSaved }: {
  label: string; field: 'payment_url' | 'file_url' | 'registry_url'; value: string | null
  policyId: string; canEdit: boolean; onSaved: (pid: string, patch: Partial<InsurancePolicy>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const res = await insuranceApi.patchPolicy(policyId, { [field]: draft })
      onSaved(policyId, { [field]: res[field] })
      setEditing(false)
    } finally { setBusy(false) }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-gray-400 w-16 shrink-0">{label}</span>
        <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="https://…" autoFocus
          className="flex-1 min-w-0 text-[11px] border border-border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent/30" />
        <button onClick={save} disabled={busy} className="p-1 rounded bg-accent text-white disabled:opacity-50">
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
        </button>
        <button onClick={() => setEditing(false)} className="p-1 rounded text-gray-400 hover:text-gray-600"><X size={11} /></button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-gray-400 w-16 shrink-0">{label}</span>
      {value ? (
        <a href={value} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:underline truncate flex-1 min-w-0">{value}</a>
      ) : (
        <span className="text-[11px] text-gray-300 italic flex-1">Sin datos</span>
      )}
      {canEdit && <button onClick={() => setEditing(true)} className="text-[10px] text-gray-400 hover:text-accent shrink-0">Editar</button>}
    </div>
  )
}
```
`handlePolicyLinkSaved` en el componente padre — mismo patrón que `handleInstallmentChanged` ya existente en este archivo (invalida/actualiza el cache de react-query de `['insurance', ...]` para esa póliza).

- [ ] **Step 3: `npx tsc --noEmit`, `npx vitest run`, confirmar limpio/verde. Verificar manualmente**: editar los 3 links en una póliza de prueba real, confirmar persistencia.

- [ ] **Step 4: Commit**

```bash
git add monitor-app/frontend/lib/types.ts monitor-app/frontend/lib/api/insurance.ts monitor-app/frontend/components/dashboard/InsurancePolicyModal.tsx
git commit -m "feat(frontend): campo registry_url + edición inline de los 3 enlaces de póliza"
```

---

### Task 7: Verificación final

- [ ] `npx vitest run` (suite completa) — verde.
- [ ] `npx tsc --noEmit` — limpio.
- [ ] `npm run build` — exitoso.
- [ ] Backend: `cd monitor-app/backend/api && source venv/bin/activate && pytest tests/ -v` — verde (Task 1 de este plan agregó tests nuevos).
- [ ] Smoke visual manual (Playwright si hay sesión disponible, con datos reales de Supabase — mismo patrón que sesiones anteriores del proyecto, revertir cualquier mutación de prueba): tabs Operativa/No operativa cambian el conteo correctamente; dar de baja/reactivar una empresa/conductor/vehículo de prueba y ver el cambio reflejado; agregar un contacto nuevo; editar los 3 links de una póliza; abrir "ver versiones" de un documento con historial real y confirmar que ya no renderiza `undefined`.
- [ ] Actualizar `AGENTLOG.md` con el cierre de Checkpoint C.

---

## Self-Review Notes (para el controller)

- **Task 4 Step 4 tiene una verificación pendiente marcada explícitamente en el propio texto del task** (si `app.transporters.baja_override`/`baja_reason` ya llegan al dict de respuesta de `get_transporter` o no) — el implementador debe resolverla como primer paso de ese task, no asumir. Si falta, es un fix de 2 líneas en el mismo archivo que Task 1 ya toca — coordinar para no duplicar trabajo si Task 1 y Task 4 corren en paralelo (no deberían, dado el orden secuencial de este plan, pero si el controller decide paralelizar, avisar explícitamente).
- Orden de dependencia: Task 1 (backend) y Task 2 (fix del bug activo) van primero y son independientes entre sí — podrían paralelizarse, pero dado el patrón ya usado en Checkpoints A/B (una implementación a la vez, revisor entre cada una), se listan secuenciales. Task 3-6 dependen de tipos correctos (Task 2) pero no entre sí — podrían paralelizarse si se quiere acelerar, mismo criterio.
- Task 4's `BajaReasonModal` es un componente nuevo — antes de crearlo, el implementador debe buscar si ya existe un patrón de "modal de confirmación con motivo" en el proyecto (el texto del task ya lo señala) para no duplicar un componente que ya exista con otro nombre.
