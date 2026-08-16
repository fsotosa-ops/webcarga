'use client'

import type { ReactNode } from 'react'
import { OrdenIcono } from './OrdenIcono'
import type { Orden } from './useOrden'

/** El `<th>` que ordena.
 *
 *  El boton adentro del th, y no el th clicable, para que el orden de
 *  tabulacion y el anillo de foco salgan del navegador en vez de reimplementarse
 *  (regla de severidad alta de ui-ux-pro-max). `aria-sort` es como un lector de
 *  pantalla sabe que la tabla esta ordenada. */
export function EncabezadoOrdenable({
  columna, orden, onOrdenar, children, className = '',
}: {
  columna:    string
  orden:      Orden
  onOrdenar:  (columna: string) => void
  children:   ReactNode
  className?: string
}) {
  const activo = orden?.columna === columna
  return (
    <th
      scope="col"
      aria-sort={activo ? (orden!.direccion === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[.08em] text-gray-400 ${className}`}
    >
      <button
        type="button"
        onClick={() => onOrdenar(columna)}
        className="inline-flex items-center hover:text-gray-600 transition-colors
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
      >
        {children}
        <OrdenIcono activo={activo} direccion={orden?.direccion ?? 'asc'} />
      </button>
    </th>
  )
}
