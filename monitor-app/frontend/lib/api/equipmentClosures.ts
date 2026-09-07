import type { EquipmentClosePending, EquipmentClosureStatus, EquipmentDayStatusRow } from '@/lib/types'
import { apiFetch, ApiError } from './client'

export type EquipmentClosePendingError = {
  message: string
  /** Los equipos que bloquean, con patente y empresa. Llegaban desde el
   *  primer día y la pantalla sólo mostraba `message`: "15 equipo(s) sin
   *  resolver" sin decir cuáles. */
  pending: EquipmentClosePending[]
}

/** El backend manda el 409 con `detail` = objeto estructurado — ver
 *  close_equipment_day en equipment_closures.py. Mismo contrato que
 *  isClosePendingError (daily_closures, cierre por conductor). */
export function isEquipmentClosePendingError(e: unknown): e is ApiError & { detail: EquipmentClosePendingError } {
  return e instanceof ApiError && e.status === 409 && typeof e.detail === 'object' && e.detail !== null
}

export const equipmentClosuresApi = {
  get: (fecha: string) =>
    apiFetch<EquipmentClosureStatus>(`/api/v1/equipment-closures?fecha=${encodeURIComponent(fecha)}`),

  /** Paridad con dailyClosuresApi.setReason (2026-08-04) — motivo de UN
   *  equipo, usado en la vista Equipo Completo de "Flota del día". */
  setReason: (assetId: string, fecha: string, unassignedReasonId: string, comentario?: string | null) =>
    apiFetch<EquipmentDayStatusRow>(
      `/api/v1/equipment-closures/${assetId}?fecha=${encodeURIComponent(fecha)}`,
      { method: 'PATCH', body: JSON.stringify({ unassigned_reason_id: unassignedReasonId, comentario }) },
    ),

  /** BLOQUE 1 de HU-03: selección masiva — un solo motivo para varios
   *  tractos en un clic (criterio de aceptación #2). */
  setReasonBatch: (fecha: string, assetIds: string[], unassignedReasonId: string) =>
    apiFetch<EquipmentDayStatusRow[]>(
      `/api/v1/equipment-closures/reason?fecha=${encodeURIComponent(fecha)}`,
      { method: 'PATCH', body: JSON.stringify({ asset_ids: assetIds, unassigned_reason_id: unassignedReasonId }) },
    ),

  close: (fecha: string, override?: boolean, overrideNote?: string) =>
    apiFetch<{ ok: boolean; business_date: string; overridden: number }>(
      `/api/v1/equipment-closures/close?fecha=${encodeURIComponent(fecha)}`,
      { method: 'POST', body: JSON.stringify({ override: !!override, override_note: overrideNote }) },
    ),
}
