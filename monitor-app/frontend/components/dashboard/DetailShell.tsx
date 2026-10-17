'use client'

import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'

export type DetailVariant = 'dialog' | 'page'

/**
 * El armazón de la ficha de un conductor o un equipo: como página, o como ventana
 * sobre la ficha de su empresa (`FleetProfile variant="dialog"`, Entrega 1 de fichas).
 * La ventana es la `Dialog` del kit (fondo, foco, Escape, Tab y capas); aquí solo el
 * marco grande y el botón de cerrar.
 */
export function DetailShell({ variant, label, onClose, children }: {
  variant: DetailVariant
  label: string
  /** Solo en la ventana. */
  onClose?: () => void
  children: ReactNode
}) {
  if (variant === 'page' || !onClose) {
    return (
      <section aria-label={label} className="bg-white rounded-2xl border border-border overflow-hidden flex flex-col sm:flex-row">
        {children}
      </section>
    )
  }
  return (
    <Dialog
      label={label}
      onClose={onClose}
      // `inset-0 m-auto` centra sin `transform`, que la animación de entrada ya usa.
      className="inset-0 m-auto flex h-[85vh] w-[92vw] max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-modal-in sm:flex-row"
    >
      <button onClick={onClose} aria-label="Cerrar detalle"
        className="absolute right-4 top-4 z-10 rounded text-informativo hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
        <X size={18} />
      </button>
      {children}
    </Dialog>
  )
}
