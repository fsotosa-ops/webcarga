'use client'

import type { MouseEvent } from 'react'
import type { EntityKind } from '@/lib/api/entitySummary'
import type { QuickViewTarget } from '@/lib/quickView'
import { assetHref, carrierHref, driverHref } from '@/lib/navegacion/directory'
import { useOpenQuickView } from './QuickViewProvider'

const NOUN: Record<EntityKind, string> = { carrier: 'empresa', driver: 'conductor', asset: 'equipo' }
const HREF: Record<EntityKind, (id: string) => string> = { carrier: carrierHref, driver: driverHref, asset: assetHref }

interface EntityCellProps {
  kind:  EntityKind
  /** El id en el directorio; null si lo que se ve no cruzó con él. */
  id:    string | null | undefined
  label: string | null | undefined
  /** Abre la vista rápida. Sin él, la abre el proveedor del dashboard; sin
   *  ninguno de los dos (sin `directory.read`), la celda es texto. */
  onOpen?: (target: QuickViewTarget) => void
  /** Lo que se ve viene del TMS sin cruzar con el directorio: se dice. */
  unresolved?: boolean
  /** Qué mostrar cuando no hay dato. */
  empty?: string
  mono?: boolean
}

/** El nombre de una empresa, un conductor o un equipo en cualquier pantalla:
 *  azul y clicable solo si está en el directorio (HU 20261011/01). Es un enlace
 *  de verdad a su ficha (Entrega 1 de fichas, 15/10): el clic abre la vista
 *  rápida, y con Ctrl/Cmd/Shift o el botón del medio el navegador abre la ficha
 *  (otra pestaña), como cualquier enlace. */
export function EntityCell({ kind, id, label, onOpen, unresolved = false, empty = '—', mono = false }: EntityCellProps) {
  const fromProvider = useOpenQuickView()
  const open = onOpen ?? fromProvider
  const font = mono ? 'font-identificador tabular-nums' : ''
  if (!label) return <span className="text-informativo">{empty}</span>
  if (id && open) {
    const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
      // En una fila clicable, el nombre no selecciona además la fila.
      e.stopPropagation()
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
      e.preventDefault()
      open({ kind, id, label })
    }
    return (
      <a href={HREF[kind](id)} data-panel-trigger onClick={onClick} aria-label={`Ver ${NOUN[kind]} ${label}`}
         className={`text-left text-accion underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded ${font}`}>
        {label}
      </a>
    )
  }
  return (
    <span className={font}>
      {label}
      {unresolved && !id && <span className="block text-etiqueta text-informativo">no está en el directorio</span>}
    </span>
  )
}
