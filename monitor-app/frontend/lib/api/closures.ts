import { apiFetch, ApiError } from './client'
import type { DriverDayStatusValue, EquipmentClosePending } from '@/lib/types'

/** Un viaje cuya flota no está en el directorio, tal como lo arma
 *  `pendientes_de_flota` en services/cierre_lineas.py: `tipo` más los campos de
 *  la escalación que lo produjo. Los campos son opcionales porque cada tipo
 *  trae los suyos —una patente no registrada no tiene RUT, una empresa en
 *  onboarding no tiene patente— y la pantalla arma la frase con lo que llegó. */
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

/** El 409 de firmar el día. Tres motivos distintos, tres listas: un solo
 *  número no dice qué hacer. */
export type CierrePendienteError = {
  message:            string
  pending:            { driver_id: string; full_name: string; status: DriverDayStatusValue }[]
  pending_equipment:  EquipmentClosePending[]
  sin_flota:          SinFlota[]
}

export type CierreFirmado = {
  business_date: string
  closed_at:     string
  totales: {
    conductores: number; conductores_resueltos: number
    tractos: number; tractos_resueltos: number
    viajes: number
  }
  overridden: number
}

export function isCierrePendienteError(e: unknown): e is ApiError & { detail: CierrePendienteError } {
  return e instanceof ApiError && e.status === 409 && typeof e.detail === 'object'
    && e.detail !== null && 'pending' in (e.detail as object)
}

/** El cierre del día: los dos ejes en UNA llamada y una transacción. Antes
 *  eran dos POST encadenados desde esta pantalla, y si el segundo fallaba el
 *  día quedaba medio firmado sin que nada lo dijera. */
export const closuresApi = {
  cerrar: (fecha: string, override?: boolean, overrideNote?: string) =>
    apiFetch<CierreFirmado>(
      `/api/v1/closures/${encodeURIComponent(fecha)}/close`,
      { method: 'POST', body: JSON.stringify({ override: !!override, override_note: overrideNote }) },
    ),

  /** Sólo admin, y con una nota que diga por qué. */
  reabrir: (fecha: string, nota: string) =>
    apiFetch<{ business_date: string; status: 'OPEN' }>(
      `/api/v1/closures/${encodeURIComponent(fecha)}/reopen`,
      { method: 'POST', body: JSON.stringify({ nota }) },
    ),
}
