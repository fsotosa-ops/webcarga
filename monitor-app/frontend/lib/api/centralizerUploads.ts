import type { CentralizerUploadDetail, CentralizerUploadSummary, CentralizerDiff, CentralizerParseError } from '@/lib/types'
import { apiFetch } from './client'

export type CentralizerUploadListResponse = {
  data:  CentralizerUploadSummary[]
  count: number
  page:  number
  limit: number
}

export type CentralizerUploadPreview = {
  upload_id:     string
  sheet_summary: Record<string, number>
  parse_errors:  CentralizerParseError[]
  diff:          CentralizerDiff
}

export const centralizerUploadsApi = {
  upload: (file: File) => {
    const form = new FormData()
    form.set('file', file)
    return apiFetch<CentralizerUploadPreview>('/api/v1/centralizer-uploads', {
      method: 'POST',
      body: form,
    })
  },

  list: (params?: { page?: number; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params?.page)  qs.set('page',  String(params.page))
    if (params?.limit) qs.set('limit', String(params.limit))
    const q = qs.toString()
    return apiFetch<CentralizerUploadListResponse>(`/api/v1/centralizer-uploads${q ? `?${q}` : ''}`)
  },

  get: (id: string) =>
    apiFetch<{ data: CentralizerUploadDetail }>(`/api/v1/centralizer-uploads/${id}`),

  approve: (id: string) =>
    apiFetch<{ ok: boolean; status: string }>(`/api/v1/centralizer-uploads/${id}/approve`, { method: 'POST' }),

  reject: (id: string, reason?: string) =>
    apiFetch<{ ok: boolean; status: string }>(`/api/v1/centralizer-uploads/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  apply: (id: string) =>
    apiFetch<{ ok: boolean; status: string; matched_transporters: number }>(
      `/api/v1/centralizer-uploads/${id}/apply`, { method: 'POST' },
    ),
}
