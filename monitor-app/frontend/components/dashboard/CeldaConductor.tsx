'use client'

import { TEXTO_APOYO } from '@/lib/ui/texto'
import { nombreLegible } from '@/lib/utils/nombres'

type Props = {
  /** Nombre del roster: hay conductor vinculado. */
  driverName: string | null
  /** RUT del roster — la prueba de identidad de la fila resuelta. */
  driverRut?: string | null
  /** Lo que reporta el TMS, siempre visible. */
  driverNameTms: string | null
  puedeEditar?: boolean
  onAsignar: () => void
}

/**
 * La celda de conductor: el dato y el control son la misma cosa.
 *
 * Tres decisiones, ninguna cosmética:
 *
 * 1. **El valor crudo siempre se ve.** Nunca un guión. El nombre que reporta
 *    el TMS es la única pista que tiene quien decide, y esconderlo es
 *    justamente lo que ningún producto de conciliación hace (QuickBooks,
 *    Ramp). Antes esta celda decía «sin asignar», que no ayuda a nadie.
 * 2. **La celda ES el botón**, como el campo de persona en Linear, Notion o
 *    Airtable. Un botón aparte agrega un objetivo de clic y una decisión más.
 * 3. **Sin chip de color por fila.** Con 208 filas marcadas nada es señal. La
 *    pendiente se distingue por peso y borde punteado, y donde la resuelta
 *    muestra el RUT, ella dice «Sin registrar»: misma posición, misma altura
 *    de fila. El aviso vive una sola vez arriba, convertido en filtro — y esa
 *    es la condición dura del diseño: si el contador queda decorativo, el
 *    trabajo se esconde y hay que volver al chip.
 */
export function CeldaConductor({
  driverName,
  driverRut,
  driverNameTms,
  puedeEditar = true,
  onAsignar,
}: Props) {
  const resuelto = Boolean(driverName)
  const mostrado = driverName ?? driverNameTms

  // Ni roster ni TMS: decirlo, no dibujar un hueco que parezca pendiente de
  // nuestra acción. Acá no hay nada que asignar porque no hay a quién.
  if (!mostrado) {
    return (
      <span className={`text-etiqueta italic leading-snug ${TEXTO_APOYO}`}>
        El TMS no reportó conductor
      </span>
    )
  }

  const contenido = (
    <>
      <span className="line-clamp-2">{nombreLegible(mostrado)}</span>
      <span className={`block font-identificador text-etiqueta mt-0.5 ${TEXTO_APOYO}`}>
        {resuelto ? (driverRut ?? '—') : 'Sin registrar'}
      </span>
    </>
  )

  if (!puedeEditar) {
    return (
      <span
        className={`block text-dato leading-snug max-w-[152px] ${
          resuelto ? 'text-text-primary font-medium' : TEXTO_APOYO
        }`}
        title={mostrado}
      >
        {contenido}
      </span>
    )
  }

  return (
    <button
      type="button"
      // Sólo el CONTROL frena el clic. Si la celda entera lo frenara, en
      // modo lectura —donde no hay control— dejaría de abrir el detalle, que
      // es lo que la fila hace en todas las demás columnas.
      onClick={e => { e.stopPropagation(); onAsignar() }}
      title={mostrado}
      className={[
        'block text-left text-dato leading-snug max-w-[152px]',
        'rounded-md border px-1.5 py-0.5 -mx-1.5 -my-0.5 transition-colors',
        resuelto
          ? 'border-transparent text-text-primary font-medium hover:border-border hover:bg-bg-main'
          : `border-dashed border-border hover:border-accent hover:bg-accent/5 ${TEXTO_APOYO}`,
      ].join(' ')}
    >
      {contenido}
    </button>
  )
}
