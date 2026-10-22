'use client'

import { useEffect } from 'react'

/** Aviso al salir con cambios sin guardar (spec 2026-10-22 §3.1).
 *
 *  Mientras algún formulario tenga cambios, un clic en cualquier enlace de la app
 *  —el índice, el menú lateral, las migas— pregunta antes de salir, y el navegador
 *  pregunta al cerrar o recargar la pestaña. Se escucha en el documento, en captura,
 *  para llegar antes que el `Link` de Next; si la persona cancela, el clic no sigue.
 *
 *  Lo que NO cubre: el botón Atrás del navegador. No se puede cancelar un `popstate`,
 *  y simularlo con entradas falsas en el historial choca con el router de Next.
 *
 *  Cuenta cuántos formularios tienen cambios (no una bandera): con dos en la misma
 *  página, uno sin cambios no apaga el aviso del otro (menor diferido 1, 22/10). */
export const LEAVE_QUESTION = 'Tienes cambios sin guardar. ¿Salir igual?'

let conCambios = 0

function esSalidaDeLaPagina(e: MouseEvent): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false
  const enlace = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
  if (!enlace || (enlace.target && enlace.target !== '_self') || enlace.hasAttribute('download')) return false
  const destino = new URL(enlace.href, window.location.href)
  if (destino.origin !== window.location.origin) return false
  // Un ancla en la misma página no sale de ella.
  return destino.pathname !== window.location.pathname || destino.search !== window.location.search
}

function alHacerClic(e: MouseEvent) {
  if (!esSalidaDeLaPagina(e)) return
  if (window.confirm(LEAVE_QUESTION)) return
  e.preventDefault()
  e.stopPropagation()
}

function antesDeCerrar(e: BeforeUnloadEvent) {
  e.preventDefault()
  e.returnValue = ''
}

export function useUnsavedChanges(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return
    if (conCambios++ === 0) {
      document.addEventListener('click', alHacerClic, true)
      window.addEventListener('beforeunload', antesDeCerrar)
    }
    return () => {
      if (--conCambios === 0) {
        document.removeEventListener('click', alHacerClic, true)
        window.removeEventListener('beforeunload', antesDeCerrar)
      }
    }
  }, [dirty])
}
