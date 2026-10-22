import { apiFetch, apiFetchBlob, ApiError } from './client'
import type { TableView } from '@/lib/table/viewInUrl'
import type { ColumnPrefs } from '@/components/ui/tabla/data/useDataTable'
import { resolvePeriod, type DateField, type Period } from '@/lib/analytics/period'

/** Analítica: la BDOT reconstruida (HU monitor-app/docs/user-stories/20261022/01-hu-analitica.md). */

export type AnalyticsDataset = 'trips' | 'fleet'

export type AnalyticsColumnMeta = {
  id: string
  label: string
  group: string
  type: 'text' | 'date' | 'datetime' | 'number' | 'bool' | 'list'
  filter: 'values' | 'none'
  default_visible: boolean
}

export type AnalyticsRow = Record<string, unknown> & { _id: string }

export type AnalyticsPage = {
  rows: AnalyticsRow[]
  total: number
  counts: Record<string, Record<string, number>>
  loaded_at: string | null
}

/** Lo que guarda una vista (sin fechas fijas: el período es relativo). */
export type SavedViewState = TableView & {
  period: Period
  date_field: DateField | null
  mode?: 'table' | 'pivot'
  pivot?: { rows: string[]; cols: string[] }
  /** "Todas las columnas del catálogo" (la vista sembrada BDOT completo). */
  all_columns?: boolean
}

export type SavedView = {
  id: string
  dataset: AnalyticsDataset
  name: string
  scope: 'personal' | 'shared'
  view: SavedViewState
  columns: ColumnPrefs
  can_edit: boolean
  is_mine: boolean
  updated_at: string
}

export type SavedViewInput = Pick<SavedView, 'dataset' | 'name' | 'scope' | 'view' | 'columns'>

export type AnalyticsQuery = {
  dataset: AnalyticsDataset
  period: Period
  dateField: DateField | null
  view: TableView
  page: number
  size: number
}

/** La descarga pasó el máximo de filas: el período tiene `total`. */
export class ExportTooLargeError extends Error {
  constructor(public total: number) {
    super(`El período tiene ${total} filas`)
    this.name = 'ExportTooLargeError'
  }
}

const BASE = '/api/v1/analytics'

/** Los parámetros de la API, con los mismos nombres del kit de tabla (`f.<columna>`, `q`, `sort`). Un valor con
 *  coma va codificado, igual que en la URL de la pantalla (`writeView`). */
export function queryParams(q: AnalyticsQuery, today: string): URLSearchParams {
  const { from, to } = resolvePeriod(q.period, today)
  const p = new URLSearchParams({ dataset: q.dataset, from, to })
  if (q.dateField) p.set('date', q.dateField)
  for (const [col, valores] of Object.entries(q.view.filters)) {
    if (valores.length) p.set(`f.${col}`, valores.map(encodeURIComponent).join(','))
  }
  if (q.view.q) p.set('q', q.view.q)
  if (q.view.sort) p.set('sort', `${q.view.sort.column}:${q.view.sort.dir}`)
  p.set('page', String(q.page))
  p.set('size', String(q.size))
  return p
}

export const analyticsApi = {
  columns: (dataset: AnalyticsDataset) =>
    apiFetch<AnalyticsColumnMeta[]>(`${BASE}/columns?dataset=${dataset}`),

  rows: (q: AnalyticsQuery, today: string, mode: 'table' | 'pivot' = 'table') => {
    const p = queryParams(q, today)
    if (mode === 'pivot') p.set('mode', 'pivot')
    return apiFetch<AnalyticsPage>(`${BASE}/rows?${p}`)
  },

  /** El Excel de lo que se ve: las columnas visibles, en su orden. */
  export: async (q: AnalyticsQuery, columns: string[], today: string): Promise<{ blob: Blob; filename: string }> => {
    const p = queryParams(q, today)
    p.delete('page'); p.delete('size')
    p.set('columns', columns.join(','))
    try {
      const blob = await apiFetchBlob(`${BASE}/export?${p}`)
      return { blob, filename: `analitica_${q.dataset}_${p.get('from')}_${p.get('to')}.xlsx` }
    } catch (e) {
      const total = (e as ApiError).detail as { total?: number } | undefined
      if (e instanceof ApiError && e.status === 413 && typeof total?.total === 'number') {
        throw new ExportTooLargeError(total.total)
      }
      throw e
    }
  },

  views: (dataset: AnalyticsDataset) => apiFetch<SavedView[]>(`${BASE}/views?dataset=${dataset}`),
  createView: (body: SavedViewInput) =>
    apiFetch<SavedView>(`${BASE}/views`, { method: 'POST', body: JSON.stringify(body) }),
  updateView: (id: string, body: Partial<Omit<SavedViewInput, 'dataset'>>) =>
    apiFetch<SavedView>(`${BASE}/views/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteView: (id: string) => apiFetch<void>(`${BASE}/views/${id}`, { method: 'DELETE' }),
}
