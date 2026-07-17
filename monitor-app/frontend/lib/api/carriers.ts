import type {
  Carrier,
  CarrierAssetRosterItem,
  CarrierDriverRosterItem,
  CarrierListResponse,
  CarrierPolicyListItem,
  Contact,
  OperationalStatus,
  PolicyStatus,
} from '@/lib/types'
import { apiFetch } from './client'

export type CarrierListParams = {
  q?:                  string
  operational_status?: OperationalStatus | ''
  page?:               number
  limit?:              number
}

export type CarrierCreateBody = {
  tax_id:              string
  country_code?:       string
  business_name:       string
  operational_status?: OperationalStatus
}

export type CarrierPatchBody = {
  business_name?:       string
  operational_status?:  OperationalStatus
  expected_updated_at?: string
}

export type ContactCreateBody = {
  entity_id:      string
  entity_type:    'CARRIER'
  contact_role:   string
  first_name?:    string
  last_name?:     string
  job_title?:     string
  email?:         string
  phone?:         string
  is_primary?:    boolean
}

export type InsurancePolicyCreateBody = {
  carrier_id:              string
  insurance_company:       string
  policy_number?:          string
  valid_from?:             string
  valid_to?:               string
  expiration_alert_days?:  number
}

/** POST /carriers RETURNING es más angosto que GET /carriers/{id} — sin
 *  contactos/compliance_records/is_manual_override todavía (recién creado). */
export type CarrierCreateResult = {
  id:                  string
  tax_id:              string
  country_code:        string
  business_name:       string
  operational_status:  OperationalStatus
  created_at:          string | null
}

/** POST /carriers/{id}/policies RETURNING — más angosto que GET /policies/{id}. */
export type InsurancePolicyCreateResult = {
  id:                      string
  carrier_id:              string
  insurance_company:       string
  policy_number:           string | null
  valid_from:              string | null
  valid_to:                string | null
  expiration_alert_days:   number
  status:                  PolicyStatus
  created_at:              string | null
}

export const carriersApi = {
  list: (params?: CarrierListParams) => {
    const qs = new URLSearchParams()
    if (params?.q)                       qs.set('q', params.q)
    if (params?.operational_status)      qs.set('operational_status', params.operational_status)
    if (params?.page)                    qs.set('page', String(params.page))
    if (params?.limit)                   qs.set('limit', String(params.limit))
    const suffix = qs.toString() ? `?${qs}` : ''
    return apiFetch<CarrierListResponse>(`/api/v1/carriers${suffix}`)
  },

  get: (id: string) =>
    apiFetch<Carrier>(`/api/v1/carriers/${id}`),

  create: (body: CarrierCreateBody) =>
    apiFetch<CarrierCreateResult>('/api/v1/carriers', { method: 'POST', body: JSON.stringify(body) }),

  patch: (id: string, body: CarrierPatchBody) =>
    apiFetch<Carrier>(`/api/v1/carriers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // ── Roster de conductores/vehículos (alta = crear asignación ACTIVE) ──

  listDrivers: (id: string) =>
    apiFetch<CarrierDriverRosterItem[]>(`/api/v1/carriers/${id}/drivers`),

  assignDriver: (id: string, driverId: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/carriers/${id}/drivers`, {
      method: 'POST', body: JSON.stringify({ driver_id: driverId, carrier_id: id }),
    }),

  unassignDriver: (id: string, driverId: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/carriers/${id}/drivers/${driverId}`, { method: 'DELETE' }),

  listAssets: (id: string) =>
    apiFetch<CarrierAssetRosterItem[]>(`/api/v1/carriers/${id}/assets`),

  assignAsset: (id: string, assetId: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/carriers/${id}/assets`, {
      method: 'POST', body: JSON.stringify({ asset_id: assetId, carrier_id: id }),
    }),

  unassignAsset: (id: string, assetId: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/carriers/${id}/assets/${assetId}`, { method: 'DELETE' }),

  // ── Contactos (alta anidada; PATCH/DELETE en lib/api/contacts.ts) ──────

  listContacts: (id: string) =>
    apiFetch<Contact[]>(`/api/v1/carriers/${id}/contacts`),

  createContact: (id: string, body: Omit<ContactCreateBody, 'entity_id' | 'entity_type'>) =>
    apiFetch<Contact>(`/api/v1/carriers/${id}/contacts`, {
      method: 'POST',
      body: JSON.stringify({ ...body, entity_id: id, entity_type: 'CARRIER' }),
    }),

  // ── Pólizas de seguro (detalle/PATCH/M:N en lib/api/policies.ts) ──────

  listPolicies: (id: string) =>
    apiFetch<CarrierPolicyListItem[]>(`/api/v1/carriers/${id}/policies`),

  createPolicy: (id: string, body: Omit<InsurancePolicyCreateBody, 'carrier_id'>) =>
    apiFetch<InsurancePolicyCreateResult>(`/api/v1/carriers/${id}/policies`, {
      method: 'POST',
      body: JSON.stringify({ ...body, carrier_id: id }),
    }),
}
