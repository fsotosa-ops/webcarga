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
  external_portal_url?:    string
  expected_updated_at?:    string
}

export type InstallmentPatchBody = {
  payment_status?: PaymentStatus
  paid_at?:        string
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
}

export const coverageTypesApi = {
  list: () => apiFetch<CoverageType[]>('/api/v1/coverage-types'),
}
