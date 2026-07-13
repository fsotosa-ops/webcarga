'use client'

import { useState } from 'react'
import { X, Loader2, Ban } from 'lucide-react'
import type { BajaBody } from '@/lib/api/transporters'

const REASON_LABELS: Record<BajaBody['reason'], string> = {
  documentacion_vencida: 'Documentación vencida',
  termino_mutuo_acuerdo: 'Término de contrato — mutuo acuerdo',
  termino_penalizacion:  'Término de contrato — penalización',
  otro:                  'Otro',
}

interface Props {
  label:     string
  onClose:   () => void
  onConfirm: (body: BajaBody) => Promise<void>
}

/** Mini-modal de confirmación de baja (empresa/conductor/vehículo) — rol
 *  admin. Mismo lenguaje visual y estructura de overlay que TransferModal
 *  (header oscuro + cuerpo + fila de acciones), adaptado a un formulario
 *  de 2 campos: motivo + notas. */
export function BajaReasonModal({ label, onClose, onConfirm }: Props) {
  const [reason, setReason]   = useState<BajaBody['reason']>('documentacion_vencida')
  const [notes, setNotes]     = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr]         = useState<string | null>(null)

  async function handleConfirm() {
    setSubmitting(true); setErr(null)
    try {
      await onConfirm({ reason, notes: notes || undefined })
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al dar de baja')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="px-4 py-3 bg-slate-900 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Ban size={14} /> Dar de baja: {label}
          </h3>
          <button onClick={onClose} aria-label="Cerrar" className="text-white/50 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="text-[10px] text-gray-400 block mb-1">Motivo</label>
            <select
              value={reason}
              onChange={e => setReason(e.target.value as BajaBody['reason'])}
              className="w-full text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              {(Object.keys(REASON_LABELS) as BajaBody['reason'][]).map(r => (
                <option key={r} value={r}>{REASON_LABELS[r]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-400 block mb-1">Notas (opcional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>

          {err && <p className="text-xs text-red-500">{err}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 disabled:opacity-50"
            >
              {submitting ? <Loader2 size={13} className="animate-spin" /> : 'Confirmar baja'}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-2 rounded-lg border border-border text-xs text-gray-500 hover:bg-gray-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
