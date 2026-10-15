import type {
  AssignmentPeriod, ComplianceRecord, Contact, Driver, DriverPickCandidate, DriverSearchResult,
  EntityActivity, FleetListParams, FleetListResponse, OperationalStatus,
} from '@/lib/types'
import type { ContactCreateBody } from './carriers'
import { apiFetch } from './client'
import { fleetListQuery } from './fleet-list-query'

export type DriverCreateBody = {
  tax_id:              string
  country_code?:       string
  full_name:           string
  operational_status?: OperationalStatus
  /** Origen habitual (HU-28), opcional: se puede enrolar a alguien antes de saber de
   *  qué CD va a salir. */
  home_location_id?:   string
}

export type DriverPatchBody = {
  full_name?:          string
  operational_status?: OperationalStatus
  /** Cadena vacía = quitarlo. Omitirlo = no tocarlo. No es lo mismo, y
   *  confundirlos es como el cierre llegó a borrar comentarios al cambiar un
   *  motivo. */
  home_location_id?:   string
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
  /** Directorio › Conductores (D4): todos, con filtros y paginado. */
  list: (p: FleetListParams<'without_carrier' | 'inactive' | 'without_origin'> = {}) =>
    apiFetch<FleetListResponse>(`/api/v1/drivers?${fleetListQuery(p)}`),

  search: (q: string, limit = 10) =>
    apiFetch<DriverSearchResult[]>(`/api/v1/drivers/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  /** HU-06 (Fase 3): candidatos por similitud de texto contra un nombre
   *  crudo del TMS — usado cuando el viaje no cruza por nombre exacto. */
  fuzzyMatch: (name: string, limit = 5) =>
    apiFetch<DriverPickCandidate[]>(`/api/v1/drivers/fuzzy-match?name=${encodeURIComponent(name)}&limit=${limit}`),

  get: (id: string) =>
    apiFetch<Driver>(`/api/v1/drivers/${id}`),

  create: (body: DriverCreateBody) =>
    apiFetch<DriverCreateResult>('/api/v1/drivers', { method: 'POST', body: JSON.stringify(body) }),

  patch: (id: string, body: DriverPatchBody) =>
    apiFetch<Driver>(`/api/v1/drivers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  listComplianceRecords: (id: string) =>
    apiFetch<ComplianceRecord[]>(`/api/v1/drivers/${id}/compliance-records`),

  /** Dónde trabajó (D4): los períodos de empresa, el vigente primero. */
  assignments: (id: string) =>
    apiFetch<AssignmentPeriod[]>(`/api/v1/drivers/${id}/assignments`),

  activity: (id: string) =>
    apiFetch<EntityActivity>(`/api/v1/drivers/${id}/activity`),

  /** Corregir el RUT con motivo (D3): queda en la auditoría. */
  correctRut: (id: string, value: string, reason: string) =>
    apiFetch<{ tax_id: string }>(`/api/v1/drivers/${id}/identity`, {
      method: 'POST', body: JSON.stringify({ value, reason }),
    }),

  // ── Contactos (alta anidada; PATCH/DELETE en lib/api/contacts.ts) ─────

  listContacts: (id: string) =>
    apiFetch<Contact[]>(`/api/v1/drivers/${id}/contacts`),

  createContact: (id: string, body: Omit<ContactCreateBody, 'entity_id' | 'entity_type'>) =>
    apiFetch<Contact>(`/api/v1/drivers/${id}/contacts`, {
      method: 'POST',
      body: JSON.stringify({ ...body, entity_id: id, entity_type: 'DRIVER' }),
    }),
}
