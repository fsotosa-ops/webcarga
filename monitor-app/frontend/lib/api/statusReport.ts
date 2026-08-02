import type { StatusReport } from '@/lib/types'
import { apiFetch } from './client'

export const statusReportApi = {
  get: (fecha: string, client?: string) => {
    const params = new URLSearchParams({ fecha })
    if (client) params.set('client', client)
    return apiFetch<StatusReport>(`/api/v1/status-report?${params.toString()}`)
  },
}
