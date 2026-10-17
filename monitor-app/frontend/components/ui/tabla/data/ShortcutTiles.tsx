'use client'

import type { DataTableModel } from './useDataTable'

type Tone = 'neutral' | 'resolved' | 'warning' | 'urgent'
const TONO: Record<Tone, string> = {
  neutral: 'text-text-primary', resolved: 'text-resuelto', warning: 'text-warning', urgent: 'text-status-incidente',
}

export type ShortcutTile = {
  /** El o los valores de la columna que el recuadro escribe; `null` = "Todos" (quita el filtro).
   *  Varios valores cuando el recuadro agrupa categorías ("No asignados" = Sin motivo + Trabajando
   *  sin asignación): el chip los nombra con las mismas palabras de la columna. */
  value: string | readonly string[] | null
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
  const marcado = (t: ShortcutTile) => {
    const valores = valuesOf(t)
    return valores.length === elegidos.length && valores.every(v => elegidos.includes(v))
  }

  return (
    // En una fila en escritorio; en un teléfono pasan a la siguiente en vez de cortar
    // la etiqueta ("No trabajand…" a 390 px).
    <div className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-2.5">
      {tiles.map(t => {
        const n = loading ? null
          : t.value === null ? model.facetTotal(columnId)
          : valuesOf(t).reduce((suma, v) => suma + model.facetCount(columnId, v), 0)
        return (
          <button key={t.label} type="button" aria-pressed={marcado(t)}
            aria-label={n === null ? t.label : `${t.label}, ${n}`}
            onClick={() => model.setFilter(columnId, valuesOf(t))}
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

function valuesOf(t: ShortcutTile): string[] {
  return t.value === null ? [] : typeof t.value === 'string' ? [t.value] : [...t.value]
}
