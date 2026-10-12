import type { ComplianceSummary, DocumentState, StateCounts } from '@/lib/states'
import { documentStateStyle } from '@/lib/states'

const ORDEN: { key: keyof StateCounts; state: DocumentState }[] = [
  { key: 'overdue', state: 'OVERDUE' },
  { key: 'expiring', state: 'EXPIRING' },
  { key: 'missing', state: 'MISSING' },
]

/** Las cifras de quien debe los documentos: lo propio más su flota activa.
 *  Son las mismas que la fila de la empresa en Pendientes (spec §1); acá solo
 *  se suman las dos mitades, no se decide ningún estado. */
export function ComplianceCounts({ summary, muted = false }: { summary: ComplianceSummary; muted?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 text-etiqueta tabular-nums ${muted ? 'text-informativo' : 'text-text-primary'}`}>
      {ORDEN.map(({ key, state }) => {
        const { label, icon: Icon } = documentStateStyle(state)
        const n = summary.own[key] + (summary.fleet?.[key] ?? 0)
        return (
          <span key={key} data-testid={`counts-${key}`} title={label} className="inline-flex items-center gap-1">
            <Icon size={12} aria-hidden="true" />
            <span className="sr-only">{label}: </span>{n}
          </span>
        )
      })}
    </span>
  )
}
