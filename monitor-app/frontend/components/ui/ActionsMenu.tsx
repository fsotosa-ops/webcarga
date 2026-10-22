'use client'

import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal, type LucideIcon } from 'lucide-react'

export type ActionsMenuItem = {
  id: string
  label: string
  icon?: LucideIcon
  /** En rojo: lo que da de baja, quita o elimina. La confirmación la pone quien
   *  lo ejecuta (con su vista previa del impacto, si la tiene). */
  destructive?: boolean
  onSelect: () => void
}

/** El "⋯" de una ficha (kit de la Entrega 1 de fichas, 15/10): lo que no es la
 *  acción principal, y todo lo destructivo, fuera del cuerpo. Quien lo usa pasa
 *  solo lo que el permiso habilita; sin opciones, no se dibuja. */
export function ActionsMenu({ label, items, disabled = false }: {
  label: string
  items: ActionsMenuItem[]
  /** Mientras la acción anterior está en curso: el menú no se abre (evita repetirla). */
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (items.length === 0) return null

  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled}
              onClick={() => setOpen(o => !o)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-white text-informativo hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50">
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label={label}
             onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
             className="absolute right-0 z-20 mt-1 min-w-52 rounded-lg border border-border bg-white py-1 shadow-lg">
          {items.map(({ id, label: text, icon: Icon, destructive, onSelect }) => (
            <button key={id} type="button" role="menuitem"
                    onClick={() => { setOpen(false); onSelect() }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-dato hover:bg-bg-main ${
                      destructive ? 'text-status-incidente' : 'text-text-primary'}`}>
              {Icon && <Icon size={14} aria-hidden="true" />}
              {text}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
