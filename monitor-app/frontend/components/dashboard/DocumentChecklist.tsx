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

export function DocumentChecklist({ items, canEdit, onUpload }: Props) {
  return (
    <div className="flex items-start gap-4 flex-wrap">
      {items.map(item => {
        const state = nodeState(item)
        const nodeCls = state === 'ok'
          ? 'bg-green-500 border-green-500 text-white'
          : state === 'overdue'
            ? 'bg-red-500 border-red-500 text-white'
            : 'bg-white border-amber-400 text-amber-500'
        return (
          <div key={item.doc_code} className="flex flex-col items-center gap-1 w-20 shrink-0">
            <div
              title={`${item.label} — ${stateLabel(state)}`}
              className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 ${nodeCls}`}
            >
              {state === 'ok' ? <Check size={13} /> : state === 'overdue' ? <AlertTriangle size={12} /> : <Circle size={12} />}
            </div>
            <span className="text-[10px] text-gray-600 text-center leading-tight">{item.label}</span>
            {canEdit && (
              <label className="flex items-center gap-0.5 text-[9px] font-semibold text-gray-500 hover:text-accent cursor-pointer">
                <Upload size={9} /> Subir
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
  )
}
