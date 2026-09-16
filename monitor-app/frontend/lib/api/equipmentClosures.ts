import type { EquipmentClosureStatus, EquipmentDayStatusRow } from '@/lib/types'
import { apiFetch } from './client'
import type { CambiosDeLinea } from './dailyClosures'

export const equipmentClosuresApi = {
  get: (fecha: string) =>
    apiFetch<EquipmentClosureStatus>(`/api/v1/equipment-closures?fecha=${encodeURIComponent(fecha)}`),

  /** Mismo contrato que dailyClosuresApi.setReason, sobre un tracto. */
  setReason: (assetId: string, fecha: string, cambios: CambiosDeLinea) =>
    apiFetch<EquipmentDayStatusRow>(
      `/api/v1/equipment-closures/${assetId}?fecha=${encodeURIComponent(fecha)}`,
      { method: 'PATCH', body: JSON.stringify(cambios) },
    ),

  setReasonBatch: (fecha: string, assetIds: string[], cambios: CambiosDeLinea) =>
    apiFetch<EquipmentDayStatusRow[]>(
      `/api/v1/equipment-closures/reason?fecha=${encodeURIComponent(fecha)}`,
      { method: 'PATCH', body: JSON.stringify({ asset_ids: assetIds, ...cambios }) },
    ),
}
