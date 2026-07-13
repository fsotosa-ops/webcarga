import type {
  InsuranceSummaryRow,
  InsuranceTransporterResponse,
  InsurancePolicy,
  InsuranceInstallment,
  InstallmentStatus,
  PolicyType,
  DocumentVersion,
  InsuranceDocument,
  InsuranceDocumentPatchResult,
  InsuranceInstallmentFlat,
  InsuranceKpis,
} from '@/lib/types'
import { apiFetch } from './client'

export type InstallmentPatch = {
  status?:              InstallmentStatus
  paid_at?:              string
  payment_url?:           string
  expected_updated_at?:   string
}

export type PolicyPatch = {
  payment_url?: string
  file_url?:    string
  policy_type?: PolicyType
}

export type RevertInstallmentPatch = {
  expected_updated_at?: string
}

export const insuranceApi = {
  summary: (params?: { q?: string }) => {
    const qs = new URLSearchParams()
    if (params?.q) qs.set('q', params.q)
    const suffix = qs.toString() ? `?${qs}` : ''
    return apiFetch<{ data: InsuranceSummaryRow[] }>(`/api/v1/insurance/summary${suffix}`)
  },

  getForTransporter: (transporterId: string) =>
    apiFetch<InsuranceTransporterResponse>(`/api/v1/insurance/transporters/${transporterId}`),

  getPolicy: (pid: string) =>
    apiFetch<InsurancePolicy & { installments: InsuranceInstallment[] }>(`/api/v1/insurance/policies/${pid}`),

  patchInstallment: (iid: string, body: InstallmentPatch) =>
    apiFetch<InsuranceInstallment>(`/api/v1/insurance/installments/${iid}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  revertInstallment: (iid: string, body: RevertInstallmentPatch) =>
    apiFetch<InsuranceInstallment>(`/api/v1/insurance/installments/${iid}/revert`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  patchPolicy: (pid: string, body: PolicyPatch) =>
    apiFetch<InsurancePolicy>(`/api/v1/insurance/policies/${pid}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  uploadPolicyFile: (pid: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiFetch<Record<string, unknown>>(`/api/v1/insurance/policies/${pid}/file`, {
      method: 'POST',
      body: form,
    })
  },

  listPolicyFiles: (pid: string) =>
    apiFetch<DocumentVersion[]>(`/api/v1/insurance/policies/${pid}/files`),

  listPolicyDocuments: (pid: string) =>
    apiFetch<InsuranceDocument[]>(`/api/v1/insurance/policies/${pid}/documents`),

  patchDocument: (pid: string, docCode: string, body: {
    status?: string; expiry_date?: string; file_url?: string; notes?: string; manual_override?: boolean
  }) =>
    apiFetch<InsuranceDocumentPatchResult>(`/api/v1/insurance/policies/${pid}/documents/${docCode}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  uploadDocumentFile: (pid: string, docCode: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiFetch<Record<string, unknown>>(`/api/v1/insurance/policies/${pid}/documents/${docCode}/file`, {
      method: 'POST',
      body: form,
    })
  },

  listDocumentFiles: (pid: string, docCode: string) =>
    apiFetch<DocumentVersion[]>(`/api/v1/insurance/policies/${pid}/documents/${docCode}/files`),

  installmentsFlat: () =>
    apiFetch<InsuranceInstallmentFlat[]>('/api/v1/insurance/installments'),

  kpis: () =>
    apiFetch<InsuranceKpis>('/api/v1/insurance/kpis'),
}
