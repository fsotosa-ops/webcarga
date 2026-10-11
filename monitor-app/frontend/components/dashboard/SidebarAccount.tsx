import Link from 'next/link'
import { KeyRound, LogOut } from 'lucide-react'
import { getInitials } from '@/lib/utils/avatar'

interface SidebarAccountProps {
  displayName: string
  /** Nombre del rol principal (GET /me). */
  roleName:    string | null
  collapsed:   boolean
  onSignOut:   () => void
}

/** Quién está conectado y sus acciones de cuenta, al pie de la barra lateral.
 *
 *  Antes la identidad vivía en una barra superior de 56 px que no tenía nada
 *  más, y las acciones de cuenta abajo a la izquierda: la misma cuenta partida
 *  en dos esquinas. Va junta acá, como en Linear, Vercel o Supabase, y la
 *  barra superior queda solo para el teléfono, donde no hay barra lateral
 *  (pedido del usuario, 11/10). */
export default function SidebarAccount({ displayName, roleName, collapsed, onSignOut }: SidebarAccountProps) {
  const identity = roleName ? `${displayName}, ${roleName}` : displayName
  const actionClass = `w-full flex items-center rounded-xl text-[13px] text-white/35 hover:bg-white/6 hover:text-white/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 transition-colors duration-150 ${
    collapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-3 py-2.5'
  }`

  return (
    <div className="px-2.5 pb-3 border-t border-white/8 pt-3">
      <div
        className={`flex items-center mb-1 ${collapsed ? 'justify-center' : 'gap-2.5 px-2'}`}
        title={collapsed ? identity : undefined}
      >
        <div
          role="img"
          aria-label={identity}
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-accent/15 text-accent text-xs font-semibold"
        >
          {getInitials(displayName)}
        </div>
        {!collapsed && (
          <div className="min-w-0" aria-hidden="true">
            <p className="text-[13px] font-medium text-white leading-tight truncate" title={displayName}>
              {displayName}
            </p>
            {roleName && (
              <p className="text-xs text-white/45 leading-tight truncate" title={roleName}>{roleName}</p>
            )}
          </div>
        )}
      </div>

      {/* Cambiar la contraseña con la sesión abierta (seguridad, 09/10).
          Misma pantalla que la recuperación por correo. */}
      <Link
        href="/auth/reset-password"
        title={collapsed ? 'Cambiar contraseña' : undefined}
        aria-label={collapsed ? 'Cambiar contraseña' : undefined}
        className={actionClass}
      >
        <KeyRound size={15} className="shrink-0" />
        {!collapsed && <span>Cambiar contraseña</span>}
      </Link>
      <button
        type="button"
        onClick={onSignOut}
        title={collapsed ? 'Cerrar sesión' : undefined}
        aria-label={collapsed ? 'Cerrar sesión' : undefined}
        className={actionClass}
      >
        <LogOut size={15} className="shrink-0" />
        {!collapsed && <span>Cerrar sesión</span>}
      </button>
    </div>
  )
}
