'use client'

import type { DataTableModel } from './useDataTable'

type Tone = 'neutral' | 'resolved' | 'warning' | 'urgent'
const TONO: Record<Tone, string> = {
  neutral: 'text-text-primary', resolved: 'text-resuelto', warning: 'text-warning', urgent: 'text-status-incidente',
}

export type ShortcutTile = {
  /** El valor de la columna que el recuadro escribe; `null` = "Todos" (quita el filtro). */
  value: string | null
  label: string
  tone?: Tone
}

/** Recuadros-atajo (spec §4.1, C1 y C3): un recuadro ES un valor del filtro de su
 *  columna. Tocarlo escribe ese valor (y se ve como chip en la barra); el marcado
 *  es el que coincide con el filtro, venga de aquí o del embudo; la cifra es la
 *  facetada. Así un recuadro y la columna no pueden decir cosas distintas. */
export function ShortcutTiles<T>({ model, columnId, tiles, loading = false }: {
  model: DataTableModel<T>
  columnId: string
  tiles: ShortcutTile[]
  /** Sin cifras mientras llegan las filas: un "0" en vuelo miente. */
  loading?: boolean
}) {
  const elegidos = model.view.filters[columnId] ?? []
  const marcado = (t: ShortcutTile) => (t.value === null ? elegidos.length === 0 : elegidos.length === 1 && elegidos[0] === t.value)

  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
      {tiles.map(t => {
        const n = loading ? null : (t.value === null ? model.facetTotal(columnId) : model.facetCount(columnId, t.value))
        return (
          <button key={t.value ?? '__todos'} type="button" aria-pressed={marcado(t)}
            aria-label={n === null ? t.label : `${t.label}, ${n}`}
            onClick={() => model.setFilter(columnId, t.value === null ? [] : [t.value])}
            className={`rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
              marcado(t) ? 'border-accent bg-accent/5 ring-1 ring-accent/20' : 'border-border bg-white hover:bg-bg-main'}`}>
            <p className={`text-xl font-bold leading-none tabular-nums ${TONO[t.tone ?? 'neutral']}`}>
              {n ?? <span className="inline-block h-5 w-8 animate-pulse rounded bg-bg-main align-middle" />}
            </p>
            <p className="mt-1 text-etiqueta text-informativo">{t.label}</p>
          </button>
        )
      })}
    </div>
  )
}
