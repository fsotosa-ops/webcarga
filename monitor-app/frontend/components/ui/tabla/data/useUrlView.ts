'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { isAllView, markAllView, readView, writeView, type TableView } from '@/lib/table/viewInUrl'

const isEmpty = (v: TableView) => !Object.keys(v.filters).length && !v.q && !v.sort

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
 *  cambia por otra causa ("Volver", un enlace, otra pestaña del Cierre).
 *
 *  `initial`: la vista con que abre la pantalla cuando la URL no trae ninguna (Seguros ›
 *  Empresas abre en "No al día"). Se escribe en la URL al entrar, así se comparte y se
 *  ve como un filtro más. Vaciar la vista deja `view=all` en la URL: Atrás y los
 *  marcadores la encuentran vacía en vez de volver a la inicial. Un enlace con su propia
 *  vista (`?q=RUT`) manda sobre ella. */
export function useUrlView({ initial }: { initial?: TableView } = {}): [TableView, (view: TableView) => void] {
  const pathname = usePathname()
  const params = useSearchParams()
  const clave = params.toString()

  // `pendientes`: las consultas que esta vista escribió y la URL todavía no confirmó.
  // Al entrar sin vista en la URL, la inicial; un efecto la escribe en la URL (una vez).
  const [usaInicial] = useState(() => {
    const p = new URLSearchParams(clave)
    return !!initial && isEmpty(readView(p)) && !isAllView(p)
  })
  const [vista, setVista] = useState(() => ({
    clave,
    view: usaInicial && initial ? initial : readView(new URLSearchParams(clave)),
    pendientes: [] as string[],
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
    // Solo una tabla con vista inicial necesita decir que está vacía a propósito.
    const s = markAllView(writeView(new URLSearchParams(base.current), next), !!initial && isEmpty(next)).toString()
    base.current = s
    setVista(v => ({ ...v, view: next, pendientes: [...v.pendientes, s] }))
    // `null`: Next sincroniza useSearchParams solo si el estado no es el suyo propio.
    window.history.replaceState(null, '', s ? `${pathname}?${s}` : pathname)
  }, [pathname, initial])

  useEffect(() => {
    if (usaInicial && initial) setView(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- una sola vez, al entrar
  }, [])

  return [vista.view, setView]
}
