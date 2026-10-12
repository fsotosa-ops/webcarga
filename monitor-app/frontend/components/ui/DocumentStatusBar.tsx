import type { ReactNode } from 'react'
import { documentStateCount, documentStateStyle, stateCountsLine, type StateCounts } from '@/lib/states'

/** El estado de un documento en la lista de atención. No es el `DocumentState`
 *  del glosario (que viene en mayúsculas de la API). */
export type AttentionState = 'expired' | 'expiring' | 'missing'

export type DocumentSummary = {
  ok: number
  expiring: number
  expired: number
  missing: number
  attention: { name: string; state: AttentionState; due_on: string | null }[]
}

type Segment = { key: 'ok' | AttentionState; count: number; bar: string; label: (n: number) => string }

// En el orden en que se leen: lo que está bien, y después lo que falta atender.
const SEGMENTS = (d: DocumentSummary, c: StateCounts): Segment[] => [
  { key: 'ok',       count: d.ok,       bar: 'bg-resuelto',         label: n => documentStateCount('UP_TO_DATE', n) },
  { key: 'expiring', count: c.expiring, bar: 'bg-warning',          label: n => documentStateCount('EXPIRING', n) },
  { key: 'expired',  count: c.overdue,  bar: 'bg-status-incidente', label: n => documentStateCount('OVERDUE', n) },
  { key: 'missing',  count: c.missing,  bar: 'bg-informativo',      label: n => documentStateCount('MISSING', n) },
]

/** 2026-10-02 → 02/10, como lo lee el coordinador. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

function dueLabel(state: AttentionState, dueOn: string | null): ReactNode {
  if (state === 'missing') return <span className="text-informativo">{documentStateStyle('MISSING').label}</span>
  const date = dueOn ? ` ${shortDate(dueOn)}` : ''
  return state === 'expired'
    ? <span className="text-status-incidente">{documentStateStyle('OVERDUE').label}{date}</span>
    : <span className="text-warning">Vence{date}</span>
}

/** El estado de la documentación de una entidad: una barra con el peso de cada
 *  estado, la leyenda con sus cantidades (solo las que no son cero) y lo que hay
 *  que atender primero. Sin requisitos lo dice, en vez de dibujar una barra vacía
 *  que se lee como "todo mal".
 *
 *  Las cifras de atención salen de `counts` (el `compliance_summary` de la API,
 *  D-R9); sin él, de los contadores del propio resumen. `fleet` agrega la línea
 *  de la flota activa de una empresa. */
export function DocumentStatusBar({ documents, counts, fleet }: {
  documents: DocumentSummary
  counts?: StateCounts
  fleet?: StateCounts | null
}) {
  const c = counts ?? { overdue: documents.expired, expiring: documents.expiring, missing: documents.missing }
  const segments = SEGMENTS(documents, c).filter(s => s.count > 0)
  const total = segments.reduce((sum, s) => sum + s.count, 0)
  if (total === 0) return <p className="text-dato text-informativo">Sin requisitos configurados</p>

  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-border" aria-hidden="true">
        {segments.map(s => (
          <div key={s.key} data-testid={`segment-${s.key}`} className={s.bar}
               style={{ width: `${(s.count / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-dato text-text-primary">
        {segments.map(s => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${s.bar}`} aria-hidden="true" />
            {s.label(s.count)}
          </li>
        ))}
      </ul>
      {documents.attention.length > 0 && (
        <ul className="mt-3 divide-y divide-border text-dato">
          {documents.attention.map(doc => (
            <li key={`${doc.name}-${doc.state}`} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="min-w-0 truncate text-text-primary" title={doc.name}>{doc.name}</span>
              <span className="shrink-0 font-semibold tabular-nums">{dueLabel(doc.state, doc.due_on)}</span>
            </li>
          ))}
        </ul>
      )}
      {fleet && (
        <p className="mt-2 text-dato text-informativo">Flota activa: {stateCountsLine(fleet) ?? 'sin pendientes'}</p>
      )}
    </div>
  )
}
