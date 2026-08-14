'use client'

import { useState } from 'react'
import { Trash2, X } from 'lucide-react'
import { MoveToCarrierBar } from './MoveToCarrierBar'

interface Props {
  selectedCount:    number
  targetIds:        string[]
  /** null = la selección cruza empresas; mover exige un origen único. */
  currentCarrierId: string | null
  onDiscard:        () => void
  onClear:          () => void
  onMoved:          () => void
}

/** Barra contextual: aparece al seleccionar y dice cuántos son.
 *
 *  Es el estándar de Gmail, Linear, Airtable y Salesforce Lightning, y es
 *  donde viven mover y descartar — antes escondidos en el panel derecho. */
export function TriageBulkBar({
  selectedCount, targetIds, currentCarrierId, onDiscard, onClear, onMoved,
}: Props) {
  const [confirming, setConfirming] = useState(false)

  if (!selectedCount) return null

  return (
    <div className="flex items-center gap-3 flex-wrap bg-accent text-white rounded-lg px-3 py-2">
      <span className="text-xs font-bold bg-white/20 rounded px-2 py-0.5">
        {selectedCount} seleccionados
      </span>

      {currentCarrierId && !confirming && (
        <MoveToCarrierBar
          targetIds={targetIds}
          currentCarrierId={currentCarrierId}
          onMoved={onMoved}
        />
      )}

      {/* Descartar borra el blob de staging: no hay nada que restaurar
          después. Por eso confirma — pero en la barra, no en un modal, que es
          lo que haría insoportable vaciar una bandeja de dos mil. */}
      {confirming ? (
        <>
          <span className="text-[11px]">Se borran definitivamente</span>
          <button
            type="button"
            onClick={() => { setConfirming(false); onDiscard() }}
            className="text-[11px] font-bold bg-white text-accent rounded px-2 py-0.5"
          >
            Sí, descartar {selectedCount}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-[11px] font-semibold opacity-75 hover:opacity-100 transition-opacity"
          >
            Cancelar
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="flex items-center gap-1.5 text-[11px] font-semibold hover:opacity-80 transition-opacity"
        >
          <Trash2 size={12} /> Descartar
        </button>
      )}

      <button
        type="button"
        onClick={onClear}
        className="flex items-center gap-1.5 text-[11px] font-semibold ml-auto opacity-75 hover:opacity-100 transition-opacity"
      >
        <X size={12} /> Deseleccionar
      </button>
    </div>
  )
}
