'use client'

import { Clock } from 'lucide-react'
import type { DwellSeverity } from '@/lib/utils/kpis'

/** Hito 14 (minuta 29/07 §4.4): semáforo de tiempo en el local activo —
 *  reemplaza al badge "Sin seguimiento" + el texto "hace X hrs" (2026-08-01).
 *  Se oculta por completo cuando severity es null (viaje cerrado, sin
 *  parada activa, o la parada activa todavía no llega — "en ruta", no "en
 *  local"), mismo criterio que ya usaba BitacoraFollowupBadge para no
 *  saturar la tabla con un estado neutro visible. El clic conserva el mismo
 *  atajo a Bitácora que tenía "Sin seguimiento" (pedido explícito del
 *  usuario). */
interface Props {
  severity: DwellSeverity | null
  label:    string | null
  onClick:  (e: React.MouseEvent) => void
  compact?: boolean
}

const COLOR_CLS: Record<DwellSeverity, string> = {
  green:  'bg-green-50 text-green-600 hover:bg-green-100',
  yellow: 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100',
  orange: 'bg-orange-50 text-orange-700 hover:bg-orange-100',
  red:    'bg-red-50 text-red-600 hover:bg-red-100',
}

const DOT_CLS: Record<DwellSeverity, string> = {
  green:  'bg-green-500',
  yellow: 'bg-yellow-500',
  orange: 'bg-orange-500',
  red:    'bg-red-500',
}

export function DwellSeverityBadge({ severity, label, onClick, compact = false }: Props) {
  if (!severity) return null
  const title = `${label ?? 'Detenido en local'} — click para abrir la bitácora`

  if (compact) {
    return (
      <button
        type="button"
        title={title}
        onClick={onClick}
        className={`inline-flex items-center justify-center h-4 w-4 rounded-full shrink-0 ${COLOR_CLS[severity]}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${DOT_CLS[severity]}`} />
      </button>
    )
  }

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${COLOR_CLS[severity]}`}
    >
      <Clock size={9} /> {label}
    </button>
  )
}
