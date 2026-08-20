'use client'

import { useEffect, useRef, useState } from 'react'
import { MoreVertical, ArrowRightLeft, UserMinus } from 'lucide-react'

interface Props {
  nombreEmpresa:  string
  onTransferir:   () => void
  onDarDeBaja:    () => void
  deshabilitado?: boolean
}

/** El menú `⋮` de la cabecera de un sujeto (conductor o vehículo) en la
 *  ficha de Certificación. Sólo dos acciones — la baja del sistema queda
 *  fuera de este plan, no va acá.
 *
 *  `deshabilitado` cierra el disparador entero (no sólo los ítems): mientras
 *  una transferencia o una baja está en vuelo no tiene sentido abrir el
 *  menú para disparar la otra. */
export function AccionesDeSujeto({ nombreEmpresa, onTransferir, onDarDeBaja, deshabilitado }: Props) {
  const [abierto, setAbierto] = useState(false)
  const menuRef   = useRef<HTMLDivElement>(null)
  const botonRef  = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!abierto) return
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setAbierto(false); botonRef.current?.focus() }
    }
    const alClic = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !botonRef.current?.contains(e.target as Node)) {
        setAbierto(false)
      }
    }
    window.addEventListener('keydown', alTeclado)
    window.addEventListener('mousedown', alClic)
    return () => {
      window.removeEventListener('keydown', alTeclado)
      window.removeEventListener('mousedown', alClic)
    }
  }, [abierto])

  return (
    <div className="relative inline-block">
      <button
        ref={botonRef}
        type="button"
        aria-label="Acciones"
        aria-haspopup="menu"
        aria-expanded={abierto}
        disabled={deshabilitado}
        onClick={() => setAbierto(v => !v)}
        className="flex items-center justify-center w-8 h-8 rounded-lg border border-border bg-white text-informativo hover:text-text-primary hover:border-text-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <MoreVertical size={16} aria-hidden="true" />
      </button>

      {abierto && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Acciones"
          className="absolute right-0 top-full mt-1.5 z-30 w-56 bg-white border border-border rounded-xl shadow-xl py-1.5 animate-modal-in"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => { setAbierto(false); onTransferir() }}
            className="flex items-center gap-2 w-full px-3 py-2 text-left text-dato text-text-primary hover:bg-bg-main transition-colors"
          >
            <ArrowRightLeft size={14} className="text-informativo" aria-hidden="true" />
            Transferir a otra empresa
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setAbierto(false); onDarDeBaja() }}
            className="flex items-center gap-2 w-full px-3 py-2 text-left text-dato text-text-primary hover:bg-bg-main transition-colors"
          >
            <UserMinus size={14} className="text-informativo" aria-hidden="true" />
            Dar de baja de {nombreEmpresa}
          </button>
        </div>
      )}
    </div>
  )
}
