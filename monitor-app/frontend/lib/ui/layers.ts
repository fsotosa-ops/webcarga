import { useCallback, useEffect, useRef } from 'react'

/** Las capas abiertas (modales y paneles), la última arriba. Varias escuchan el
 *  teclado en `document`; solo la de arriba atiende Escape y atrapa Tab. Sin
 *  esto, Escape sobre la vista rápida abierta encima de un modal cerraba los
 *  dos (revisión final de la Entrega 1 de fichas, 15/10). */
const stack: symbol[] = []

/** Registra la capa mientras está abierta y devuelve si es la de arriba. */
export function useLayer(open: boolean = true): () => boolean {
  const id = useRef(Symbol('capa'))
  useEffect(() => {
    if (!open) return
    const me = id.current
    stack.push(me)
    return () => {
      const i = stack.lastIndexOf(me)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [open])
  return useCallback(() => stack[stack.length - 1] === id.current, [])
}
