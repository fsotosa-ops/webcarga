'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useLayer } from '@/lib/ui/layers'

export type DetailVariant = 'dialog' | 'page'

/**
 * El armazón de la ficha de un conductor o un equipo cuando se abre como modal
 * sobre la ficha de su empresa (`FleetProfile variant="dialog"`, Entrega 1 de
 * fichas): fondo, foco atrapado, Escape y cerrar, en un solo lugar.
 */
export function DetailShell({ variant, label, onClose, children }: {
  variant: DetailVariant
  label: string
  /** Solo en el modal. */
  onClose?: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dialog = variant === 'dialog'
  // Solo la capa de arriba atiende Escape y atrapa Tab (la vista rápida puede abrirse encima).
  const isTop = useLayer(dialog)

  useEffect(() => {
    if (!dialog) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return
      if (e.key === 'Escape') { onClose?.(); return }
      if (e.key === 'Tab' && ref.current) {
        const focusables = ref.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (!focusables.length) return
        const first = focusables[0]
        const last  = focusables[focusables.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || active === ref.current)) {
          e.preventDefault(); last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault(); first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [dialog, onClose])

  if (!dialog) {
    return (
      <section aria-label={label} className="bg-white rounded-2xl border border-border overflow-hidden flex flex-col sm:flex-row">
        {children}
      </section>
    )
  }
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          className="relative bg-white rounded-2xl shadow-2xl w-[92vw] max-w-6xl h-[85vh] overflow-hidden flex flex-col sm:flex-row focus:outline-none animate-modal-in"
        >
          <button onClick={onClose} aria-label="Cerrar detalle" className="absolute top-4 right-4 z-10 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
          {children}
        </div>
      </div>
    </>
  )
}
