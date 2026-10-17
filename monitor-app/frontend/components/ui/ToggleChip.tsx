import type { ReactNode } from 'react'

/** El tono de un chip cuando el color no es del sistema sino de quien lo eligió (los
 *  grupos del Monitor, `lib/ui/groupColors.ts`). */
export type ToggleChipTone = { on: string; off: string }

const SYSTEM_TONE: ToggleChipTone = {
  on: 'border-accion bg-accion/5 font-semibold text-accion',
  off: 'border-border bg-white text-informativo hover:text-text-primary',
}

/** Un filtro que se enciende y se apaga (Fuente, Tipo de carga, Origen…). `aria-pressed`
 *  y no `aria-selected`: es un interruptor, no una pestaña. Había tres maneras de pintar
 *  el encendido en el mismo panel de filtros; el aspecto sale de aquí. */
export function ToggleChip({ pressed, onClick, tone = SYSTEM_TONE, children, title }: {
  pressed: boolean
  onClick: () => void
  tone?: ToggleChipTone
  children: ReactNode
  title?: string
}) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} title={title}
      className={`rounded-full border px-2.5 py-1 text-etiqueta transition-colors
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${pressed ? tone.on : tone.off}`}>
      {children}
    </button>
  )
}
