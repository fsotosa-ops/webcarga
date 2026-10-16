import { apiFetch, ApiError } from './client'
import type { ColumnPrefs } from '@/components/ui/tabla/data/useDataTable'

const BASE = '/api/v1/me/table-preferences'

/** Columnas por persona y por tabla (Cierre con un solo patrón, spec §4.3). */
export const tablePreferencesApi = {
  /** `null` = sin preferencia guardada: la tabla usa su orden declarado. */
  get: async (tableKey: string): Promise<ColumnPrefs | null> => {
    try {
      return (await apiFetch<{ columns: ColumnPrefs }>(`${BASE}/${tableKey}`)).columns
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }
  },
  save: (tableKey: string, columns: ColumnPrefs) =>
    apiFetch<{ columns: ColumnPrefs }>(`${BASE}/${tableKey}`, { method: 'PUT', body: JSON.stringify({ columns }) }),
  reset: (tableKey: string) => apiFetch<void>(`${BASE}/${tableKey}`, { method: 'DELETE' }),
}
