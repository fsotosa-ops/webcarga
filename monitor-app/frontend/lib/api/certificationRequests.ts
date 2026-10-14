import type { CertificationRequest, CertificationRequestBody } from '@/lib/types'
import { apiFetch } from './client'

/** Pedir a Certificación (Entrega B, 14/10): Operaciones pide, Certificación resuelve. */
export const certificationRequestsApi = {
  /** Si ya hay un pedido abierto para lo mismo, devuelve ese (`created: false`). */
  create: (body: CertificationRequestBody) =>
    apiFetch<{ id: string; created: boolean }>('/api/v1/certification-requests', {
      method: 'POST', body: JSON.stringify(body),
    }),

  listOpen: () =>
    apiFetch<{ total: number; rows: CertificationRequest[] }>('/api/v1/certification-requests'),

  resolve: (id: string, note?: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/certification-requests/${id}/resolve`, {
      method: 'POST', body: JSON.stringify({ note: note ?? null }),
    }),
}
