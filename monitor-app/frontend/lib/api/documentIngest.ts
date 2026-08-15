import type { IngestUploadResult, TrayPage } from '@/lib/types'
import { apiFetch } from './client'

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

export type UndoClassifyResult = {
  reverted: string[]
  errors:   { item_id: string; error: string }[]
}

export const documentIngestApi = {
  /** Sube archivos a la bandeja. Sin `carrierId` van a la bandeja global —
   *  la tanda que llega por correo mezcla empresas y quien carga todavía no
   *  sabe de quién es nada. */
  upload: (carrierId: string | undefined, files: File[]) => {
    const form = new FormData()
    for (const f of files) form.append('files', f)
    const url = carrierId
      ? `/api/v1/document-ingest/${carrierId}/files`
      : '/api/v1/document-ingest/files'
    return apiFetch<IngestUploadResult>(url, { method: 'POST', body: form })
  },

  /** La cola global de sin clasificar. Sin `carrierId` trae todas las empresas:
   *  una bandeja que obliga a elegir empresa antes de mostrar algo es un
   *  buscador, no una bandeja. */
  listQueue: (params: { carrierId?: string; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams()
    if (params.carrierId) qs.set('carrier_id', params.carrierId)
    if (params.limit  != null) qs.set('limit',  String(params.limit))
    if (params.offset != null) qs.set('offset', String(params.offset))
    const suffix = qs.toString() ? `?${qs}` : ''
    return apiFetch<TrayPage>(`/api/v1/document-ingest/items${suffix}`)
  },

  /** Firma la vista previa de un archivo. Se pide al enfocarlo, no al listar:
   *  firmar el listado entero es una llamada HTTP por archivo. */
  previewUrl: (itemId: string) =>
    apiFetch<{ preview_url: string | null }>(
      `/api/v1/document-ingest/items/${itemId}/preview-url`,
    ),

  /** Aplica el mismo requisito a N archivos de una vez. */
  classifyBatch: (body: ClassifyBatchBody) =>
    apiFetch<ClassifyBatchResult>('/api/v1/document-ingest/items/classify-batch', {
      method: 'POST', body: JSON.stringify(body),
    }),

  /** Carga un documento cuyo destino YA se conoce (la ficha de una empresa,
   *  un conductor o un vehículo).
   *
   *  Usa la MISMA puerta que la bandeja —`upload` + `classifyBatch`— en vez de
   *  un endpoint aparte: una sola implementación de carga es criterio de
   *  aceptación de la HU-04, y dos caminos distintos para lo mismo terminan
   *  divergiendo. La única diferencia es que acá el requisito ya se sabe.
   *
   *  Si la clasificación falla, el archivo queda visible en la bandeja de la
   *  empresa en vez de perderse. */
  uploadAndClassify: async (params: {
    carrierId:       string
    entityType:      'CARRIER' | 'DRIVER' | 'ASSET'
    entityId:        string
    requirementId:   string
    file:            File
    expirationDate?: string
  }) => {
    const subida = await documentIngestApi.upload(params.carrierId, [params.file])
    const item = subida.items[0]
    if (!item) {
      throw new Error(subida.errors[0]?.error ?? 'No se pudo subir el archivo')
    }
    return documentIngestApi.classifyBatch({
      item_ids:      [item.id],
      entity_type:   params.entityType,
      entity_id:     params.entityId,
      requirement_id: params.requirementId,
      ...(params.expirationDate ? { expiration_date: params.expirationDate } : {}),
    })
  },

  /** Reasigna archivos sin clasificar a otra empresa. */
  moveItems: (itemIds: string[], carrierId: string) =>
    apiFetch<{ moved: number }>('/api/v1/document-ingest/items/move', {
      method: 'POST', body: JSON.stringify({ item_ids: itemIds, carrier_id: carrierId }),
    }),

  remove: (itemId: string) =>
    apiFetch<void>(`/api/v1/document-ingest/items/${itemId}`, { method: 'DELETE' }),

  /** Revierte una clasificación en lote: vacía los requisitos y devuelve los
   *  archivos a la bandeja. Se le pasan los mismos ids que `classifyBatch`
   *  devolvió en `applied`. */
  undoClassify: (itemIds: string[]) =>
    apiFetch<UndoClassifyResult>('/api/v1/document-ingest/items/undo-classify', {
      method: 'POST', body: JSON.stringify({ item_ids: itemIds }),
    }),
}
