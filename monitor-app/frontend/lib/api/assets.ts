import type {
  Asset, AssetType, AssetTypeRow, AssignmentPeriod, ComplianceRecord, EntityActivity, FleetListParams, FleetListResponse,
  OperationalStatus, VehicleDriverAssignment,
} from '@/lib/types'
import { apiFetch } from './client'
import { fleetListQuery } from './fleet-list-query'

// La definición se mudó a `lib/types.ts` —el archivo de contrato, del que
// este ya dependía— y se re-exporta acá para no tocar a quien la importaba
// desde este módulo.
export type { AssetType }

export type AssetCreateBody = {
  license_plate:       string
  asset_type:          AssetType
  manufacture_year?:   number
}

export type AssetPatchBody = {
  asset_type?:          AssetType
  manufacture_year?:    number
  /** Tractoreo / Equipo Completo. El backend lo acepta desde el 2026-08-03 y
   *  este tipo no lo declaraba, así que la única forma de fijarlo era el alta
   *  —donde además es opcional— y un tracto mal clasificado, o sin clasificar,
   *  bloqueaba el cierre del día sin que hubiera dónde corregirlo.
   *
   *  `undefined` es "no lo toques"; `null` lo quita (D3, Entrega B 14/10:
   *  un tipo mal puesto tiene que poder corregirse a "sin clasificar"). */
  webcarga_operation_type_id?: string | null
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
  /** Directorio › Equipos (D4): todos, con filtros y paginado. */
  list: (p: FleetListParams<'without_carrier' | 'inactive' | 'without_type'> = {}) =>
    apiFetch<FleetListResponse>(`/api/v1/assets?${fleetListQuery(p)}`),

  /** El catálogo de tipos de equipo (public.asset_types). */
  types: () =>
    apiFetch<AssetTypeRow[]>('/api/v1/assets/types'),

  get: (id: string) =>
    apiFetch<Asset>(`/api/v1/assets/${id}`),

  create: (body: AssetCreateBody) =>
    apiFetch<AssetCreateResult>('/api/v1/assets', { method: 'POST', body: JSON.stringify(body) }),

  patch: (id: string, body: AssetPatchBody) =>
    apiFetch<Asset>(`/api/v1/assets/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  listComplianceRecords: (id: string) =>
    apiFetch<ComplianceRecord[]>(`/api/v1/assets/${id}/compliance-records`),

  /** Dónde trabajó (D4): los períodos de empresa, el vigente primero. */
  assignments: (id: string) =>
    apiFetch<AssignmentPeriod[]>(`/api/v1/assets/${id}/assignments`),

  activity: (id: string) =>
    apiFetch<EntityActivity>(`/api/v1/assets/${id}/activity`),

  /** Corregir la patente con motivo (D3): la anterior queda como alias del mismo equipo. */
  correctPlate: (id: string, value: string, reason: string) =>
    apiFetch<{ license_plate: string }>(`/api/v1/assets/${id}/identity`, {
      method: 'POST', body: JSON.stringify({ value, reason }),
    }),

  getDriverAssignment: (id: string) =>
    apiFetch<VehicleDriverAssignment | null>(`/api/v1/assets/${id}/driver-assignment`),

  assignDriver: (id: string, driverId: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/assets/${id}/driver-assignment`, {
      method: 'POST', body: JSON.stringify({ driver_id: driverId }),
    }),

  unassignDriver: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/assets/${id}/driver-assignment`, { method: 'DELETE' }),
}
