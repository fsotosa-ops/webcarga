'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useLayer } from '@/lib/ui/layers'

/** Un panel que se abre bajo un botón (filtros, menús de la tabla): en un portal
 *  para que ningún `overflow` lo recorte, ubicado bajo su ancla y dentro de la
 *  pantalla, en la pila de capas (Escape cierra solo el de arriba) y con cierre al
 *  hacer clic afuera. Una sola pieza para todos: antes cada popover traía su copia
 *  de este comportamiento. */
export function Popover({ anchor, open, onClose, label, align = 'start', width = 256, children, onKeyDown }: {
  anchor: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  /** El nombre accesible del panel. */
  label: string
  /** Alineado al borde izquierdo (`start`) o derecho (`end`) del ancla. */
  align?: 'start' | 'end'
  width?: number
  children: ReactNode
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const esLaDeArriba = useLayer(open)

  useLayoutEffect(() => {
    if (!open || !anchor.current) return
    const r = anchor.current.getBoundingClientRect()
    const izquierda = align === 'end' ? r.right - width : r.left
    setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(izquierda, window.innerWidth - width - 8)) })
  }, [open, anchor, align, width])

  useEffect(() => {
    if (!open) return
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && esLaDeArriba()) { onClose(); anchor.current?.focus() }
    }
    const fuera = (e: MouseEvent) => {
      const t = e.target as Node
      if (!panel.current?.contains(t) && !anchor.current?.contains(t)) onClose()
    }
    document.addEventListener('keydown', tecla)
    document.addEventListener('mousedown', fuera)
    return () => { document.removeEventListener('keydown', tecla); document.removeEventListener('mousedown', fuera) }
  }, [open, onClose, anchor, esLaDeArriba])

  if (!open) return null
  return createPortal(
    <div ref={panel} role="dialog" aria-label={label} onKeyDown={onKeyDown}
      style={{ width, ...(pos ?? {}) }}
      className="fixed z-50 rounded-xl border border-border bg-white p-2 shadow-lg">
      {children}
    </div>,
    document.body,
  )
}
