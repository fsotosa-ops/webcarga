'use client'

import { useCallback, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { readView, writeView, type TableView } from '@/lib/table/viewInUrl'

/** La vista de la tabla de la pantalla, leída y escrita en la URL (spec §4.2).
 *  `replace` y no `push`: filtrar no es navegar, y "atrás" tiene que salir de la
 *  pantalla, no deshacer filtros de a uno.
 *
 *  `router.replace` llega a la URL recién cuando Next la confirma (una ida y vuelta).
 *  Mientras tanto la vista es la que se escribió: si no, el segundo clic de un filtro
 *  partía de la vista vieja y borraba el primero, y la búsqueda devolvía al campo lo
 *  que se había escrito antes (revisión final, 16/10). La URL manda cuando cambia por
 *  otra causa ("Volver", un enlace); la confirmación de una escritura propia, no. */
export function useUrlView(): [TableView, (view: TableView) => void] {
  const router = useRouter()
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
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false })
  }, [router, pathname])

  return [vista.view, setView]
}
