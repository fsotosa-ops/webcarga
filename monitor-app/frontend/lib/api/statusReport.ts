import type { StatusReport } from '@/lib/types'
import { apiFetch } from './client'

export const statusReportApi = {
  /** `shipperIds`: los ids de los clientes del directorio (spec 2026-10-11); vacío = todos. */
  get: (fecha: string, shipperIds: string[] = []) => {
    const params = new URLSearchParams({ fecha })
    for (const id of shipperIds) params.append('shipper_id', id)
    return apiFetch<StatusReport>(`/api/v1/status-report?${params.toString()}`)
  },
}
