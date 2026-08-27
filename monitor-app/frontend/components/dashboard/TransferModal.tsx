'use client'

import { useState } from 'react'
import { X, Loader2, ArrowRightLeft, Building2 } from 'lucide-react'
import { CarrierSearchPicker } from '@/components/dashboard/CarrierSearchPicker'

interface Props {
  open:             boolean
  title:            string
  /** La empresa actual, para no ofrecerla como destino. **Null cuando el
   *  conductor o el vehículo no tiene ninguna**: ese es el caso de "asignar",
   *  y es una variante de este mismo modal, no un modal hermano. */
  currentCarrierId: string | null
  onClose:          () => void
  onTransfer:       (toCarrierId: string) => Promise<void>
}

/** Mini-modal de transferencia (conductor/vehículo → otra empresa) — rol
 *  editor. Busca sobre carriersApi.list; el llamador orquesta la asignación
 *  real (assignDriver/assignAsset a la empresa nueva ya desactiva la
 *  asignación ACTIVE previa, ver H2.2 carriers.py — no hace falta un
 *  endpoint .../transfer dedicado).
 *
 *  **Con `currentCarrierId` en null hace la primera asignación** (2026-08-27).
 *  Es el bug crítico #5 de la minuta del 25/08: un conductor o una patente sin
 *  empresa no se podía vincular desde ninguna vista, y al 27/08 eso dejaba 8
 *  conductores con 278 viajes y 7 patentes con 82 viajes invisibles para el
 *  cierre del día. El endpoint siempre estuvo (`POST /carriers/{id}/drivers`);
 *  faltaba la puerta. Cambian la palabra y el ícono, no el mecanismo: una
 *  variante es una prop, no un componente hermano. */
export function TransferModal({ open, title, currentCarrierId, onClose, onTransfer }: Props) {
  // Sin empresa previa no hay "desde": es un alta de vínculo, y decirle
  // "transferencia" a eso le miente a quien aprieta el botón.
  const esPrimeraAsignacion = !currentCarrierId
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
    // Mismo criterio que ConfirmarBaja: mientras el pedido viaja, ni el
    // fondo ni la X cierran — cerrarlo desmontaría el modal, el `catch` de
    // `handleConfirm` escribiría `setErr` sobre un componente muerto y el
    // mensaje (por ejemplo el 409 de una asignación protegida) no se vería.
    if (submitting) return
    setQ(''); setSelectedId(null); setErr(null)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={handleClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-4 py-3 bg-slate-900 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            {esPrimeraAsignacion ? <Building2 size={14} /> : <ArrowRightLeft size={14} />} {title}
          </h3>
          <button onClick={handleClose} aria-label="Cerrar" className="text-white/50 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <CarrierSearchPicker
            query={q}
            onQueryChange={v => { setQ(v); setSelectedId(null) }}
            onPick={c => setSelectedId(c.id)}
            placeholder={esPrimeraAsignacion
              ? 'Buscar la empresa a la que pertenece (nombre o RUT)…'
              : 'Buscar empresa destino (nombre o tax_id)…'}
            excludeId={currentCarrierId ?? undefined}
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
              {submitting
                ? <Loader2 size={13} className="animate-spin" />
                : esPrimeraAsignacion ? 'Asignar a esta empresa' : 'Confirmar transferencia'}
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
