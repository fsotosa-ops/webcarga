'use client'

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { usePathname } from 'next/navigation'
import { ChevronsUpDown } from 'lucide-react'
import { getInitials } from '@/lib/utils/avatar'
import { AccountActions, SETTINGS_HREF } from './AccountActions'

interface SidebarAccountProps {
  displayName:  string
  email:        string
  /** Nombre del rol principal (GET /me). */
  roleName:     string | null
  collapsed:    boolean
  /** Si ofrece Configuración (`puedeVerConfiguracion`). */
  canConfigure: boolean
  onSignOut:    () => void
}

/** La cuenta de quien está conectado, al pie de la barra lateral: un solo
 *  botón que abre el menú con Configuración, Cambiar contraseña y Cerrar sesión.
 *
 *  Antes la identidad vivía en una barra superior de 56 px que no tenía nada
 *  más, Configuración era una sección propia del menú y las acciones de cuenta
 *  iban en dos filas fijas abajo: lo mismo repartido en tres lugares. Va junto,
 *  como en Linear, Vercel o Notion (pedido del usuario, 11/10).
 *
 *  Menú WAI-ARIA: al abrirse enfoca el primer ítem, las flechas lo recorren,
 *  Escape lo cierra devolviendo el foco al botón, y un clic afuera o un cambio
 *  de ruta lo cierran. Mismo patrón que `AccionesDeSujeto`. */
export default function SidebarAccount({
  displayName, email, roleName, collapsed, canConfigure, onSignOut,
}: SidebarAccountProps) {
  const pathname   = usePathname()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef    = useRef<HTMLDivElement>(null)

  const isSettingsActive = pathname.startsWith(SETTINGS_HREF)
  const identity = roleName ? `${displayName}, ${roleName}` : displayName

  // Navegar desde el menú lo cierra: un Link no desmonta la barra lateral.
  useEffect(() => { setOpen(false) }, [pathname])

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [open])

  function handleMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLElement)
    const next =
      e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
      : e.key === 'ArrowDown' ? (current + 1) % items.length
      : (current - 1 + items.length) % items.length
    items[next].focus()
  }

  return (
    <div className="relative px-2.5 pb-3 pt-3 border-t border-white/8">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Cuenta de ${identity}`}
        title={collapsed ? identity : undefined}
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center rounded-xl transition-colors duration-150 hover:bg-white/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
          open || isSettingsActive ? 'bg-white/6' : ''
        } ${collapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-2.5 px-2 py-2'}`}
      >
        <span
          aria-hidden="true"
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-accent/15 text-accent text-xs font-semibold"
        >
          {getInitials(displayName)}
        </span>
        {!collapsed && (
          <>
            <span className="flex-1 min-w-0 text-left" aria-hidden="true">
              <span className="block text-[13px] font-medium text-white leading-tight truncate">{displayName}</span>
              {roleName && <span className="block text-xs text-white/45 leading-tight truncate">{roleName}</span>}
            </span>
            <ChevronsUpDown size={14} className="shrink-0 text-white/35" aria-hidden="true" />
          </>
        )}
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Cuenta"
          onKeyDown={handleMenuKeyDown}
          className={`absolute z-50 bg-white border border-border rounded-xl shadow-xl py-1.5 animate-modal-in ${
            collapsed ? 'left-full bottom-3 ml-2 w-60' : 'left-2.5 right-2.5 bottom-full mb-1'
          }`}
        >
          <div className="px-3 pt-1 pb-2 mb-1 border-b border-border">
            <p className="text-dato font-medium text-text-primary truncate" title={displayName}>{displayName}</p>
            <p className="text-xs text-informativo truncate" title={email}>{email}</p>
          </div>
          <AccountActions canConfigure={canConfigure} onSignOut={() => { setOpen(false); onSignOut() }} />
        </div>
      )}
    </div>
  )
}
