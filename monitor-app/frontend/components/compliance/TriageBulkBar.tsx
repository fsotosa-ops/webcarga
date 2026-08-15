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

  // Barra siempre presente: si solo apareciera al seleccionar, la persona no
  // sabria que existe hasta descubrirla por accidente. En reposo enseña como
  // marcar; con seleccion, actua.
  if (!selectedCount) {
    return (
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[11px] text-gray-500">
        <span className="font-medium text-gray-400">Ninguno seleccionado</span>
        <span className="text-gray-300" aria-hidden="true">·</span>
        <span>
          marcá con la casilla o la barra espaciadora para clasificar, mover o descartar en lote
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4 flex-wrap bg-slate-800 text-white px-3 py-2 shadow-sm">
      <span className="text-[11px] font-semibold tabular-nums">
        {selectedCount === 1 ? '1 seleccionado' : `${selectedCount} seleccionados`}
      </span>
      <span className="h-3.5 w-px bg-white/20" aria-hidden="true" />

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
          <span className="text-[11px] text-amber-200">Se borran definitivamente</span>
          <button
            type="button"
            onClick={() => { setConfirming(false); onDiscard() }}
            className="text-[11px] font-bold bg-red-500 hover:bg-red-400 text-white rounded px-2 py-1 transition-colors focus:outline-none focus:ring-2 focus:ring-red-300"
          >
            Sí, descartar {selectedCount}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-[11px] font-semibold text-white/60 hover:text-white transition-colors"
          >
            Cancelar
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-white/80 hover:text-white transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/40 rounded px-1"
        >
          <Trash2 size={12} /> Descartar
        </button>
      )}

      <button
        type="button"
        onClick={onClear}
        aria-label="Deseleccionar"
        title="Deseleccionar"
        className="ml-auto shrink-0 p-1 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/40"
      >
        <X size={13} />
      </button>
    </div>
  )
}
