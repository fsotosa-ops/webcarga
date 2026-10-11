import type { ReactNode } from 'react'

export type DocumentState = 'expired' | 'expiring' | 'missing'

export type DocumentSummary = {
  ok: number
  expiring: number
  expired: number
  missing: number
  attention: { name: string; state: DocumentState; due_on: string | null }[]
}

type Segment = { key: 'ok' | DocumentState; count: number; bar: string; label: (n: number) => string }

// En el orden en que se leen: lo que está bien, y después lo que falta atender.
const SEGMENTS = (d: DocumentSummary): Segment[] => [
  { key: 'ok',       count: d.ok,       bar: 'bg-resuelto',         label: n => `${n} al día` },
  { key: 'expiring', count: d.expiring, bar: 'bg-warning',          label: n => `${n} por vencer` },
  { key: 'expired',  count: d.expired,  bar: 'bg-status-incidente', label: n => `${n} ${n === 1 ? 'vencido' : 'vencidos'}` },
  { key: 'missing',  count: d.missing,  bar: 'bg-informativo',      label: n => `${n} ${n === 1 ? 'falta' : 'faltan'}` },
]

/** 2026-10-02 → 02/10, como lo lee el coordinador. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

function dueLabel(state: DocumentState, dueOn: string | null): ReactNode {
  if (state === 'missing') return <span className="text-informativo">Falta</span>
  const date = dueOn ? ` ${shortDate(dueOn)}` : ''
  return state === 'expired'
    ? <span className="text-status-incidente">Vencido{date}</span>
    : <span className="text-warning">Vence{date}</span>
}

/** El estado de la documentación de una entidad: una barra con el peso de cada
 *  estado, la leyenda con sus cantidades (solo las que no son cero) y lo que hay
 *  que atender primero. Sin requisitos lo dice, en vez de dibujar una barra vacía
 *  que se lee como "todo mal". */
export function DocumentStatusBar({ documents }: { documents: DocumentSummary }) {
  const segments = SEGMENTS(documents).filter(s => s.count > 0)
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
    </div>
  )
}
