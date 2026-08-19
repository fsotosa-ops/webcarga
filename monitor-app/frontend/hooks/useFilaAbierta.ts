'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, type KeyboardEvent } from 'react'

/** El nombre del parámetro, escrito una vez. Quien enlace a una fila abierta
 *  desde otra vista usa `enlaceAFilaAbierta()`, no arma la cadena a mano. */
const PARAM = 'abierta'

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
 *
 * **La fila abierta vive en la URL, no en `useState`.** Con estado local,
 * llegar desde otra vista con una fila ya abierta obliga a sembrar el estado
 * inicial desde un prop y a resincronizarlo cuando ese prop cambia — que es
 * exactamente el bug que este frontend ya tuvo tres veces (ContactCard,
 * TransporterDocumentsPanel, y evitado a último momento en PolicyLinkRow).
 * En la URL no hay nada que resincronizar, y de yapa el botón atrás funciona
 * y el enlace se puede compartir.
 */
export function useFilaAbierta() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const abierta = searchParams.get(PARAM)

  const alternar = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (params.get(PARAM) === id) params.delete(PARAM)
      else params.set(PARAM, id)
      const qs = params.toString()
      // `replace` y no `push`: abrir y cerrar filas no es navegación, y con
      // `push` el botón atrás tendría que deshacer cada clic antes de sacarte
      // de la pantalla. Es el mismo criterio que ya usa cambiar de vista.
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  return { abierta, alternar, esAbierta: (id: string) => abierta === id }
}

/** Enlace a otra vista con una fila ya abierta.
 *
 *  Existe para que "ir a esta empresa" no se escriba a mano en cada lista: es
 *  una sola forma de nombrar dónde estás, y por eso vive junto al hook que la
 *  lee. Si mañana el parámetro cambia de nombre, cambia acá y en ningún otro
 *  lado. */
export function enlaceAFilaAbierta(pathname: string, id: string, vista?: string) {
  const params = new URLSearchParams()
  if (vista) params.set('vista', vista)
  params.set(PARAM, id)
  return `${pathname}?${params}`
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
  /** El rol lo decide el ELEMENTO, no este helper.
   *
   *  Un `<div>` no tiene rol y necesita `'button'`. Un `<tr>` ya es
   *  `role="row"`, y pisarlo con `'button'` **destruye la tabla**: el árbol de
   *  accesibilidad pasa a mostrar `button > cell`, o sea celdas sin fila, y un
   *  lector de pantalla deja de poder recorrerla.
   *
   *  Se encontró mirando la pantalla desplegada, no con los tests: jsdom no
   *  calcula el árbol de accesibilidad, así que la aserción "es una fila"
   *  pasaba igual. Por eso el default es el caso que necesita rol explícito y
   *  quien ya tiene uno pasa `null`. */
  role: 'button' | null = 'button',
) {
  return {
    ...(role ? { role } : {}),
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
