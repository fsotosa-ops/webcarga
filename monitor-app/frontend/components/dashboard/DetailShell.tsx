'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export type DetailVariant = 'dialog' | 'page'

/** La pestaña de la ficha propia que el panel dibuja. Sin ella, el panel
 *  muestra todo junto, como en el modal. */
export type DetailSection = 'resumen' | 'documentos' | 'contactos'

/** La columna de datos: al costado en el modal; sola, como pestaña Resumen, en
 *  la ficha propia. */
export function summaryColumnClass(section?: DetailSection): string {
  return section
    ? 'w-full max-w-xl p-5 md:p-6'
    : 'sm:w-[320px] shrink-0 bg-gray-50 border-b sm:border-b-0 sm:border-r border-border overflow-y-auto p-5'
}

/**
 * El armazón de la ficha de un conductor o un equipo. Es el mismo contenido en
 * dos lugares (D4, Entrega C 14/10): como modal sobre la ficha de su empresa, y
 * como página propia (`/dashboard/drivers/[id]`, `/dashboard/assets/[id]`). Una
 * variante es una prop: el modal (fondo, foco atrapado, Escape, cerrar) vive
 * acá una sola vez en vez de copiado en cada panel.
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

  useEffect(() => {
    if (!dialog) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
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
