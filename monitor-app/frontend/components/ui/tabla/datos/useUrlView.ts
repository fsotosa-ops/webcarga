'use client'

import { useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { readView, writeView, type TableView } from '@/lib/tabla/vistaEnUrl'

/** La vista de la tabla de la pantalla, leída y escrita en la URL (spec §4.2).
 *  `replace` y no `push`: filtrar no es navegar, y "atrás" tiene que salir de la
 *  pantalla, no deshacer filtros de a uno. */
export function useUrlView(): [TableView, (view: TableView) => void] {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const clave = params.toString()
  const view = useMemo(() => readView(new URLSearchParams(clave)), [clave])
  const setView = useCallback((next: TableView) => {
    const s = writeView(new URLSearchParams(clave), next).toString()
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false })
  }, [router, pathname, clave])
  return [view, setView]
}
