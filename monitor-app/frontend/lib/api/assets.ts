import type { Asset, ComplianceRecord, OperationalStatus, VehicleDriverAssignment } from '@/lib/types'
import { apiFetch } from './client'

/** Los dos tipos que existen de verdad. CAMION, FURGON y OTRO eran
 *  placeholders del commit 5955c5f (Empresas/Seguros), anteriores a la
 *  taxonomía real de vehículos —migraciones 20260802–20260804— y nunca
 *  describieron el negocio: cero de los 118 vehículos los usa. El subtipo
 *  fino vive en fleet_service_type_id, que es un catálogo de 10 valores. */
export type AssetType = 'TRACTOCAMION' | 'RAMPLA'

export type AssetCreateBody = {
  license_plate:       string
  asset_type:          AssetType
  operational_status?: OperationalStatus
  manufacture_year?:   number
}

export type AssetPatchBody = {
  asset_type?:          AssetType
  operational_status?:  OperationalStatus
  manufacture_year?:    number
}

/** POST /assets RETURNING es más angosto que GET /assets/{id} — sin
 *  is_manual_override/total_requirements todavía (recién creado). */
export type AssetCreateResult = {
  id:                  string
  license_plate:       string
  asset_type:          string
  operational_status:  OperationalStatus
  manufacture_year:    number | null
  created_at:          string | null
}

export const assetsApi = {
  get: (id: string) =>
    apiFetch<Asset>(`/api/v1/assets/${id}`),

  create: (body: AssetCreateBody) =>
    apiFetch<AssetCreateResult>('/api/v1/assets', { method: 'POST', body: JSON.stringify(body) }),

  patch: (id: string, body: AssetPatchBody) =>
    apiFetch<Asset>(`/api/v1/assets/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  listComplianceRecords: (id: string) =>
    apiFetch<ComplianceRecord[]>(`/api/v1/assets/${id}/compliance-records`),

  getDriverAssignment: (id: string) =>
    apiFetch<VehicleDriverAssignment | null>(`/api/v1/assets/${id}/driver-assignment`),

  assignDriver: (id: string, driverId: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/assets/${id}/driver-assignment`, {
      method: 'POST', body: JSON.stringify({ driver_id: driverId }),
    }),

  unassignDriver: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/assets/${id}/driver-assignment`, { method: 'DELETE' }),
}
