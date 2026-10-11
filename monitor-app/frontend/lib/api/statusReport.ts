import type { StatusReport } from '@/lib/types'
import { apiFetch } from './client'

export const statusReportApi = {
  /** `shipperId`: el id del cliente del directorio (spec 2026-10-11). */
  get: (fecha: string, shipperId?: string) => {
    const params = new URLSearchParams({ fecha })
    if (shipperId) params.set('shipper_id', shipperId)
    return apiFetch<StatusReport>(`/api/v1/status-report?${params.toString()}`)
  },
}
