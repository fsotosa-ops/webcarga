import type { DailyClosureReport, DailyClosureStatus, DriverDayStatusRow } from '@/lib/types'
import { apiFetch } from './client'

/** Lo que una persona cambia en una línea del cierre. Una clave AUSENTE no
 *  viaja en el JSON y el backend conserva lo que había; `null` la vacía. Sin
 *  esa distinción, cambiar el motivo borraba el comentario, y comentar
 *  borraba el motivo. Firmar y reabrir el día viven en `closuresApi`. */
export type CambiosDeLinea = {
  unassigned_reason_id?: string | null
  /** YYYY-MM-DD. Sólo para motivos de "no trabajó". */
  valid_until?:          string | null
  comentario?:           string | null
}

export const dailyClosuresApi = {
  /** Trae `cierre.posteriores_al_cierre` además del detalle por conductor — el
   *  día firmado no se recalcula, ese campo es el delta de viajes que llegaron
   *  después de la firma. */
  get: (fecha: string) =>
    apiFetch<DailyClosureStatus>(`/api/v1/daily-closures?fecha=${encodeURIComponent(fecha)}`),

  setReason: (driverId: string, fecha: string, cambios: CambiosDeLinea) =>
    apiFetch<DriverDayStatusRow>(
      `/api/v1/daily-closures/${driverId}?fecha=${encodeURIComponent(fecha)}`,
      { method: 'PATCH', body: JSON.stringify(cambios) },
    ),

  /** Selección masiva con checkbox: los mismos cambios para varios conductores. */
  setReasonBatch: (fecha: string, driverIds: string[], cambios: CambiosDeLinea) =>
    apiFetch<DriverDayStatusRow[]>(
      `/api/v1/daily-closures/reason?fecha=${encodeURIComponent(fecha)}`,
      { method: 'PATCH', body: JSON.stringify({ driver_ids: driverIds, ...cambios }) },
    ),

  /** Reportería (spec 2026-07-21) — dataset plano por rango, sin recompute. */
  report: (fechaDesde: string, fechaHasta: string) =>
    apiFetch<DailyClosureReport>(
      `/api/v1/daily-closures/report?fecha_desde=${encodeURIComponent(fechaDesde)}&fecha_hasta=${encodeURIComponent(fechaHasta)}`,
    ),
}
