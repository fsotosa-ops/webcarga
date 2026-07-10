import type {
  ComplianceAlertSummary,
  CompanyGovernance,
  ComplianceStatus,
  DriverGovernance,
  TransporterListResponse,
  TransporterProfile,
  TransporterDriver,
  TransporterVehicle,
  TransporterTrailer,
  TransporterContactability,
  TransporterDocumentPatchResult,
  StoredFile,
} from '@/lib/types'
import { apiFetch } from './client'


export type TransporterPatch = {
  business_name?:      string
  rut?:                string
  account_stage?:      string
  contactability?:     TransporterContactability
  drivers?:            TransporterDriver[]
  vehicles?:           TransporterVehicle[]
  trailers?:           TransporterTrailer[]
  company_governance?: CompanyGovernance
}

export type TransporterListParams = {
  q?:       string
  stage?:   string
  active?:  boolean
  eligible?: boolean
  /** 'docs' | 'insurance' */
  alert?:   string
  page?:    number
  limit?:   number
}

export type DocumentPatch = {
  status?:          ComplianceStatus
  expiry_date?:     string
  file_url?:        string
  notes?:           string
  manual_override?: boolean
}

export const transportersApi = {
  list: (params?: TransporterListParams) => {
    const qs = new URLSearchParams()
    if (params?.q)               qs.set('q',        params.q)
    if (params?.stage)            qs.set('stage',    params.stage)
    if (params?.active != null)   qs.set('active',   String(params.active))
    if (params?.eligible != null) qs.set('eligible', String(params.eligible))
    if (params?.alert)            qs.set('alert',    params.alert)
    if (params?.page)             qs.set('page',     String(params.page))
    if (params?.limit)            qs.set('limit',    String(params.limit))
    const suffix = qs.toString() ? `?${qs}` : ''
    return apiFetch<TransporterListResponse>(`/api/v1/transporters/${suffix}`)
  },

  get: (id: string) =>
    apiFetch<TransporterProfile>(`/api/v1/transporters/${id}`),

  patch: (id: string, body: TransporterPatch) =>
    apiFetch<TransporterProfile>(`/api/v1/transporters/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  resetField: (id: string, field: string) =>
    apiFetch<{ ok: boolean; field: string }>(`/api/v1/transporters/${id}/overrides/${field}`, {
      method: 'DELETE',
    }),

  addDriver: (id: string, body: { rut: string; name: string }) =>
    apiFetch<{ data: TransporterDriver }>(`/api/v1/transporters/${id}/drivers`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  patchDriver: (id: string, did: string, body: { rut?: string; name?: string; governance?: DriverGovernance }) =>
    apiFetch<{ data: TransporterDriver }>(`/api/v1/transporters/${id}/drivers/${did}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  removeDriver: (id: string, did: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/transporters/${id}/drivers/${did}`, {
      method: 'DELETE',
    }),

  addVehicle: (id: string, body: { type: string; plate: string }) =>
    apiFetch<{ data: TransporterVehicle }>(`/api/v1/transporters/${id}/vehicles`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  patchVehicle: (id: string, vid: string, body: { type?: string; plate?: string; governance?: import('@/lib/types').VehicleGovernance }) =>
    apiFetch<{ data: TransporterVehicle }>(`/api/v1/transporters/${id}/vehicles/${vid}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  removeVehicle: (id: string, vid: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/transporters/${id}/vehicles/${vid}`, {
      method: 'DELETE',
    }),

  addTrailer: (id: string, body: { plate: string }) =>
    apiFetch<{ data: TransporterTrailer }>(`/api/v1/transporters/${id}/trailers`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  removeTrailer: (id: string, trid: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/transporters/${id}/trailers/${trid}`, {
      method: 'DELETE',
    }),

  getComplianceAlertSummary: () =>
    apiFetch<ComplianceAlertSummary>(`/api/v1/transporters/compliance-alerts/summary`),

  // ── Documentos de la empresa (app.compliance_documents, entity_type='transporter') ──

  patchDocument: (id: string, docCode: string, body: DocumentPatch) =>
    apiFetch<TransporterDocumentPatchResult>(`/api/v1/transporters/${id}/documents/${docCode}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  uploadDocumentFile: (id: string, docCode: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiFetch<StoredFile>(`/api/v1/transporters/${id}/documents/${docCode}/file`, {
      method: 'POST',
      body: form,
    })
  },

  listDocumentFiles: (id: string, docCode: string) =>
    apiFetch<StoredFile[]>(`/api/v1/transporters/${id}/documents/${docCode}/files`),

  // ── Transferencias (rol admin) ──────────────────────────────────────

  transferDriver: (id: string, did: string, toTransporterId: string) =>
    apiFetch<{ ok: boolean; driver_id: string; from_transporter_id: string; to_transporter_id: string }>(
      `/api/v1/transporters/${id}/drivers/${did}/transfer`,
      { method: 'POST', body: JSON.stringify({ to_transporter_id: toTransporterId }) },
    ),

  transferVehicle: (id: string, vid: string, toTransporterId: string) =>
    apiFetch<{ ok: boolean; vehicle_id: string; from_transporter_id: string; to_transporter_id: string }>(
      `/api/v1/transporters/${id}/vehicles/${vid}/transfer`,
      { method: 'POST', body: JSON.stringify({ to_transporter_id: toTransporterId }) },
    ),
}
