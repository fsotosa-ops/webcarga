import type {
  CoverageType, InsuranceInstallment, InsurancePolicy, PaymentStatus, PolicyStatus,
} from '@/lib/types'
import { apiFetch } from './client'

export type PolicyPatchBody = {
  insurance_company?:      string
  policy_number?:          string
  valid_from?:             string
  valid_to?:               string
  status?:                 PolicyStatus
  expiration_alert_days?:  number
  has_endorsement?:        boolean
  endorsement_number?:     string
  external_portal_url?:    string
  expected_updated_at?:    string
}

export type InstallmentPatchBody = {
  payment_status?: PaymentStatus
  paid_at?:        string
}

export type InstallmentScheduleGenerateBody = {
  total_installments: number
  amount_uf:           number
  first_due_date:      string
}

export type PolicyFileUploadResult = {
  kind:         'document' | 'endorsement'
  storage_path: string
  file_name:    string
  mime_type:    string
  size_bytes:   number
}

export const policiesApi = {
  get: (id: string) =>
    apiFetch<InsurancePolicy>(`/api/v1/policies/${id}`),

  patch: (id: string, body: PolicyPatchBody) =>
    apiFetch<InsurancePolicy>(`/api/v1/policies/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  linkCoverage: (id: string, coverageTypeId: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/policies/${id}/coverages`, {
      method: 'POST', body: JSON.stringify({ coverage_type_id: coverageTypeId }),
    }),

  unlinkCoverage: (id: string, coverageTypeId: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/policies/${id}/coverages/${coverageTypeId}`, { method: 'DELETE' }),

  linkAsset: (id: string, assetId: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/policies/${id}/assets`, {
      method: 'POST', body: JSON.stringify({ asset_id: assetId }),
    }),

  unlinkAsset: (id: string, assetId: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/policies/${id}/assets/${assetId}`, { method: 'DELETE' }),

  listInstallments: (id: string) =>
    apiFetch<InsuranceInstallment[]>(`/api/v1/policies/${id}/installments`),

  patchInstallment: (installmentId: string, body: InstallmentPatchBody) =>
    apiFetch<InsuranceInstallment>(`/api/v1/policies/installments/${installmentId}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),

  generateInstallments: (id: string, body: InstallmentScheduleGenerateBody) =>
    apiFetch<InsuranceInstallment[]>(`/api/v1/policies/${id}/installments/generate`, {
      method: 'POST', body: JSON.stringify(body),
    }),

  uploadFile: (id: string, file: File, kind: 'document' | 'endorsement' = 'document') => {
    const form = new FormData()
    form.append('file', file)
    return apiFetch<PolicyFileUploadResult>(`/api/v1/policies/${id}/file?kind=${kind}`, {
      method: 'POST', body: form,
    })
  },

  deleteFile: (id: string, kind: 'document' | 'endorsement' = 'document') =>
    apiFetch<InsurancePolicy>(`/api/v1/policies/${id}/file?kind=${kind}`, {
      method: 'DELETE',
    }),
}

export const coverageTypesApi = {
  list: () => apiFetch<CoverageType[]>('/api/v1/coverage-types'),
}
