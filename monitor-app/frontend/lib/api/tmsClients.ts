import type { TmsClient } from '@/lib/types'
import { apiFetch } from './client'

/** Configuración › Clientes del TMS (spec 2026-10-11): a qué cliente del
 *  directorio corresponde cada cliente de cada TMS. */
export const tmsClientsApi = {
  list: () => apiFetch<TmsClient[]>('/api/v1/tms-clients'),
  vincular: (sourceClientId: string, shipperId: string) =>
    apiFetch<{ source_client_id: string; shipper_id: string }>(
      `/api/v1/tms-clients/${encodeURIComponent(sourceClientId)}`,
      { method: 'PUT', body: JSON.stringify({ shipper_id: shipperId }) },
    ),
}
