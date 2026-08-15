import { apiFetch } from './client'
import type { RequirementConditions, RecalcPreview, RecalcResult } from '@/lib/types'

const BASE = '/api/v1/compliance-requirements'

export const requirementsApi = {
  /** Cambia la regla, NO los registros: aplicarla es POST /recalc, un acto
   *  aparte. `null` no es un valor válido para `is_active` (columna NOT
   *  NULL) — el backend lo rechaza con 422. */
  patchConditions: (id: string, body: Partial<Pick<RequirementConditions,
    'is_active' | 'applies_to_fleet_service_type_ids' | 'applies_to_management_types'>>) =>
    apiFetch<RequirementConditions>(`${BASE}/${id}/conditions`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),

  /** Sólo lectura: qué pasaría si se aplicara la regla actual. */
  recalcPreview: (id: string) => apiFetch<RecalcPreview>(`${BASE}/${id}/recalc-preview`),

  recalc: (id: string) => apiFetch<RecalcResult>(`${BASE}/${id}/recalc`, { method: 'POST' }),
}
