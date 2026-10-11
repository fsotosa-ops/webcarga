import type { ReactNode } from 'react'

/** Las cinco señales del sistema visual (spec §3.2), con sus tokens. */
export type StatusTone = 'neutral' | 'warning' | 'urgent' | 'resolved' | 'action'

const TONE: Record<StatusTone, string> = {
  neutral:  'bg-informativo/10 text-informativo',
  warning:  'bg-warning/10 text-warning',
  urgent:   'bg-status-incidente/10 text-status-incidente',
  resolved: 'bg-resuelto/10 text-resuelto',
  action:   'bg-accion/10 text-accion',
}

export function StatusChip({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-etiqueta font-semibold ${TONE[tone]}`}>
      {children}
    </span>
  )
}
