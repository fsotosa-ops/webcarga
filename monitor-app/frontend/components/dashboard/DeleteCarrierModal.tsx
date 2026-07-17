'use client'

import { useState } from 'react'
import { X, Loader2, Trash2 } from 'lucide-react'

interface Props {
  label:     string
  onClose:   () => void
  onConfirm: () => Promise<void>
}

/** Confirmación de borrado real de una empresa — a diferencia de
 *  BajaReasonModal (soft, siempre permitido), el backend puede rechazar
 *  esto con 409 si la empresa tiene datos asociados; ese mensaje ya viene
 *  listo para mostrar (ver carriersApi.delete / DELETE /carriers/{id}). */
export function DeleteCarrierModal({ label, onClose, onConfirm }: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr]               = useState<string | null>(null)

  async function handleConfirm() {
    setSubmitting(true); setErr(null)
    try {
      await onConfirm()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al eliminar')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="px-4 py-3 bg-red-600 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Trash2 size={14} /> Eliminar: {label}
          </h3>
          <button onClick={onClose} aria-label="Cerrar" className="text-white/50 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-sm text-gray-500">
            Esto borra la empresa de forma permanente. Solo funciona si no tiene conductores, equipos,
            pólizas, contactos ni documentos cargados — si los tiene, use &quot;Dar de baja&quot; en su lugar.
          </p>

          {err && <p className="text-xs text-red-500">{err}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
            >
              {submitting ? <Loader2 size={13} className="animate-spin" /> : 'Confirmar eliminación'}
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
