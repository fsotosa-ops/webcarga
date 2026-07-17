import type { Asset, OperationalStatus } from '@/lib/types'
import { apiFetch } from './client'

export type AssetType = 'TRACTOCAMION' | 'RAMPLA' | 'CAMION' | 'FURGON' | 'OTRO'

export type AssetCreateBody = {
  license_plate:       string
  asset_type:          AssetType
  operational_status?: OperationalStatus
}

export type AssetPatchBody = {
  asset_type?:          AssetType
  operational_status?:  OperationalStatus
}

/** POST /assets RETURNING es más angosto que GET /assets/{id} — sin
 *  is_manual_override/total_requirements todavía (recién creado). */
export type AssetCreateResult = {
  id:                  string
  license_plate:       string
  asset_type:          string
  operational_status:  OperationalStatus
  created_at:          string | null
}

export const assetsApi = {
  get: (id: string) =>
    apiFetch<Asset>(`/api/v1/assets/${id}`),

  create: (body: AssetCreateBody) =>
    apiFetch<AssetCreateResult>('/api/v1/assets', { method: 'POST', body: JSON.stringify(body) }),

  patch: (id: string, body: AssetPatchBody) =>
    apiFetch<Asset>(`/api/v1/assets/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
}
