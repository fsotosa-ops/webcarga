'use client'

import { Truck } from 'lucide-react'
import type { SinFlota } from '@/lib/api/dailyClosures'

/**
 * Los viajes que bloquean el cierre porque su flota no está en el directorio.
 *
 * POR QUÉ EXISTE. El backend manda estos casos en `detail.sin_flota` del 409
 * desde el 2026-08-23, y **hasta el 27/08 nadie los leía**: los dos diálogos de
 * cierre mostraban `detail.pending` (los conductores) y el texto del mensaje.
 * O sea el coordinador leía "3 viajes con flota fuera del directorio" y no
 * tenía forma de saber cuáles eran los tres. Un número sin sus filas no dice
 * qué hacer.
 *
 * Se escribe UNA vez y la usan los dos diálogos —`CloseDayDialog` y la página
 * `/operations/closures`—, que ya tenían este mismo bloque duplicado para los
 * conductores.
 *
 * Cada tipo dice lo suyo: no es lo mismo "esta patente no existe" que "esta
 * empresa está en onboarding", y la acción que destraba cada uno es distinta.
 */
export function SinFlotaList({ casos }: { casos: SinFlota[] }) {
  if (!casos.length) return null
  return (
    <div className="mt-2">
      <p className="text-[11px] font-semibold text-status-incidente flex items-center gap-1">
        <Truck size={11} /> Viajes con flota fuera del directorio ({casos.length})
      </p>
      <ul className="mt-1 space-y-0.5 text-[11px] text-status-incidente list-disc list-inside">
        {casos.map((c, i) => (
          <li key={`${c.tipo}-${c.tractor_plate ?? c.driver_rut ?? c.carrier_id ?? i}`}>
            {describir(c)}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** La frase que corresponde a cada escalación, con el dato que la identifica.
 *  El `default` no es defensa vacía: si el backend agrega un tipo nuevo, es
 *  preferible mostrarlo crudo antes que hacerlo desaparecer de una lista que
 *  el usuario usa para saber por qué no puede cerrar. */
function describir(c: SinFlota): string {
  switch (c.tipo) {
    case 'PATENTE_NO_REGISTRADA':
      return `Patente ${c.tractor_plate ?? '(sin patente)'}: ${c.reason ?? 'no está en el directorio'}`
    case 'CONDUCTOR_NO_REGISTRADO':
      return c.reason
        ? `RUT ${c.driver_rut}: ${c.reason}`
        : `Conductor con RUT ${c.driver_rut} no registrado`
    case 'EMPRESA_NO_RECONOCIDA':
      return `Patente ${c.tractor_plate}: el TMS informa "${c.tms_carrier_name}" y el directorio "${c.directory_carrier_name}"`
    case 'EMPRESA_ONBOARDING':
      return `${c.carrier_name} todavía está en onboarding`
    default:
      return `${c.tipo}${c.tractor_plate ? ` · ${c.tractor_plate}` : ''}`
  }
}
