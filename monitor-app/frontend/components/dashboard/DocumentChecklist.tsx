'use client'

import { Check, Circle, AlertTriangle, Upload } from 'lucide-react'
import { COMPLIANCE_STATUS_CONFIG } from '@/lib/compliance'
import type { ComplianceStatus } from '@/lib/types'

/** Fila del checklist — mapea 1:1 contra un public.compliance_records real
 *  (ver lib/utils/complianceChecklist.ts), no un catálogo hardcodeado. */
export type ChecklistItem = {
  id:                string  // compliance_records.id — llave para las acciones
  requirement_code:  string
  label:             string  // compliance_requirements.name
  status:            ComplianceStatus
  requires_file:     boolean
  expiration_date:   string | null
  is_expired:        boolean
  is_expiring_soon:  boolean
}

interface Props {
  items:           ChecklistItem[]
  canEdit:         boolean
  onUpload?:       (recordId: string, file: File) => void
  onStatusChange?: (recordId: string, status: ComplianceStatus) => void
  hideCounter?:    boolean
}

const STATUS_OPTIONS: { value: ComplianceStatus; label: string }[] =
  (Object.entries(COMPLIANCE_STATUS_CONFIG) as [ComplianceStatus, { label: string }][])
    .map(([value, cfg]) => ({ value, label: cfg.label }))

function nodeState(item: ChecklistItem): 'ok' | 'overdue' | 'pending' {
  const approved = item.status === 'APPROVED' || item.status === 'APPROVED_MANUAL'
  if (approved) return item.is_expired ? 'overdue' : 'ok'
  if (item.status === 'EXPIRED' || item.status === 'REJECTED') return 'overdue'
  return 'pending'
}

function stateLabel(state: 'ok' | 'overdue' | 'pending'): string {
  return state === 'ok' ? 'al día' : state === 'overdue' ? 'vencido' : 'pendiente'
}

/** Cuenta cuántos documentos están "al día" — compartido con quien
 *  necesite mostrar el mismo porcentaje fuera de esta lista (ej. un
 *  anillo de progreso en el panel de detalle). */
export function checklistCompletion(items: ChecklistItem[]): { ok: number; total: number } {
  return { ok: items.filter(item => nodeState(item) === 'ok').length, total: items.length }
}

/** Checklist de documentos — lista vertical de filas (icono + nombre +
 *  acción). Genérico: data-driven desde compliance_records, no un catálogo
 *  hardcodeado por módulo. La acción por fila se decide por
 *  `item.requires_file` (subir archivo vs. cambiar estado a mano) — no por
 *  cuál callback pasó el llamador, porque un mismo carrier/driver/asset
 *  mezcla requisitos con y sin archivo en el mismo checklist. */
export function DocumentChecklist({ items, canEdit, onUpload, onStatusChange, hideCounter }: Props) {
  const { ok: okCount } = checklistCompletion(items)

  return (
    <div>
      {items.length > 0 && !hideCounter && (
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
              key={item.id}
              title={`${item.label} — ${stateLabel(state)}`}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-gray-50"
            >
              <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${iconCls}`}>
                {state === 'ok' ? <Check size={11} /> : state === 'overdue' ? <AlertTriangle size={10} /> : <Circle size={10} />}
              </span>
              <span className="text-xs font-semibold text-text-primary flex-1 truncate">{item.label}</span>
              {canEdit && item.requires_file && onUpload && (
                <label className="flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline cursor-pointer shrink-0">
                  <Upload size={11} /> Subir
                  <input
                    type="file"
                    className="hidden"
                    aria-label={`Subir ${item.label}`}
                    onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(item.id, f) }}
                  />
                </label>
              )}
              {canEdit && !item.requires_file && onStatusChange && (
                <select
                  aria-label={`Estado de ${item.label}`}
                  value={item.status}
                  onChange={e => onStatusChange(item.id, e.target.value as ComplianceStatus)}
                  className="text-[11px] font-semibold border border-border rounded-md px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white shrink-0"
                >
                  {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
