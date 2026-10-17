import { useId, type ReactNode } from 'react'

const BASE =
  'rounded-md border bg-white text-text-primary transition-colors placeholder:text-informativo/70 ' +
  'focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-bg-main disabled:text-informativo'

const TONE = {
  normal: 'border-border focus:border-accent/40 focus:ring-accent/20',
  invalid: 'border-status-incidente focus:border-status-incidente focus:ring-status-incidente/20',
} as const

const SIZE = {
  /** Un formulario: nuevo viaje, la ficha de una empresa. */
  md: 'px-3 py-2 text-dato',
  /** Una barra o un panel de filtros. */
  sm: 'px-2.5 py-1.5 text-dato',
  /** Dentro de una celda o una fila que se edita en el lugar. */
  xs: 'px-2 py-1 text-etiqueta',
} as const

export type FieldSize = keyof typeof SIZE

/** Las clases de un campo del kit (`input`, `select`, `textarea`). Había más de veinte
 *  maneras de escribirlo (17/10), cada una con su borde, su anillo de foco y su gris de
 *  placeholder. El ancho, el ícono (`pl-8`) y el margen los pone quien lo usa. */
export function inputClass({ size = 'md', invalid = false }: { size?: FieldSize; invalid?: boolean } = {}): string {
  return `${BASE} ${TONE[invalid ? 'invalid' : 'normal']} ${SIZE[size]}`
}

/** El nombre de un campo cuando no va dentro de `Field` (una etiqueta de grupo de opciones). */
export const FIELD_LABEL = 'block text-etiqueta font-semibold text-informativo'

/** Etiqueta + campo + ayuda + error, enlazados: la etiqueta nombra el campo y la ayuda y
 *  el error lo describen. El campo lo pone quien lo usa (texto, selector, fecha, un
 *  buscador del kit), recibiendo el `id` y el `aria-describedby` que le tocan. */
export function Field({ label, required, hint, error, className, children }: {
  label: ReactNode
  required?: boolean
  hint?: ReactNode
  error?: ReactNode
  className?: string
  children: (id: string, describedBy: string | undefined) => ReactNode
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
  return (
    <div className={className}>
      <label htmlFor={id} className={`${FIELD_LABEL} mb-1.5`}>
        {label}
        {required && <span aria-hidden="true" className="ml-0.5 text-status-incidente">*</span>}
      </label>
      {children(id, describedBy)}
      {hint && <p id={hintId} className="mt-1 text-etiqueta text-informativo">{hint}</p>}
      {error && <p id={errorId} role="alert" className="mt-1 text-etiqueta text-status-incidente">{error}</p>}
    </div>
  )
}
