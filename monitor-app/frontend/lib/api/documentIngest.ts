import type { IngestUploadResult, TrayItem } from '@/lib/types'
import { apiFetch } from './client'

export type ClassifyBody = {
  entity_type:      'CARRIER' | 'DRIVER' | 'ASSET'
  entity_id:        string
  requirement_id:   string
  expiration_date?: string
}

/** Bandeja de documentos sin clasificar de una empresa (HU-01). */
export type ClassifyBatchBody = {
  item_ids:         string[]
  entity_type:      'CARRIER' | 'DRIVER' | 'ASSET'
  entity_id:        string
  requirement_id:   string
  expiration_date?: string
}

export type ClassifyBatchResult = {
  applied: string[]
  errors:  { item_id: string; error: string }[]
}

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

  /** Aplica el mismo requisito a N archivos de una vez. */
  classifyBatch: (body: ClassifyBatchBody) =>
    apiFetch<ClassifyBatchResult>('/api/v1/document-ingest/items/classify-batch', {
      method: 'POST', body: JSON.stringify(body),
    }),

  /** Reasigna archivos sin clasificar a otra empresa. */
  moveItems: (itemIds: string[], carrierId: string) =>
    apiFetch<{ moved: number }>('/api/v1/document-ingest/items/move', {
      method: 'POST', body: JSON.stringify({ item_ids: itemIds, carrier_id: carrierId }),
    }),

  remove: (itemId: string) =>
    apiFetch<void>(`/api/v1/document-ingest/items/${itemId}`, { method: 'DELETE' }),
}
