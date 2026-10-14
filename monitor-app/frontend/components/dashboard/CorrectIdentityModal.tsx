'use client'

import { useState } from 'react'
import { X, Loader2, PenLine } from 'lucide-react'

interface Props {
  /** "RUT" o "patente". */
  field:     string
  current:   string | null
  /** Lo que pasa con el valor viejo, dicho antes de confirmar. */
  hint:      string
  onClose:   () => void
  onConfirm: (value: string, reason: string) => Promise<void>
}

/** Corregir el RUT de un conductor o la patente de un equipo (D3, Entrega B): con
 *  motivo obligatorio, que queda en la auditoría. Un duplicado lo rechaza la API con
 *  el nombre de quien ya lo tiene. Una variante por prop, no dos diálogos. */
export function CorrectIdentityModal({ field, current, hint, onClose, onConfirm }: Props) {
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ready = value.trim().length > 0 && reason.trim().length > 0

  async function handleConfirm() {
    setSubmitting(true); setErr(null)
    try {
      await onConfirm(value.trim(), reason.trim())
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo corregir')
    } finally {
      setSubmitting(false)
    }
  }

  function handleClose() {
    if (submitting) return
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={handleClose} />
      <div role="dialog" aria-modal="true" className="relative bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="px-4 py-3 bg-sidebar flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <PenLine size={14} /> Corregir {field}
          </h3>
          <button onClick={handleClose} aria-label="Cerrar" className="text-white/50 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-informativo">
            {field[0].toUpperCase() + field.slice(1)} actual: <span className="font-mono text-text-primary">{current ?? 'sin dato'}</span>. {hint}
          </p>
          <label className="block text-xs font-semibold text-text-primary">
            {field[0].toUpperCase() + field.slice(1)} correcto
            <input value={value} onChange={e => setValue(e.target.value)} autoFocus
                   className="mt-1 w-full rounded-lg border border-border px-3 py-1.5 font-mono text-sm" />
          </label>
          <label className="block text-xs font-semibold text-text-primary">
            Motivo (queda en la auditoría)
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
                      className="mt-1 w-full rounded-lg border border-border px-3 py-1.5 text-sm" />
          </label>
          {err && <p role="alert" className="text-xs text-status-incidente">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={handleConfirm} disabled={!ready || submitting}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 disabled:opacity-50">
              {submitting ? <Loader2 size={13} className="animate-spin" /> : 'Corregir'}
            </button>
            <button onClick={handleClose}
                    className="px-3 py-2 rounded-lg border border-border text-xs text-informativo hover:bg-bg-main">
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
