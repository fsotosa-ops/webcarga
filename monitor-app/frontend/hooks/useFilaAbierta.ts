'use client'

import { useCallback, useState, type KeyboardEvent } from 'react'

/**
 * "Una sola fila abierta a la vez", con su razón, en un solo lugar.
 *
 * El embudo de Certificación lo resolvió primero, y la razón está medida: el
 * cajón de una empresa con 9 sujetos medía 3.159px contra 633px de lista
 * visible. Con dos filas abiertas, comparar obliga a recorrer cinco pantallas
 * — exactamente lo que el cajón vino a evitar.
 *
 * Vive acá y no en cada lista porque este proyecto ya paga caro la regla
 * escrita a mano N veces: el criterio del "universo de viajes del día" quedó
 * copiado catorce veces y fue la causa de cuatro errores de conteo distintos.
 * Certificación tiene cuatro listas del mismo objeto; la regla se escribe una.
 */
export function useFilaAbierta() {
  const [abierta, setAbierta] = useState<string | null>(null)

  const alternar = useCallback((id: string) => {
    setAbierta((prev) => (prev === id ? null : id))
  }, [])

  return { abierta, alternar, esAbierta: (id: string) => abierta === id }
}

/**
 * El contrato de teclado y de lectores de pantalla de una fila que se abre.
 *
 * Es la parte que se degrada en silencio al copiarla: se olvida la barra
 * espaciadora, o el `aria-expanded`, y la lista sigue funcionando con el mouse
 * mientras deja de funcionar con el teclado. Nada lo detecta mirando la
 * pantalla.
 *
 * Devuelve props sueltas a propósito, no un componente: la fila del embudo es
 * un `<div>` y la de la tabla es un `<tr>`, y un envoltorio que imponga el
 * markup obligaría a una de las dos a deformarse.
 */
export function propsDeFilaExpandible(
  id: string,
  abierta: boolean,
  alternar: (id: string) => void,
) {
  return {
    role: 'button',
    tabIndex: 0,
    'aria-expanded': abierta,
    onClick: () => alternar(id),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        alternar(id)
      }
    },
  } as const
}
