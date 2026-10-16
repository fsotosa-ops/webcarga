import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/** Las cinco señales del sistema visual (spec §3.2), con sus tokens. */
export type StatusTone = 'neutral' | 'warning' | 'urgent' | 'resolved' | 'action'

export const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  neutral:  'bg-informativo/10 text-informativo',
  warning:  'bg-warning/10 text-warning',
  urgent:   'bg-status-incidente/10 text-status-incidente',
  resolved: 'bg-resuelto/10 text-resuelto',
  action:   'bg-accion/10 text-accion',
}

/** El punto de color de un tono, para las tablas densas (el Monitor): mismo
 *  significado que la pastilla, con menos peso. */
export const STATUS_TONE_DOT: Record<StatusTone, string> = {
  neutral:  'bg-informativo',
  warning:  'bg-warning',
  urgent:   'bg-status-incidente',
  resolved: 'bg-resuelto',
  action:   'bg-accion',
}

/** Una variante es una prop: el ícono del glosario (`lib/states.ts`) viaja con
 *  el tono, no en un componente hermano. */
export function StatusChip({ tone, icon: Icon, children }: { tone: StatusTone; icon?: LucideIcon; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-etiqueta font-semibold ${STATUS_TONE_CLASS[tone]}`}>
      {Icon && <Icon size={12} aria-hidden="true" />}
      {children}
    </span>
  )
}
