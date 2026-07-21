import type { DailyClosureStatus, DriverDayStatusRow } from '@/lib/types'
import { apiFetch, ApiError } from './client'

export type ClosePendingError = {
  message: string
  pending: { driver_id: string; full_name: string; status: string }[]
}

/** El backend manda el 409 con `detail` = objeto estructurado (no string) —
 *  ver close_day en daily_closures.py. */
export function isClosePendingError(e: unknown): e is ApiError & { detail: ClosePendingError } {
  return e instanceof ApiError && e.status === 409 && typeof e.detail === 'object' && e.detail !== null
}

export const dailyClosuresApi = {
  get: (fecha: string) =>
    apiFetch<DailyClosureStatus>(`/api/v1/daily-closures?fecha=${encodeURIComponent(fecha)}`),

  setReason: (driverId: string, fecha: string, unassignedReasonId: string) =>
    apiFetch<DriverDayStatusRow>(
      `/api/v1/daily-closures/${driverId}?fecha=${encodeURIComponent(fecha)}`,
      { method: 'PATCH', body: JSON.stringify({ unassigned_reason_id: unassignedReasonId }) },
    ),

  close: (fecha: string, override?: boolean, overrideNote?: string) =>
    apiFetch<{ ok: boolean; business_date: string; overridden: number }>(
      `/api/v1/daily-closures/close?fecha=${encodeURIComponent(fecha)}`,
      { method: 'POST', body: JSON.stringify({ override: !!override, override_note: overrideNote }) },
    ),
}
