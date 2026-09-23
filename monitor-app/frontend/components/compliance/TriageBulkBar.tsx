'use client'

import { BarraDeSeleccion } from '@/components/ui/BarraDeSeleccion'
import { MoveToCarrierBar } from './MoveToCarrierBar'
import { cuantos } from '@/lib/utils/cuantos'

interface Props {
  selectedCount:    number
  targetIds:        string[]
  /** Empresa de origen de la selección, o `null` si los archivos todavía no
   *  tienen empresa — que es como llega TODO lo que entra por la puerta global.
   *
   *  `null` NO significa "selección ambigua": `handleToggle` (TriageWorkbench)
   *  reemplaza la selección al marcar un archivo de otra empresa, así que la
   *  selección siempre es homogénea. Sólo se usa para no ofrecer como destino
   *  la empresa en la que los archivos ya están. */
  currentCarrierId: string | null
  onDiscard:        () => void
  onClear:          () => void
  onMoved:          (moved: number) => void
}

/** La barra de la bandeja: mover y descartar sobre `BarraDeSeleccion`. */
export function TriageBulkBar({
  selectedCount, targetIds, currentCarrierId, onDiscard, onClear, onMoved,
}: Props) {
  return (
    <BarraDeSeleccion
      seleccionados={selectedCount}
      ayuda="marca con la casilla o la barra espaciadora para mover o descartar en lote"
      onLimpiar={onClear}
      destructiva={{
        // Descartar borra el blob de staging: no hay nada que restaurar después.
        etiqueta:     `Descartar ${cuantos(selectedCount)}`,
        advertencia:  'Se borran definitivamente',
        confirmacion: `Sí, descartar ${selectedCount}`,
        onConfirmar:  onDiscard,
      }}
    >
      {/* Mover se ofrece SIEMPRE que haya selección, tenga empresa o no. Un
          archivo sin empresa es precisamente el que más necesita moverse: es
          como entra todo lo que se suelta en la bandeja global. */}
      <MoveToCarrierBar
        targetIds={targetIds}
        currentCarrierId={currentCarrierId}
        onMoved={onMoved}
      />
    </BarraDeSeleccion>
  )
}
