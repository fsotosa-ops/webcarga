import type { TmsClient } from '@/lib/types'
import { apiFetch } from './client'

/** Sin parámetros, todos; `shipper_id`, los de un cliente; `unlinked`, los que
 *  todavía no tienen cliente. */
export type TmsClientListParams = { shipper_id?: string; unlinked?: boolean }

/** Cómo llama cada TMS a cada cliente del directorio (spec 2026-10-11). */
export const tmsClientsApi = {
  list: (params?: TmsClientListParams) => {
    const qs = new URLSearchParams()
    if (params?.shipper_id) qs.set('shipper_id', params.shipper_id)
    if (params?.unlinked)   qs.set('unlinked', 'true')
    const s = qs.toString()
    return apiFetch<TmsClient[]>(`/api/v1/tms-clients${s ? `?${s}` : ''}`)
  },
  vincular: (sourceClientId: string, shipperId: string) =>
    apiFetch<{ source_client_id: string; shipper_id: string }>(
      `/api/v1/tms-clients/${encodeURIComponent(sourceClientId)}`,
      { method: 'PUT', body: JSON.stringify({ shipper_id: shipperId }) },
    ),
}
