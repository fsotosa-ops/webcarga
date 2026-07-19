'use client'

import { useState } from 'react'
import { X, Loader2, ArrowRightLeft } from 'lucide-react'
import { CarrierSearchPicker } from '@/components/dashboard/CarrierSearchPicker'

interface Props {
  open:             boolean
  title:            string
  currentCarrierId: string
  onClose:          () => void
  onTransfer:       (toCarrierId: string) => Promise<void>
}

/** Mini-modal de transferencia (conductor/vehículo → otra empresa) — rol
 *  admin. Busca sobre carriersApi.list; el llamador orquesta la asignación
 *  real (assignDriver/assignAsset a la empresa nueva ya desactiva la
 *  asignación ACTIVE previa, ver H2.2 carriers.py — no hace falta un
 *  endpoint .../transfer dedicado). */
export function TransferModal({ open, title, currentCarrierId, onClose, onTransfer }: Props) {
  const [q, setQ]             = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr]         = useState<string | null>(null)

  if (!open) return null

  async function handleConfirm() {
    if (!selectedId) return
    setSubmitting(true); setErr(null)
    try {
      await onTransfer(selectedId)
      handleClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al transferir')
    } finally {
      setSubmitting(false)
    }
  }

  function handleClose() {
    setQ(''); setSelectedId(null); setErr(null)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={handleClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-4 py-3 bg-slate-900 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <ArrowRightLeft size={14} /> {title}
          </h3>
          <button onClick={handleClose} className="text-white/50 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <CarrierSearchPicker
            query={q}
            onQueryChange={v => { setQ(v); setSelectedId(null) }}
            onPick={c => setSelectedId(c.id)}
            placeholder="Buscar empresa destino (nombre o tax_id)…"
            excludeId={currentCarrierId}
            selectedId={selectedId}
            autoFocus
            size="md"
            maxHeightClass="max-h-56"
            showMinCharsHint
          />

          {err && <p className="text-xs text-red-500">{err}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleConfirm}
              disabled={!selectedId || submitting}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 disabled:opacity-50"
            >
              {submitting ? <Loader2 size={13} className="animate-spin" /> : 'Confirmar transferencia'}
            </button>
            <button
              onClick={handleClose}
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
