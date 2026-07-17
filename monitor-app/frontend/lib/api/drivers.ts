import type { Driver, OperationalStatus } from '@/lib/types'
import { apiFetch } from './client'

export type DriverCreateBody = {
  tax_id:              string
  country_code?:       string
  full_name:           string
  operational_status?: OperationalStatus
}

export type DriverPatchBody = {
  full_name?:          string
  operational_status?: OperationalStatus
}

/** POST /drivers RETURNING es más angosto que GET /drivers/{id} — sin
 *  is_manual_override/total_requirements todavía (recién creado). */
export type DriverCreateResult = {
  id:                  string
  tax_id:              string
  country_code:        string
  full_name:           string
  operational_status:  OperationalStatus
  created_at:          string | null
}

export const driversApi = {
  get: (id: string) =>
    apiFetch<Driver>(`/api/v1/drivers/${id}`),

  create: (body: DriverCreateBody) =>
    apiFetch<DriverCreateResult>('/api/v1/drivers', { method: 'POST', body: JSON.stringify(body) }),

  patch: (id: string, body: DriverPatchBody) =>
    apiFetch<Driver>(`/api/v1/drivers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
}
