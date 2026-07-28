'use client'

import { MessageCircleWarning } from 'lucide-react'

/** Aparece solo cuando un viaje tiene una alerta activa (late_arrival/
 *  dwell/stale/temp_out) sin ninguna nota humana en la bitácora desde que
 *  empezó — ver needsBitacoraFollowup en lib/utils/kpis.ts. A propósito NO
 *  hereda el color de la alerta que lo disparó: representa un concepto
 *  distinto ("nadie dejó nota todavía"), no una alerta específica, y no hay
 *  un orden de severidad definido entre las 4 que puedan dispararlo. Se
 *  oculta por completo cuando show=false — nunca un estado neutro visible,
 *  mismo criterio que ya usa PendingDocsBadge para no saturar la tabla. */
interface Props {
  show:     boolean
  onClick:  (e: React.MouseEvent) => void
  compact?: boolean
}

export function BitacoraFollowupBadge({ show, onClick, compact = false }: Props) {
  if (!show) return null
  const title = 'Hay una alerta activa sin seguimiento en la bitácora — click para abrir'

  if (compact) {
    return (
      <button
        type="button"
        title={title}
        onClick={onClick}
        className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-amber-50 text-amber-600 shrink-0 hover:bg-amber-100"
      >
        <MessageCircleWarning size={9} />
      </button>
    )
  }

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap bg-amber-50 text-amber-600 hover:bg-amber-100"
    >
      <MessageCircleWarning size={9} /> Sin seguimiento
    </button>
  )
}
