import type { DailyClosureReport, DailyClosureStatus, DriverDayStatusRow } from '@/lib/types'
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
  /** Trae `cierre.posteriores_al_cierre` (Tarea 7) además del detalle por
   *  conductor — el día firmado no se recalcula, ese campo es el delta de
   *  viajes que llegaron después de la firma. */
  get: (fecha: string) =>
    apiFetch<DailyClosureStatus>(`/api/v1/daily-closures?fecha=${encodeURIComponent(fecha)}`),

  setReason: (driverId: string, fecha: string, unassignedReasonId: string) =>
    apiFetch<DriverDayStatusRow>(
      `/api/v1/daily-closures/${driverId}?fecha=${encodeURIComponent(fecha)}`,
      { method: 'PATCH', body: JSON.stringify({ unassigned_reason_id: unassignedReasonId }) },
    ),

  /** Tarea 7 (plan 2.4) — selección masiva con checkbox, un motivo para
   *  varios conductores en un clic (HU-03 #2). */
  setReasonBatch: (fecha: string, driverIds: string[], unassignedReasonId: string) =>
    apiFetch<DriverDayStatusRow[]>(
      `/api/v1/daily-closures/reason?fecha=${encodeURIComponent(fecha)}`,
      { method: 'PATCH', body: JSON.stringify({ driver_ids: driverIds, unassigned_reason_id: unassignedReasonId }) },
    ),

  close: (fecha: string, override?: boolean, overrideNote?: string) =>
    apiFetch<{ ok: boolean; business_date: string; overridden: number }>(
      `/api/v1/daily-closures/close?fecha=${encodeURIComponent(fecha)}`,
      { method: 'POST', body: JSON.stringify({ override: !!override, override_note: overrideNote }) },
    ),

  /** Reportería (spec 2026-07-21) — dataset plano por rango, sin recompute. */
  report: (fechaDesde: string, fechaHasta: string) =>
    apiFetch<DailyClosureReport>(
      `/api/v1/daily-closures/report?fecha_desde=${encodeURIComponent(fechaDesde)}&fecha_hasta=${encodeURIComponent(fechaHasta)}`,
    ),
}
