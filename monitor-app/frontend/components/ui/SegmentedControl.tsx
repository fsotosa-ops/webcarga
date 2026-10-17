import type { LucideIcon } from 'lucide-react'

export type SegmentedOption<T extends string> = {
  id: T
  label: string
  Icon?: LucideIcon
  /** Un número que acompaña a la opción, p. ej. cuántos hay. */
  badge?: string
}

/** El marco del grupo y el aspecto de un segmento, para lo que necesita otra semántica
 *  con el mismo aspecto: el nivel por área de los roles es un `radio` (una opción por
 *  área, algunas bloqueadas con su motivo), no un botón. */
export const SEGMENT_GROUP = 'inline-flex w-fit max-w-full flex-wrap overflow-hidden rounded-md border border-border bg-white'

export function segmentClass({ on, disabled = false }: { on: boolean; disabled?: boolean }): string {
  const tono = on ? 'bg-accion/10 font-semibold text-accion'
    : disabled ? 'cursor-not-allowed text-informativo/60'
    : 'text-informativo hover:text-text-primary'
  return `flex items-center gap-1.5 border-r border-border px-2.5 py-1 text-etiqueta transition-colors last:border-r-0 ${tono}`
}

/** Opciones del mismo grupo, una sola marcada (o ninguna). Lo usan la
 *  Bitácora del viaje (tipo de nota, filtro, Feed/Documentos) y Pendientes
 *  (por documento o empresa; vencidos, por vencer, faltan). */
export function SegmentedControl<T extends string>({
  label, options, value, onChange,
}: {
  label:    string
  options:  SegmentedOption<T>[]
  value:    T | null
  onChange: (id: T) => void
}) {
  return (
    <div role="group" aria-label={label} className={SEGMENT_GROUP}>
      {options.map(o => {
        const on = value === o.id
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            title={o.label}
            aria-pressed={on}
            className={`${segmentClass({ on })} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40`}
          >
            {o.Icon && <o.Icon size={12} aria-hidden />}
            {o.label}
            {o.badge && <span className="tabular-nums">{o.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}
