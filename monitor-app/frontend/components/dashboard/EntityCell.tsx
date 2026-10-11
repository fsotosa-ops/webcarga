import type { EntityKind } from '@/lib/api/entitySummary'
import type { QuickViewTarget } from '@/lib/quickView'

const NOUN: Record<EntityKind, string> = { carrier: 'empresa', driver: 'conductor', asset: 'equipo' }

interface EntityCellProps {
  kind:  EntityKind
  /** El id en el directorio; null si lo que se ve no cruzó con él. */
  id:    string | null | undefined
  label: string | null | undefined
  /** Abre la vista rápida. Sin él (sin `directory.read`), la celda es texto. */
  onOpen?: (target: QuickViewTarget) => void
  /** Lo que se ve viene del TMS sin cruzar con el directorio: se dice. */
  unresolved?: boolean
  /** Qué mostrar cuando no hay dato. */
  empty?: string
  mono?: boolean
}

/** La celda de una empresa, un conductor o un equipo en una tabla del Cierre: azul y
 *  clicable solo si está en el directorio (HU 20261011/01). Una sola definición para
 *  Flota del día y Viajes. */
export function EntityCell({ kind, id, label, onOpen, unresolved = false, empty = '—', mono = false }: EntityCellProps) {
  const font = mono ? 'font-identificador tabular-nums' : ''
  if (!label) return <span className="text-informativo">{empty}</span>
  if (id && onOpen) {
    return (
      <button type="button" onClick={() => onOpen({ kind, id, label })} aria-label={`Ver ${NOUN[kind]} ${label}`}
              className={`text-left text-accion underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded ${font}`}>
        {label}
      </button>
    )
  }
  return (
    <span className={font}>
      {label}
      {unresolved && !id && <span className="block text-etiqueta text-informativo">no está en el directorio</span>}
    </span>
  )
}
