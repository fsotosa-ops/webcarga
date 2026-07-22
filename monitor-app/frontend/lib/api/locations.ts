import type { Location, LocationCreatePayload, LocationPatchPayload } from '@/lib/types'
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
    const suffix = qs.toString() ? `?${qs}` : ''
    return apiFetch<Location[]>(`/api/v1/locations${suffix}`)
  },

  create: (body: LocationCreatePayload) =>
    apiFetch<Location>('/api/v1/locations', { method: 'POST', body: JSON.stringify(body) }),

  patch: (id: string, body: LocationPatchPayload) =>
    apiFetch<Location>(`/api/v1/locations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
}

export const shippersApi = {
  list: () => apiFetch<Shipper[]>('/api/v1/shippers'),

  create: (body: { name: string }) =>
    apiFetch<Shipper>('/api/v1/shippers', { method: 'POST', body: JSON.stringify(body) }),
}
