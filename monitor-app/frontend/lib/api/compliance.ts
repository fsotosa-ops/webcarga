import type { ComplianceRecordDetail, ComplianceStatus, DocumentVersion } from '@/lib/types'
import { apiFetch } from './client'

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

  uploadFile: (id: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiFetch<ComplianceFileUploadResult>(`/api/v1/compliance-records/${id}/file`, {
      method: 'POST', body: form,
    })
  },

  listFiles: (id: string) =>
    apiFetch<DocumentVersion[]>(`/api/v1/compliance-records/${id}/files`),

  deleteFile: (id: string) =>
    apiFetch<ComplianceRecordDetail>(`/api/v1/compliance-records/${id}/file`, {
      method: 'DELETE',
    }),
}
