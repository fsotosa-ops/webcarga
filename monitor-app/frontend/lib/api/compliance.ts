import type {
  CarrierCertificationStatus,
  BulkUploadResult, ComplianceRecordDetail, ComplianceStatus, DocumentVersion,
  PendingComplianceListResponse, RequirementOption,
} from '@/lib/types'
import { apiFetch } from './client'

export type ListPendingParams = {
  carrierId?:       string
  category?:        'CARRIER' | 'DRIVER' | 'ASSET'
  requirementCode?: string
  q?:               string
  operationType?:   'Tractoreo' | 'Equipo Completo'
  limit?:           number
  offset?:          number
}

export type ComplianceRecordPatchBody = {
  status?:           ComplianceStatus
  expiration_date?:  string
}

/** POST /{id}/file — respuesta = upload_document_version() + status forzado.
 *  Subir = revisar (no existe due diligence separado del negocio hoy). */
export type ComplianceFileUploadResult = {
  status:      'APPROVED_MANUAL'
  storage_path: string
  file_name:   string
  mime_type:   string
  size_bytes:  number
}

export const complianceApi = {
  get: (id: string) =>
    apiFetch<ComplianceRecordDetail>(`/api/v1/compliance-records/${id}`),

  patch: (id: string, body: ComplianceRecordPatchBody) =>
    apiFetch<ComplianceRecordDetail>(`/api/v1/compliance-records/${id}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),

  uploadFile: (id: string, file: File, expirationDate?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (expirationDate) form.append('expiration_date', expirationDate)
    return apiFetch<ComplianceFileUploadResult>(`/api/v1/compliance-records/${id}/file`, {
      method: 'POST', body: form,
    })
  },

  /** Catalogo de tipos de documento, para el desplegable de clasificacion. */
  listRequirements: (targetEntity?: 'CARRIER' | 'DRIVER' | 'ASSET') =>
    apiFetch<RequirementOption[]>(
      `/api/v1/compliance-requirements${targetEntity ? `?target_entity=${targetEntity}` : ''}`,
    ),

  listFiles: (id: string) =>
    apiFetch<DocumentVersion[]>(`/api/v1/compliance-records/${id}/files`),

  deleteFile: (id: string) =>
    apiFetch<ComplianceRecordDetail>(`/api/v1/compliance-records/${id}/file`, {
      method: 'DELETE',
    }),

  // ── Módulo Documentos (sábana) ─────────────────────────────────────────

  /** Cómo va cada empresa: cubierto vs. pendiente, y cuánto llegó sin
   *  clasificar. Es la vista por defecto del módulo. */
  listCarrierStatus: (params: { q?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams()
    if (params.q)     qs.set('q', params.q)
    if (params.limit != null) qs.set('limit', String(params.limit))
    const suffix = qs.toString() ? `?${qs}` : ''
    return apiFetch<CarrierCertificationStatus>(`/api/v1/compliance-records/carrier-status${suffix}`)
  },

  listPending: (params: ListPendingParams = {}) => {
    const qs = new URLSearchParams()
    if (params.carrierId)       qs.set('carrier_id', params.carrierId)
    if (params.category)        qs.set('category', params.category)
    if (params.requirementCode) qs.set('requirement_code', params.requirementCode)
    if (params.q)                qs.set('q', params.q)
    if (params.operationType)    qs.set('operation_type', params.operationType)
    if (params.limit != null)    qs.set('limit', String(params.limit))
    if (params.offset != null)   qs.set('offset', String(params.offset))
    const suffix = qs.toString() ? `?${qs}` : ''
    return apiFetch<PendingComplianceListResponse>(`/api/v1/compliance-records/pending${suffix}`)
  },

  bulkUploadFile: (carrierId: string, pairs: { recordId: string; file: File }[]) => {
    const form = new FormData()
    form.append('carrier_id', carrierId)
    for (const { recordId, file } of pairs) {
      form.append('record_ids', recordId)
      form.append('files', file)
    }
    return apiFetch<BulkUploadResult>('/api/v1/compliance-records/bulk-file', {
      method: 'POST', body: form,
    })
  },
}
