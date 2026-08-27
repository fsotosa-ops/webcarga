import type {
  Carrier,
  ManagementType,
  CarrierAssetRosterItem,
  CarrierDriverRosterItem,
  CarrierInsuranceOverviewResponse,
  CarrierListResponse,
  CarrierOperationalStatus,
  CarrierPolicyListItem,
  CarrierShipper,
  ComplianceHealth,
  Contact,
  FleetDriverGapRow,
  PolicyStatus,
  Directorio,
} from '@/lib/types'
import { apiFetch, apiFetchBlob } from './client'

export type CarrierListParams = {
  q?:                  string
  operational_status?: CarrierOperationalStatus | ''
  health?:             ComplianceHealth | ''
  page?:               number
  limit?:              number
}

export type CarrierCreateBody = {
  tax_id?:              string
  country_code?:       string
  business_name:       string
  operational_status?: CarrierOperationalStatus
  /** Tipo de gestión DECLARADO en el alta. Se omite cuando nadie eligió: la
   *  flota manda cuando existe, y un arreglo vacío sería una tercera manera
   *  de decir "no declarado" — la base lo rechaza por eso. */
  management_types?:   ManagementType[]
}

export type CarrierPatchBody = {
  business_name?:       string
  tax_id?:              string
  operational_status?:  CarrierOperationalStatus
  /** El backend lo acepta desde que existe la columna (`carriers.py`,
   *  `management_types = COALESCE($5, management_types)`), pero este tipo no lo
   *  exponía y lo único que lo escribía era el panel de alta: al 27/08,
   *  **0 de 248 empresas** lo tenían cargado. No es un dato decorativo — los
   *  requisitos de Certificación se filtran por `applies_to_management_types`,
   *  así que con la columna vacía esas reglas no se aplican a nadie. */
  management_types?:    ManagementType[]
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
  has_endorsement?:        boolean
  endorsement_number?:     string
}

/** POST /carriers RETURNING es más angosto que GET /carriers/{id} — sin
 *  contactos/compliance_records/is_manual_override todavía (recién creado). */
export type CarrierCreateResult = {
  id:                  string
  tax_id:              string
  country_code:        string
  business_name:       string
  operational_status:  CarrierOperationalStatus
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
  has_endorsement:         boolean
  endorsement_number:      string | null
  status:                  PolicyStatus
  created_at:              string | null
}

export const carriersApi = {
  /** Cuántas empresas hay, cuántas operan, y con qué flota. Una sola consulta:
   *  ocho viajes a la base para dibujar una tira de cifras es lo que vuelve
   *  lenta una portada. */
  directorio: () => apiFetch<Directorio>('/api/v1/carriers/directorio'),

  list: (params?: CarrierListParams) => {
    const qs = new URLSearchParams()
    if (params?.q)                       qs.set('q', params.q)
    if (params?.operational_status)      qs.set('operational_status', params.operational_status)
    if (params?.health)                  qs.set('health', params.health)
    if (params?.page)                    qs.set('page', String(params.page))
    if (params?.limit)                   qs.set('limit', String(params.limit))
    const suffix = qs.toString() ? `?${qs}` : ''
    return apiFetch<CarrierListResponse>(`/api/v1/carriers${suffix}`)
  },

  get: (id: string) =>
    apiFetch<Carrier>(`/api/v1/carriers/${id}`),

  /** Tarea 9 (plan 3.2) — inconsistencias de dotación tracto/conductor por
   *  empresa, cálculo en vivo, solo empresas con desbalance. */
  fleetDriverGap: () =>
    apiFetch<{ rows: FleetDriverGapRow[] }>('/api/v1/carriers/fleet-driver-gap'),

  /** HU-08 (Fase 0): zip con toda la documentación cargada de la empresa —
   *  pedido explícito de Fabián en la reunión del 20/07. */
  exportDocuments: (id: string) =>
    apiFetchBlob(`/api/v1/carriers/${id}/documents/export`),

  create: (body: CarrierCreateBody) =>
    apiFetch<CarrierCreateResult>('/api/v1/carriers', { method: 'POST', body: JSON.stringify(body) }),

  patch: (id: string, body: CarrierPatchBody) =>
    apiFetch<Carrier>(`/api/v1/carriers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  /** Borrado real — a diferencia de patch(operational_status), el backend
   *  lo rechaza con 409 si la empresa tiene datos asociados (ver
   *  DELETE /carriers/{id}); el mensaje del error ya viene listo para
   *  mostrar al usuario. */
  delete: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/carriers/${id}`, { method: 'DELETE' }),

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

  // ── Generadores de carga (solo lectura por ahora) ──────────────────────

  listShippers: (id: string) =>
    apiFetch<CarrierShipper[]>(`/api/v1/carriers/${id}/shippers`),

  // ── Landing de Seguros — agregado por carrier (GET /carriers/insurance-overview) ──

  listInsuranceOverview: (params?: { q?: string; health?: string; operational_status?: string; page?: number; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params?.q)                  qs.set('q', params.q)
    if (params?.health)             qs.set('health', params.health)
    if (params?.operational_status) qs.set('operational_status', params.operational_status)
    if (params?.page)               qs.set('page', String(params.page))
    if (params?.limit)              qs.set('limit', String(params.limit))
    const suffix = qs.toString() ? `?${qs}` : ''
    return apiFetch<CarrierInsuranceOverviewResponse>(`/api/v1/carriers/insurance-overview${suffix}`)
  },
}
