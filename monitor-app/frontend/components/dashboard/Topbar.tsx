import LogoWebCarga from '@/components/brand/LogoWebCarga'
import { getInitials } from '@/lib/utils/avatar'

interface TopbarProps {
  /** Nombre ya resuelto por el layout. */
  displayName: string
  /** Nombre del rol principal (GET /me). */
  roleName:    string | null
}

/** Barra superior, solo en el teléfono: ahí no hay barra lateral, así que la
 *  marca y quién está conectado van arriba. En escritorio la cuenta vive al pie
 *  de la barra lateral (`SidebarAccount`) y esta franja no se dibuja, para
 *  devolverle el alto al contenido (pedido del usuario, 11/10).
 *
 *  Recibe los datos del layout en vez de volver a pedirlos. Antes llamaba a
 *  `getUser()` y consultaba `profiles` por su cuenta, y el layout que lo
 *  envuelve hacía exactamente lo mismo: dos llamadas a la API de Auth por cada
 *  render del dashboard. Con el prefetch de Next.js sobre una lista larga eso
 *  son cientos de llamadas por minuto y Supabase responde 429 ("Many
 *  requests") — medido: 104 llamadas a /user en un solo minuto. */
export default function Topbar({ displayName, roleName }: TopbarProps) {
  return (
    <header className="md:hidden h-14 bg-white border-b border-border/70 flex items-center px-4 shrink-0 gap-3">
      <div className="flex items-center gap-2 shrink-0">
        {/* Fondo blanco: el isotipo azul; el logo completo es blanco. */}
        <LogoWebCarga forma="isotipo" alto={28} />
        <span className="font-mulish font-bold text-sm text-text-primary">WebCarga</span>
      </div>

      <div className="flex items-center gap-2 ml-auto min-w-0">
        <div
          role="img"
          aria-label={roleName ? `${displayName}, ${roleName}` : displayName}
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-semibold"
          style={{ background: 'linear-gradient(135deg, #1cb9ec 0%, #0e8db5 100%)' }}
        >
          {getInitials(displayName)}
        </div>
        <div className="hidden sm:block min-w-0" aria-hidden="true">
          <p className="text-sm font-medium text-text-primary leading-tight truncate">{displayName}</p>
          {roleName && <p className="text-xs text-informativo truncate">{roleName}</p>}
        </div>
      </div>
    </header>
  )
}
