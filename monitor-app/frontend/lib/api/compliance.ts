import type {
  CertificationGroup, CertificationScope, CertificationStatus,
  BulkUploadResult, ComplianceRecordDetail, ComplianceStatus, DocumentVersion,
  EstadoDocumental, PendingComplianceListResponse, RequirementOption,
} from '@/lib/types'
import { apiFetch } from './client'

export type ListPendingParams = {
  carrierId?:       string
  category?:        'CARRIER' | 'DRIVER' | 'ASSET'
  requirementCode?: string
  q?:               string
  operationType?:   'Tractoreo' | 'Equipo Completo'
  /** Un sujeto concreto: lo que le falta a ESTE conductor o a ESTE vehículo.
   *  Se filtra en el servidor y no en el cliente porque la página corta en
   *  200 y hay empresas con 381 pendientes. */
  entityId?:        string
  /** Qué mostrar de la documentación: falta, por vencer, al día o todo. El
   *  backend asume 'falta' cuando no viaja, así que sólo se manda cuando NO
   *  es el default — mismo criterio que `scope` en `listStatus`. */
  estado?:          EstadoDocumental
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


  /** Catalogo de tipos de documento, para el desplegable de clasificacion. */
  listRequirements: (targetEntity?: 'CARRIER' | 'DRIVER' | 'ASSET') =>
    apiFetch<RequirementOption[]>(
      `/api/v1/compliance-requirements${targetEntity ? `?target_entity=${targetEntity}` : ''}`,
    ),

  /** HU-03: corrige un documento cargado en el lugar equivocado. Con destino
   *  lo reasigna; con `to_tray` lo devuelve a la bandeja. El archivo no se
   *  copia ni se borra — viaja la referencia. */
  reassign: (id: string, body: {
    target_entity_type?: 'CARRIER' | 'DRIVER' | 'ASSET'
    target_entity_id?: string
    target_requirement_id?: string
    to_tray?: boolean
  }) =>
    apiFetch<{ ok: boolean; to_tray: boolean }>(
      `/api/v1/compliance-records/${id}/reassign`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  listFiles: (id: string) =>
    apiFetch<DocumentVersion[]>(`/api/v1/compliance-records/${id}/files`),

  /** Sube un documento DIRECTO a su requisito, en una sola operación.
   *
   *  Es el camino corto, y el único que no puede dejar un archivo varado: la
   *  otra puerta —`upload` + `classifyBatch`, la de la Bandeja— sube primero y
   *  clasifica después, así que cada rechazo —típicamente el 422 por falta de
   *  fecha— dejaba el archivo en la bandeja y el requisito vacío.
   *
   *  `expiration_date` viaja sólo si el requisito la contempla. `apiFetch` ya
   *  maneja `FormData` sin pisar el `Content-Type` (necesita poner el boundary
   *  del multipart él mismo) y propaga el `detail` del backend como mensaje,
   *  así que el motivo del rechazo llega legible al renglón que lo pidió. */
  uploadFile: (id: string, file: File, expirationDate?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (expirationDate) form.append('expiration_date', expirationDate)
    return apiFetch<ComplianceFileUploadResult>(
      `/api/v1/compliance-records/${id}/file`,
      { method: 'POST', body: form },
    )
  },

  deleteFile: (id: string) =>
    apiFetch<ComplianceRecordDetail>(`/api/v1/compliance-records/${id}/file`, {
      method: 'DELETE',
    }),

  // ── Módulo Documentos (sábana) ─────────────────────────────────────────

  /** Cómo va la certificación, agrupada por empresa, conductor o vehículo.
   *  Es la lista del módulo; el conmutador sólo cambia `group`. */
  listStatus: (params: {
    group?: CertificationGroup; scope?: CertificationScope
    carrierId?: string; q?: string; limit?: number
  } = {}) => {
    const qs = new URLSearchParams()
    if (params.group) qs.set('group', params.group)
    // Sólo se manda cuando NO es el default: el backend ya asume 'active', y
    // mandarlo igual ensucia la clave de caché de React Query sin necesidad.
    if (params.scope && params.scope !== 'active') qs.set('scope', params.scope)
    if (params.carrierId) qs.set('carrier_id', params.carrierId)
    if (params.q)     qs.set('q', params.q)
    if (params.limit != null) qs.set('limit', String(params.limit))
    const suffix = qs.toString() ? `?${qs}` : ''
    return apiFetch<CertificationStatus>(`/api/v1/compliance-records/status${suffix}`)
  },

  listPending: (params: ListPendingParams = {}) => {
    const qs = new URLSearchParams()
    if (params.carrierId)       qs.set('carrier_id', params.carrierId)
    if (params.category)        qs.set('category', params.category)
    if (params.requirementCode) qs.set('requirement_code', params.requirementCode)
    if (params.q)                qs.set('q', params.q)
    if (params.operationType)    qs.set('operation_type', params.operationType)
    if (params.entityId)         qs.set('entity_id', params.entityId)
    // Sólo se manda cuando NO es el default: el backend ya asume 'falta', y
    // mandarlo igual ensucia la clave de caché de React Query sin necesidad.
    if (params.estado && params.estado !== 'falta') qs.set('estado', params.estado)
    if (params.limit != null)    qs.set('limit', String(params.limit))
    if (params.offset != null)   qs.set('offset', String(params.offset))
    const suffix = qs.toString() ? `?${qs}` : ''
    return apiFetch<PendingComplianceListResponse>(`/api/v1/compliance-records/pending${suffix}`)
  },

}
