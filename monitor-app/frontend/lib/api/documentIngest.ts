import type { IngestUploadResult, TrayItem } from '@/lib/types'
import { apiFetch } from './client'

export type ClassifyBody = {
  entity_type:      'CARRIER' | 'DRIVER' | 'ASSET'
  entity_id:        string
  requirement_id:   string
  expiration_date?: string
}

/** Bandeja de documentos sin clasificar de una empresa (HU-01). */
export const documentIngestApi = {
  upload: (carrierId: string, files: File[]) => {
    const form = new FormData()
    for (const f of files) form.append('files', f)
    return apiFetch<IngestUploadResult>(`/api/v1/document-ingest/${carrierId}/files`, {
      method: 'POST', body: form,
    })
  },

  listTray: (carrierId: string) =>
    apiFetch<TrayItem[]>(`/api/v1/document-ingest/${carrierId}/items`),

  classify: (itemId: string, body: ClassifyBody) =>
    apiFetch<{ compliance_record_id: string }>(
      `/api/v1/document-ingest/items/${itemId}/classify`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  remove: (itemId: string) =>
    apiFetch<void>(`/api/v1/document-ingest/items/${itemId}`, { method: 'DELETE' }),
}
