'use client'

import type { DataTableModel } from './useDataTable'

type Tone = 'neutral' | 'resolved' | 'warning' | 'urgent'
const TONO: Record<Tone, string> = {
  neutral: 'text-text-primary', resolved: 'text-resuelto', warning: 'text-warning', urgent: 'text-status-incidente',
}

export type FilterTile = {
  /** La columna que el recuadro filtra; sin ella (con `value: null`) es "Todos". */
  column?: string
  /** El valor que escribe en el filtro de su columna; `null` = "Todos". */
  value: string | null
  label: string
  tone?: Tone
}

/** Un recuadro que no filtra esta tabla: cambia a OTRA lista (en el Cierre, "Por
 *  regularizar" muestra viajes, no filas de la flota). Quien lo aloja lleva si está
 *  activo y su cifra; mientras está activo, los recuadros de filtro no se marcan, y
 *  tocar uno lo apaga (`onFilterTile`). `count` sin dato todavía: no se afirma un cero. */
export type ActionTile = {
  kind: 'action'
  label: string
  tone?: Tone
  count: number | undefined
  active: boolean
  onSelect: () => void
}

export type ShortcutTile = FilterTile | ActionTile

const esAccion = (t: ShortcutTile): t is ActionTile => 'kind' in t && t.kind === 'action'

/** Recuadros que se leen juntos ("Por tipo de motivo"); el nombre es opcional. */
export type ShortcutTileGroup = { label?: string; tiles: ShortcutTile[] }

/** Recuadros-atajo (spec §4.1, C1 y C3): un recuadro ES un valor del filtro de su
 *  columna. Pueden ser de varias columnas (Estado y Tipo de motivo: el estándar de
 *  estado + motivo). Son atajos que se reemplazan: tocar uno escribe su valor y quita el
 *  de las otras columnas de los recuadros, y "Todos" las quita a todas; los demás
 *  filtros quedan. El marcado es el que coincide con el filtro, venga de aquí o del
 *  embudo, y la cifra es lo que se vería al tocarlo. Así un recuadro y su columna no
 *  pueden decir cosas distintas. */
export function ShortcutTiles<T>({ model, groups, onFilterTile }: {
  model: DataTableModel<T>
  groups: ShortcutTileGroup[]
  /** Se llama al tocar un recuadro de filtro: quien aloja apaga su recuadro de acción. */
  onFilterTile?: () => void
}) {
  const filtrosDeRecuadro = groups.flatMap(g => g.tiles).filter((t): t is FilterTile => !esAccion(t))
  const columnas = [...new Set(filtrosDeRecuadro.map(t => t.column).filter((c): c is string => !!c))]
  const filtros = model.view.filters
  const accionActiva = groups.some(g => g.tiles.some(t => esAccion(t) && t.active))

  /** Los filtros de la vista sin los de las columnas de los recuadros, más el del recuadro. */
  const alTocar = (t: FilterTile) => {
    const resto = Object.fromEntries(Object.entries(filtros).filter(([id]) => !columnas.includes(id)))
    return t.column && t.value !== null ? { ...resto, [t.column]: [t.value] } : resto
  }
  const marcado = (t: FilterTile) => !accionActiva && columnas.every(c => {
    const elegidos = filtros[c] ?? []
    return c === t.column && t.value !== null ? elegidos.length === 1 && elegidos[0] === t.value : elegidos.length === 0
  })

  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
      {groups.map((g, i) => (
        <div key={g.label ?? i} role="group" aria-label={g.label} className="min-w-0 flex-1 basis-80">
          {g.label && <p className="mb-1 text-etiqueta font-semibold text-informativo">{g.label}</p>}
          {/* En una fila en escritorio; en un teléfono pasan a la siguiente en vez de
              cortar la etiqueta ("No trabajand…" a 390 px). */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-2.5">
            {g.tiles.map(t => {
              const accion = esAccion(t)
              const n = accion ? t.count : model.countWith(alTocar(t))
              const activo = accion ? t.active : marcado(t)
              const alClic = accion ? t.onSelect : () => { onFilterTile?.(); model.setFilters(alTocar(t)) }
              return (
                <button key={accion ? `accion:${t.label}` : `${t.column ?? ''}:${t.value ?? t.label}`} type="button"
                  aria-pressed={activo} aria-label={n === undefined ? t.label : `${t.label}, ${n}`} onClick={alClic}
                  className={`rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                    activo ? 'border-accent bg-accent/5 ring-1 ring-accent/20' : 'border-border bg-white hover:bg-bg-main'}`}>
                  <p className={`text-xl font-bold leading-none tabular-nums ${TONO[t.tone ?? 'neutral']}`}>{n ?? '—'}</p>
                  <p className="mt-1 text-etiqueta text-informativo">{t.label}</p>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
