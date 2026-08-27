import type { DailyClosureReport, DailyClosureStatus, DriverDayStatusRow } from '@/lib/types'
import { apiFetch, ApiError } from './client'

/** Un viaje cuya flota no está en el directorio, tal como lo arma
 *  `_pendientes_de_flota` en daily_closures.py: `tipo` más los campos de la
 *  escalación que lo produjo. Los campos son opcionales porque cada tipo trae
 *  los suyos —una patente no registrada no tiene RUT, una empresa en onboarding
 *  no tiene patente— y la pantalla arma la frase con lo que llegó. */
export type SinFlota = {
  tipo: 'PATENTE_NO_REGISTRADA' | 'CONDUCTOR_NO_REGISTRADO' | 'EMPRESA_NO_RECONOCIDA' | 'EMPRESA_ONBOARDING' | string
  tractor_plate?: string
  driver_rut?: string
  reason?: string
  tms_carrier_name?: string
  directory_carrier_name?: string
  carrier_id?: string
  carrier_name?: string
}

export type ClosePendingError = {
  message: string
  pending: { driver_id: string; full_name: string; status: string }[]
  /** El segundo motivo de bloqueo, y es de VIAJE y no de conductor: la flota de
   *  ese viaje no está en el directorio, así que no tiene empresa a la que
   *  atribuirse. Pedido de Pablo (21/08): *"el sistema debería obligarme a
   *  asignarle una empresa"*.
   *
   *  Van separados de `pending` a propósito: fundirlos en un solo contador
   *  daría un número que no dice qué hacer. `tipo` es cuál de las cuatro
   *  escalaciones lo produjo — no es lo mismo "esta patente no existe" que
   *  "esta empresa está en onboarding".
   *
   *  Opcional porque el backend lo agregó después y los dos se despliegan por
   *  separado; el `message` que muestra la pantalla ya lo nombra igual. */
  sin_flota?: SinFlota[]
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
