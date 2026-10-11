import type { LucideIcon } from 'lucide-react'

export type SegmentedOption<T extends string> = {
  id: T
  label: string
  Icon?: LucideIcon
  /** Un número que acompaña a la opción, p. ej. cuántos hay. */
  badge?: string
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
    <div role="group" aria-label={label} className="inline-flex w-fit max-w-full flex-wrap overflow-hidden rounded-md border border-border bg-white">
      {options.map(o => {
        const on = value === o.id
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            title={o.label}
            aria-pressed={on}
            className={`flex items-center gap-1.5 border-r border-border px-2.5 py-1 text-etiqueta transition-colors last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${
              on ? 'bg-accion/10 font-semibold text-accion' : 'text-informativo hover:text-text-primary'
            }`}
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
