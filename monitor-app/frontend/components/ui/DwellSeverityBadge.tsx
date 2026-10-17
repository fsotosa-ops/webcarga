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

/** Los cuatro niveles salen de los tres umbrales de Configuración. Verde es "va bien",
 *  no "quedó cerrado": neutro, no `resuelto`. Amarillo y naranjo son dos intensidades
 *  del mismo aviso (`warning`), así siguen siendo distintos sin inventar colores. */
const COLOR_CLS: Record<DwellSeverity, string> = {
  green:  'bg-informativo/10 text-informativo hover:bg-informativo/15',
  yellow: 'bg-warning/10 text-warning hover:bg-warning/15',
  orange: 'bg-warning/20 text-warning hover:bg-warning/25',
  red:    'bg-status-incidente/10 text-status-incidente hover:bg-status-incidente/15',
}

const DOT_CLS: Record<DwellSeverity, string> = {
  green:  'bg-informativo',
  yellow: 'bg-warning/60',
  orange: 'bg-warning',
  red:    'bg-status-incidente',
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
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-etiqueta font-semibold whitespace-nowrap ${COLOR_CLS[severity]}`}
    >
      <Clock size={11} aria-hidden="true" /> {label}
    </button>
  )
}
