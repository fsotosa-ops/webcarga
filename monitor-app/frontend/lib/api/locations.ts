import type { Location, LocationCreatePayload, LocationPatchPayload, LocationRate, LocationRateCreatePayload, LocationRatePatchPayload } from '@/lib/types'
import { apiFetch } from './client'

export type LocationListParams = {
  entity_type?:         'SHIPPER' | ''
  entity_id?:            string
  q?:                     string
  operation_type?:        string
  operational_status?:   'ACTIVE' | 'INACTIVE' | ''
  /** HU-16 (Fase 4): solo locales sin clasificación — auto-registrados
   *  incompletos por trg_reconcile_new_trip_stop_location. */
  incomplete?:            boolean
  /** Fase 5 (Tarifario 1.0): agrega la tarifa vigente de cada local. */
  include_rate?:          boolean
  /** Ronda 43 (Fase C, Tarea 7): paginación de servidor — verificado que el
   *  generador de carga con más volumen tiene 566 locales activos. */
  page?:                  number
  limit?:                 number
}

export type LocationListResponse = {
  data:  Location[]
  count: number
  page:  number
  limit: number
}

export type Shipper = {
  id:     string
  name:   string
  status: string
}

export const locationsApi = {
  list: (params?: LocationListParams) => {
    const qs = new URLSearchParams()
    if (params?.entity_type)        qs.set('entity_type', params.entity_type)
    if (params?.entity_id)          qs.set('entity_id', params.entity_id)
    if (params?.q)                  qs.set('q', params.q)
    if (params?.operation_type)     qs.set('operation_type', params.operation_type)
    if (params?.operational_status) qs.set('operational_status', params.operational_status)
    if (params?.incomplete)         qs.set('incomplete', 'true')
    if (params?.include_rate)       qs.set('include_rate', 'true')
    if (params?.page)               qs.set('page', String(params.page))
    if (params?.limit)              qs.set('limit', String(params.limit))
    const suffix = qs.toString() ? `?${qs}` : ''
    return apiFetch<LocationListResponse>(`/api/v1/locations${suffix}`)
  },

  create: (body: LocationCreatePayload) =>
    apiFetch<Location>('/api/v1/locations', { method: 'POST', body: JSON.stringify(body) }),

  patch: (id: string, body: LocationPatchPayload) =>
    apiFetch<Location>(`/api/v1/locations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // ── Tarifario (Fase 5) ──────────────────────────────────────────────────

  listRates: (locationId: string) =>
    apiFetch<LocationRate[]>(`/api/v1/locations/${locationId}/rates`),

  createRate: (locationId: string, body: LocationRateCreatePayload) =>
    apiFetch<LocationRate>(`/api/v1/locations/${locationId}/rates`, { method: 'POST', body: JSON.stringify(body) }),

  patchRate: (locationId: string, rateId: string, body: LocationRatePatchPayload) =>
    apiFetch<LocationRate>(`/api/v1/locations/${locationId}/rates/${rateId}`, { method: 'PATCH', body: JSON.stringify(body) }),
}

export const shippersApi = {
  list: () => apiFetch<Shipper[]>('/api/v1/shippers'),

  create: (body: { name: string }) =>
    apiFetch<Shipper>('/api/v1/shippers', { method: 'POST', body: JSON.stringify(body) }),
}
