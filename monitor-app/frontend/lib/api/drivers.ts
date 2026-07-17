import type { ComplianceRecord, Contact, Driver, OperationalStatus } from '@/lib/types'
import type { ContactCreateBody } from './carriers'
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

  listComplianceRecords: (id: string) =>
    apiFetch<ComplianceRecord[]>(`/api/v1/drivers/${id}/compliance-records`),

  // ── Contactos (alta anidada; PATCH/DELETE en lib/api/contacts.ts) ─────

  listContacts: (id: string) =>
    apiFetch<Contact[]>(`/api/v1/drivers/${id}/contacts`),

  createContact: (id: string, body: Omit<ContactCreateBody, 'entity_id' | 'entity_type'>) =>
    apiFetch<Contact>(`/api/v1/drivers/${id}/contacts`, {
      method: 'POST',
      body: JSON.stringify({ ...body, entity_id: id, entity_type: 'DRIVER' }),
    }),
}
