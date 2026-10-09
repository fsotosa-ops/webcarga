'use client'

import type { ExigibleOn } from '@/lib/types'

/** Desde cuándo se exige un documento (HU-C1, entrega 2b). Mismo control al
 *  crear y al editar.
 *
 *  "Al mes siguiente del ingreso" y "al término" solo existen para conductores:
 *  son su asignación a una empresa (la base lo exige con un CHECK). */
export const OPCIONES_DE_EXIGIBILIDAD: {
  valor: ExigibleOn; texto: string; corto: string; ayuda: string; soloConductor?: boolean
}[] = [
  { valor: 'ON_ENTITY_START', texto: 'Desde que la empresa o el conductor entra', corto: 'Al ingresar',
    ayuda: 'Se pide a todos apenas se activa el documento.' },
  { valor: 'MONTH_AFTER_START', texto: 'Desde el mes siguiente al ingreso del conductor',
    corto: 'Mes siguiente al ingreso',
    ayuda: 'Ej. liquidación de sueldo, cotizaciones.', soloConductor: true },
  { valor: 'ON_ENTITY_END', texto: 'Cuando el conductor deja la empresa', corto: 'Al término',
    ayuda: 'Ej. finiquito. Se le pide a la empresa que deja.', soloConductor: true },
  { valor: 'ON_REQUEST', texto: 'Solo cuando se le solicita', corto: 'Solo si se pide',
    ayuda: 'No se pide a nadie al activarlo: se solicita desde la ficha (ej. trabajo en altura).' },
]

/** Las que valen para una entidad: la base rechaza las de conductor en otra. */
export function exigibilidadesPara(entidad: 'CARRIER' | 'DRIVER' | 'ASSET') {
  return OPCIONES_DE_EXIGIBILIDAD.filter(o => !o.soloConductor || entidad === 'DRIVER')
}

export function SelectorExigibilidad({ value, onChange, entidad, disabled = false }: {
  value: ExigibleOn
  onChange: (v: ExigibleOn) => void
  entidad: 'CARRIER' | 'DRIVER' | 'ASSET'
  disabled?: boolean
}) {
  return (
    <fieldset className="mt-4">
      <legend className="text-xs font-semibold text-text-primary">¿Cuándo se exige?</legend>
      {exigibilidadesPara(entidad).map(o => (
        <label key={o.valor} className="mt-2 flex cursor-pointer items-start gap-2 text-dato text-text-primary">
          <input
            type="radio"
            name="cuando-se-exige"
            aria-label={o.texto}
            checked={value === o.valor}
            disabled={disabled}
            onChange={() => onChange(o.valor)}
            className="mt-0.5 accent-accent"
          />
          <span>
            {o.texto}
            <span className="block text-etiqueta text-informativo">{o.ayuda}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}
