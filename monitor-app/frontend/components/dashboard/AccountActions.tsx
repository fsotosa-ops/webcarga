import Link from 'next/link'
import { KeyRound, LogOut, Settings } from 'lucide-react'

export const SETTINGS_HREF = '/dashboard/admin/settings'
const CHANGE_PASSWORD_HREF = '/auth/reset-password'

const ITEM = 'flex items-center gap-2.5 w-full px-3 py-2 text-left text-dato text-text-primary hover:bg-bg-main focus-visible:bg-bg-main focus-visible:outline-none transition-colors'

/** Lo que se hace con la cuenta: Configuración (si puede), Cambiar contraseña y Cerrar
 *  sesión, como ítems de un menú. Una vez: lo muestran el menú de la cuenta en la barra
 *  lateral y el cajón del teléfono. */
export function AccountActions({ canConfigure, onSignOut }: { canConfigure: boolean; onSignOut: () => void }) {
  return (
    <>
      {canConfigure && (
        <Link href={SETTINGS_HREF} role="menuitem" prefetch={false} className={ITEM}>
          <Settings size={14} className="text-informativo shrink-0" aria-hidden="true" />
          Configuración
        </Link>
      )}
      {/* Cambiar la contraseña con la sesión abierta (seguridad, 09/10).
          Misma pantalla que la recuperación por correo. */}
      <Link href={CHANGE_PASSWORD_HREF} role="menuitem" className={ITEM}>
        <KeyRound size={14} className="text-informativo shrink-0" aria-hidden="true" />
        Cambiar contraseña
      </Link>
      <div role="separator" className="my-1 border-t border-border" />
      <button type="button" role="menuitem" onClick={onSignOut} className={ITEM}>
        <LogOut size={14} className="text-informativo shrink-0" aria-hidden="true" />
        Cerrar sesión
      </button>
    </>
  )
}
