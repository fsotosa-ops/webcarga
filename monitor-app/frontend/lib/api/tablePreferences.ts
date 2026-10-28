import { apiFetch, ApiError } from './client'
import type { ColumnPrefs } from '@/components/ui/tabla/data/useDataTable'

const BASE = '/api/v1/me/table-preferences'

/** Columnas por persona y por tabla (Cierre con un solo patrón, spec §4.3). */
export const tablePreferencesApi = {
  /** `null` = sin preferencia guardada: la tabla usa su orden declarado. La API responde
   *  `columns: null` (28/10); el 404 se sigue aceptando de una API anterior. */
  get: async (tableKey: string): Promise<ColumnPrefs | null> => {
    try {
      return (await apiFetch<{ columns: ColumnPrefs | null }>(`${BASE}/${tableKey}`)).columns ?? null
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }
  },
  save: (tableKey: string, columns: ColumnPrefs) =>
    apiFetch<{ columns: ColumnPrefs }>(`${BASE}/${tableKey}`, { method: 'PUT', body: JSON.stringify({ columns }) }),
  reset: (tableKey: string) => apiFetch<void>(`${BASE}/${tableKey}`, { method: 'DELETE' }),
}
