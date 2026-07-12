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
  hideCounter?:    boolean
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

/** Cuenta cuántos documentos están "al día" — compartido con quien
 *  necesite mostrar el mismo porcentaje fuera de esta lista (ej. un
 *  anillo de progreso en el panel de detalle). */
export function checklistCompletion(items: ChecklistItem[]): { ok: number; total: number } {
  return { ok: items.filter(item => nodeState(item) === 'ok').length, total: items.length }
}

/** Checklist de documentos — lista vertical de filas (icono + nombre +
 *  acción). Genérico: no importa nada específico de un módulo. La acción
 *  por fila es una de dos (mutuamente excluyentes en la práctica, cada
 *  llamador pasa una sola): subir archivo (Seguros, documentos con
 *  respaldo de archivo) o cambiar estado (Empresas, campos `governance`
 *  sin archivo — un `<select>` en vez del control de subir). */
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
