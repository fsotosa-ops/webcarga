import type { InstallmentState, PolicyState } from '@/lib/states'
import { apiFetch } from './client'

/** La API de Seguros de la Entrega 1 y 2: los estados los calcula la base
 *  (app.insurance_status); aquí solo se piden. */

export type CarrierInsuranceState = Exclude<PolicyState, 'CANCELLED' | 'RENEWED'> | 'NO_POLICY'
export type InsuranceAlert = 'EXPIRED' | 'OVERDUE_INSTALLMENTS' | 'EXPIRING'

export type PolicyRow = {
  id: string
  carrier_id: string
  carrier_name: string
  carrier_tax_id: string
  insurance_company: string
  policy_number: string | null
  valid_from: string | null
  valid_to: string | null
  has_file: boolean
  policy_state: PolicyState
  expires_in_days: number | null
  installments_total: number
  paid_installments: number
  unpaid_installments: number
  overdue_installments: number
  next_due_date: string | null
  has_outside_validity: boolean
}

/** El veredicto de una empresa en Seguros (app.carrier_insurance_summary), por gravedad. */
export type InsuranceVerdict = 'EXPIRED' | 'NO_POLICY' | 'OVERDUE' | 'NO_DATES' | 'EXPIRING' | 'UP_TO_DATE'

/** Una empresa en Seguros: su veredicto y los datos que lo explican, de la vista. */
export type CarrierInsuranceRow = {
  carrier_id: string
  carrier_name: string
  /** `public.carriers.tax_id` admite nulo. */
  carrier_tax_id: string | null
  operational_status: string
  policies: number
  worst_state: CarrierInsuranceState
  insurance_verdict: InsuranceVerdict
  insurance_alert: InsuranceAlert | null
  /** Alguna póliza con 2 o más cuotas vencidas (la regla D2). */
  severe_overdue: boolean
  unpaid_installments: number
  overdue_installments: number
  unpaid_uf: number | null
  oldest_overdue_date: string | null
  next_due_date: string | null
  /** La póliza que explica Vencida / Sin fechas / Por vencer. */
  reason_insurer: string | null
  reason_valid_to: string | null
}

/** Una empresa con sus pólizas no canceladas (las renovadas, solo con deuda) y sus cuotas.
 *  `summary` vacío: la empresa existe pero no tiene veredicto (inactiva y sin pólizas). */
export type CarrierInsuranceDetail = {
  summary: CarrierInsuranceRow | null
  policies: (PolicyRow & { installments: InstallmentRow[] })[]
}

export type CarrierInsuranceOverview = {
  data: CarrierInsuranceRow[]
  facets: Record<InsuranceVerdict, number> & { total: number }
}

export type InstallmentRow = {
  id: string
  policy_id: string
  carrier_id: string
  carrier_name: string
  insurance_company: string
  policy_number: string | null
  installment_number: number
  installments_total: number
  due_date: string | null
  due_in_days: number | null
  amount_uf: number | null
  installment_state: InstallmentState
  paid: boolean
  paid_on: string | null
  paid_by: string | null
  outside_validity: boolean | null
}

export type PolicyFilter = PolicyState | 'UNPAID' | 'NO_FILE'
export type InstallmentFilter = 'OVERDUE' | 'DUE_30' | 'PAID' | 'ALL'

type Paged<T, F extends string> = { data: T[]; count: number; page: number; limit: number; facets: Record<F | 'total', number> }
export type PoliciesResponse = Paged<PolicyRow, PolicyFilter>
export type InstallmentsResponse = Paged<InstallmentRow, InstallmentFilter>

export type PolicyDetail = {
  id: string
  carrier_id: string
  carrier_name: string
  insurance_company: string
  policy_number: string | null
  valid_from: string | null
  valid_to: string | null
  policy_document_url: string | null
  has_endorsement: boolean
  endorsement_number: string | null
  endorsement_document_url: string | null
  external_portal_url: string | null
  cancelled_at: string | null
  cancelled_reason: string | null
  updated_at: string | null
  policy_state: PolicyState
  expires_in_days: number | null
  renews_policy_id: string | null
  renewed_by_policy_id: string | null
  coverages: { coverage_type_id: string; code: string; name: string }[]
  assets: { asset_id: string; license_plate: string; asset_type: string }[]
  installments: InstallmentRow[]
  term_changes: { previous_valid_to: string | null; new_valid_to: string; endorsement_number: string | null; endorsement_date: string | null; changed_at: string }[]
}

export type BatchResult = { paid?: string[]; unpaid?: string[]; errors: { id: string; error: string }[] }

const qs = (p: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString()
const post = <T,>(path: string, body: unknown) => apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) })

/** Las claves de las consultas de Seguros: todas empiezan con 'insurance', así guardar
 *  una póliza o una cuota refresca todo con `invalidateQueries({ queryKey: ['insurance'] })`. */
export const insuranceKeys = {
  overview: () => ['insurance', 'carriers'] as const,
  carrier: (carrierId: string) => ['insurance', 'carrier', carrierId] as const,
}

export const insuranceApi = {
  listPolicies: (p: { state?: string; q?: string; page?: number; limit?: number } = {}) =>
    apiFetch<PoliciesResponse>(`/api/v1/policies?${qs({ state: p.state, q: p.q, page: p.page, limit: p.limit })}`),
  /** Seguros › Empresas: todas, con su veredicto. */
  carrierOverview: () => apiFetch<CarrierInsuranceOverview>('/api/v1/insurance/carriers'),
  /** El detalle de una empresa: su veredicto y sus pólizas con cuotas. */
  carrier: (carrierId: string) => apiFetch<CarrierInsuranceDetail>(`/api/v1/insurance/carriers/${carrierId}`),
  listInstallments: (p: { state?: InstallmentFilter; q?: string; page?: number; limit?: number } = {}) =>
    apiFetch<InstallmentsResponse>(`/api/v1/installments?${qs({ state: p.state, q: p.q, page: p.page, limit: p.limit })}`),
  get: (id: string) => apiFetch<PolicyDetail>(`/api/v1/policies/${id}`),
  pay: (ids: string[], paidOn: string) => post<BatchResult>('/api/v1/installments/pay', { ids, paid_on: paidOn }),
  unpay: (ids: string[]) => post<BatchResult>('/api/v1/installments/unpay', { ids }),
  cancel: (id: string, reason: string) => post<PolicyDetail>(`/api/v1/policies/${id}/cancel`, { reason }),
  renew: (id: string, body: { valid_from: string; valid_to: string; policy_number?: string; insurance_company?: string }) =>
    post<PolicyDetail>(`/api/v1/policies/${id}/renew`, body),
  renewalCandidates: (id: string) =>
    apiFetch<{ id: string; insurance_company: string; policy_number: string | null; valid_from: string; valid_to: string | null }[]>(
      `/api/v1/policies/${id}/renewal-candidates`),
  renewedBy: (id: string, successorId: string) => post<PolicyDetail>(`/api/v1/policies/${id}/renewed-by`, { successor_id: successorId }),
  extend: (id: string, body: { valid_to: string; endorsement_number?: string; endorsement_date?: string }) =>
    post<PolicyDetail>(`/api/v1/policies/${id}/extend`, body),
  appendInstallments: (id: string, body: { count: number; amount_uf: number; first_due_date: string }) =>
    post<InstallmentRow[]>(`/api/v1/policies/${id}/installments/append`, body),
}
