import type { DocumentState, StateCounts } from '@/lib/states'
import { documentStateStyle } from '@/lib/states'
import { StatusChip } from './StatusChip'

const ORDEN: { key: keyof StateCounts; state: DocumentState }[] = [
  { key: 'overdue', state: 'OVERDUE' },
  { key: 'expiring', state: 'EXPIRING' },
  { key: 'missing', state: 'MISSING' },
]

/** Las tres cifras de lo que se debe —vencido, por vencer, falta— como las
 *  pastillas teñidas de Pendientes: una sola forma de dibujarlas en toda la app
 *  (kit de la Entrega 1 de fichas, 15/10). Acá no se decide ningún estado: para
 *  una empresa, `totalCounts` suma lo propio y su flota. `muted`: en gris, para
 *  quien no está activo. */
export function ComplianceCounts({ counts, muted = false }: { counts: StateCounts; muted?: boolean }) {
  return (
    <span className="inline-flex shrink-0 gap-1 tabular-nums">
      {ORDEN.map(({ key, state }) => {
        const { label, tone } = documentStateStyle(state)
        return (
          <span key={key} data-testid={`counts-${key}`} title={label} className="inline-flex">
            <StatusChip tone={muted ? 'neutral' : tone}>
              <span className="sr-only">{label}: </span>{counts[key]}
            </StatusChip>
          </span>
        )
      })}
    </span>
  )
}
