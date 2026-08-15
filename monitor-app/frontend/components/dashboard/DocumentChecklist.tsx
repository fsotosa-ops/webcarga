'use client'

import { useState } from 'react'
import { Check, Circle, AlertTriangle, Upload, Eye } from 'lucide-react'
import { COMPLIANCE_STATUS_CONFIG, expiryRelative, formatExpiry } from '@/lib/compliance'
import { DocumentPreviewModal } from './DocumentPreviewModal'
import type { ComplianceStatus } from '@/lib/types'

/** Fila del checklist — mapea 1:1 contra un public.compliance_records real
 *  (ver lib/utils/complianceChecklist.ts), no un catálogo hardcodeado. */
export type ChecklistItem = {
  id:                string  // compliance_records.id — llave para las acciones
  /** El requisito que cubre. Necesario para cargar contra el correcto. */
  requirement_id:    string
  requirement_code:  string
  label:             string  // compliance_requirements.name
  status:            ComplianceStatus
  requires_file:     boolean
  expiration_date:   string | null
  is_expired:        boolean
  is_expiring_soon:  boolean
  file_url:          string | null
}

interface Props {
  items:               ChecklistItem[]
  canEdit:             boolean
  onUpload?:           (recordId: string, file: File) => void
  onStatusChange?:     (recordId: string, status: ComplianceStatus) => void
  onExpirationChange?: (recordId: string, expirationDate: string) => void
  onDelete?:           (recordId: string) => Promise<void>
  hideCounter?:        boolean
}

/** PENDING_REVIEW excluido a propósito, mismo criterio que
 *  TransporterDocumentsPanel: no existe un proceso de due diligence
 *  separado del negocio hoy — subir un documento ya lo aprueba
 *  (decisión explícita del usuario 2026-07-18). */
const STATUS_OPTIONS: { value: ComplianceStatus; label: string }[] =
  (Object.entries(COMPLIANCE_STATUS_CONFIG) as [ComplianceStatus, { label: string }][])
    .filter(([value]) => value !== 'PENDING_REVIEW')
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

function ChecklistRow({ item, canEdit, onUpload, onStatusChange, onExpirationChange, onDelete }: {
  item: ChecklistItem
  canEdit: boolean
  onUpload?: (recordId: string, file: File) => void
  onStatusChange?: (recordId: string, status: ComplianceStatus) => void
  onExpirationChange?: (recordId: string, expirationDate: string) => void
  onDelete?: (recordId: string) => Promise<void>
}) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const state = nodeState(item)
  const iconCls = state === 'ok'
    ? 'bg-green-500 border-green-500 text-white'
    : state === 'overdue'
      ? 'bg-red-500 border-red-500 text-white'
      : 'bg-white border-amber-400 text-amber-500'
  const relative = expiryRelative(item.expiration_date, item.is_expired)

  return (
    <div
      title={`${item.label} — ${stateLabel(state)}`}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-gray-50"
    >
      <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${iconCls}`}>
        {state === 'ok' ? <Check size={11} /> : state === 'overdue' ? <AlertTriangle size={10} /> : <Circle size={10} />}
      </span>
      <div className="flex-1 min-w-0">
        <span className="text-xs font-semibold text-text-primary truncate block">{item.label}</span>
        {(item.expiration_date || (canEdit && onExpirationChange)) && (
          <div className="flex items-center gap-1.5 mt-0.5">
            {item.expiration_date && (
              <span className="text-[10px] text-gray-400">
                Vence: <span className="font-mono text-gray-500">{formatExpiry(item.expiration_date)}</span>
              </span>
            )}
            {relative && (
              <span className={`text-[10px] ${item.is_expired ? 'text-red-500 font-semibold' : item.is_expiring_soon ? 'text-amber-600 font-semibold' : 'text-gray-400'}`}>
                ({relative})
              </span>
            )}
            {canEdit && onExpirationChange && (
              <input
                type="date"
                aria-label={`Fecha de vencimiento de ${item.label}`}
                value={item.expiration_date ?? ''}
                onChange={e => onExpirationChange(item.id, e.target.value)}
                className="text-[10px] text-gray-500 border border-border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-accent/30 bg-white"
              />
            )}
          </div>
        )}
      </div>
      {item.file_url && (
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          aria-label={`Ver ${item.label}`}
          title="Ver documento"
          className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-accent hover:underline shrink-0"
        >
          <Eye size={12} /> Ver
        </button>
      )}
      {/* Estado "Falta" con carga habilitada: CTA visible en vez de un
         link chico — cargar debe ser la acción obvia (pedido explícito
         del usuario 2026-07-18). */}
      {canEdit && item.requires_file && !item.file_url && onUpload && (
        <label className="flex items-center gap-1 text-[11px] font-semibold text-accent border border-dashed border-accent/40 rounded-md px-2 py-1 hover:bg-accent/5 transition-colors cursor-pointer shrink-0">
          <Upload size={11} /> Subir documento
          <input
            type="file"
            className="hidden"
            aria-label={`Subir ${item.label}`}
            onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(item.id, f) }}
          />
        </label>
      )}
      {canEdit && item.requires_file && item.file_url && onUpload && (
        <label
          title="Reemplazar archivo"
          className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 hover:text-accent cursor-pointer shrink-0"
        >
          <Upload size={11} />
          <input
            type="file"
            className="hidden"
            aria-label={`Reemplazar ${item.label}`}
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

      {previewOpen && item.file_url && (
        <DocumentPreviewModal
          label={item.label}
          url={item.file_url}
          canEdit={canEdit}
          onClose={() => setPreviewOpen(false)}
          onDelete={canEdit && onDelete ? () => onDelete(item.id) : undefined}
        />
      )}
    </div>
  )
}

/** Checklist de documentos — lista vertical de filas (icono + nombre +
 *  acción). Genérico: data-driven desde compliance_records, no un catálogo
 *  hardcodeado por módulo. La acción por fila se decide por
 *  `item.requires_file` (subir archivo vs. cambiar estado a mano) — no por
 *  cuál callback pasó el llamador, porque un mismo carrier/driver/asset
 *  mezcla requisitos con y sin archivo en el mismo checklist. */
export function DocumentChecklist({ items, canEdit, onUpload, onStatusChange, onExpirationChange, onDelete, hideCounter }: Props) {
  const { ok: okCount } = checklistCompletion(items)

  return (
    <div>
      {items.length > 0 && !hideCounter && (
        <p className="text-xs text-gray-400 mb-2">{okCount} de {items.length} completos</p>
      )}
      <div className="flex flex-col gap-1.5">
        {items.map(item => (
          <ChecklistRow
            key={item.id}
            item={item}
            canEdit={canEdit}
            onUpload={onUpload}
            onStatusChange={onStatusChange}
            onExpirationChange={onExpirationChange}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  )
}
