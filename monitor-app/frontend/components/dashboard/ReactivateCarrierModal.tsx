'use client'

import { useState } from 'react'
import { X, Loader2, RotateCcw } from 'lucide-react'

type FleetItem = { id: string; label: string }

interface Props {
  label:     string
  drivers:   FleetItem[]
  assets:    FleetItem[]
  onClose:   () => void
  onConfirm: (body: { driver_ids: string[]; asset_ids: string[] }) => Promise<void>
}

/** Reactivar una empresa eligiendo qué flota vuelve (D2, P3). Todo viene marcado:
 *  lo que se desmarca sale del roster hoy y queda en el historial. La empresa
 *  vuelve "No habilitada" hasta regularizar sus documentos: eso se calcula. */
export function ReactivateCarrierModal({ label, drivers, assets, onClose, onConfirm }: Props) {
  const [kept, setKept] = useState<Set<string>>(() => new Set([...drivers, ...assets].map(i => i.id)))
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function toggle(id: string) {
    setKept(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleConfirm() {
    setSubmitting(true); setErr(null)
    try {
      await onConfirm({
        driver_ids: drivers.filter(d => kept.has(d.id)).map(d => d.id),
        asset_ids:  assets.filter(a => kept.has(a.id)).map(a => a.id),
      })
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al reactivar')
    } finally {
      setSubmitting(false)
    }
  }

  function handleClose() {
    if (submitting) return
    onClose()
  }

  const group = (title: string, items: FleetItem[]) => (
    <fieldset className="space-y-1">
      <legend className="text-xs font-semibold text-text-primary mb-1">{title}</legend>
      {items.length === 0 && <p className="text-xs text-informativo">Sin {title.toLowerCase()} en su roster.</p>}
      {items.map(i => (
        <label key={i.id} className="flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={kept.has(i.id)} onChange={() => toggle(i.id)} />
          {i.label}
        </label>
      ))}
    </fieldset>
  )

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={handleClose} />
      <div role="dialog" aria-modal="true" className="relative bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-4 py-3 bg-sidebar flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <RotateCcw size={14} /> Reactivar: {label}
          </h3>
          <button onClick={handleClose} aria-label="Cerrar" className="text-white/50 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <p className="text-sm text-informativo">
            Elige qué conductores y equipos vuelven con la empresa. Los que desmarques salen de su roster hoy.
            La empresa queda No habilitada hasta que regularice sus documentos.
          </p>
          {group('Conductores', drivers)}
          {group('Equipos', assets)}

          {err && <p className="text-xs text-status-incidente">{err}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 disabled:opacity-50"
            >
              {submitting ? <Loader2 size={13} className="animate-spin" /> : 'Reactivar'}
            </button>
            <button
              onClick={handleClose}
              className="px-3 py-2 rounded-lg border border-border text-xs text-informativo hover:bg-bg-main"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
