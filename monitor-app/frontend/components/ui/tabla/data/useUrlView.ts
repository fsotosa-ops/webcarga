'use client'

import { useCallback, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { readView, writeView, type TableView } from '@/lib/table/viewInUrl'

/** La vista de la tabla de la pantalla, leída y escrita en la URL (spec §4.2).
 *
 *  Se escribe con `history.replaceState`, no con `router.replace`: filtrar no es
 *  navegar ("atrás" sale de la pantalla, no deshace filtros de a uno) y no necesita
 *  al servidor. Next sincroniza `useSearchParams` con el historial. Con
 *  `router.replace`, cada filtro era una ida y vuelta al servidor, y dos seguidos
 *  podían terminar con la URL de antes (medido en el humo del 16/10: el filtro de
 *  Empresa borraba el del recuadro).
 *
 *  La vista es la que se escribió hasta que la URL la confirma: el segundo clic parte
 *  del primero y la búsqueda no retrocede (revisión final, 16/10). La URL manda cuando
 *  cambia por otra causa ("Volver", un enlace, otra pestaña del Cierre). */
export function useUrlView(): [TableView, (view: TableView) => void] {
  const pathname = usePathname()
  const params = useSearchParams()
  const clave = params.toString()

  // `pendientes`: las consultas que esta vista escribió y la URL todavía no confirmó.
  const [vista, setVista] = useState(() => ({
    clave, view: readView(new URLSearchParams(clave)), pendientes: [] as string[],
  }))

  if (clave !== vista.clave) {
    const i = vista.pendientes.indexOf(clave)
    setVista(i >= 0
      // Confirmó una escritura propia: la vista ya la tiene (o una más nueva).
      ? { ...vista, clave, pendientes: vista.pendientes.slice(i + 1) }
      : { clave, view: readView(new URLSearchParams(clave)), pendientes: [] })
  }

  // De qué consulta parte la próxima escritura: la última escrita, aunque no haya vuelto.
  const base = useRef(clave)
  base.current = vista.pendientes.at(-1) ?? clave

  const setView = useCallback((next: TableView) => {
    const s = writeView(new URLSearchParams(base.current), next).toString()
    base.current = s
    setVista(v => ({ ...v, view: next, pendientes: [...v.pendientes, s] }))
    // `null`: Next sincroniza useSearchParams solo si el estado no es el suyo propio.
    window.history.replaceState(null, '', s ? `${pathname}?${s}` : pathname)
  }, [pathname])

  return [vista.view, setView]
}
