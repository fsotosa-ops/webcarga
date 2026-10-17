'use client'

import LogoWebCarga from '@/components/brand/LogoWebCarga'
import { getInitials } from '@/lib/utils/avatar'
import { useMobileMenu } from './MobileNav'

interface TopbarProps {
  /** Nombre ya resuelto por el layout. */
  displayName: string
  /** Nombre del rol principal (GET /me). */
  roleName:    string | null
}

/** Barra superior, solo en el teléfono: ahí no hay barra lateral, así que la
 *  marca y quién está conectado van arriba; tocar el avatar abre el cajón "Menú". En escritorio la cuenta vive al pie
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
  const menu = useMobileMenu()
  const identity = roleName ? `${displayName}, ${roleName}` : displayName
  return (
    // El fondo de la barra lateral: así el logo oficial (blanco) se usa tal cual, y la
    // cabecera y la barra de abajo del teléfono son una sola pieza visual.
    <header className="md:hidden h-14 shrink-0 flex items-center justify-between px-4 bg-sidebar border-b border-white/8">
      <LogoWebCarga forma="completo" alto={20} prioridad />
      <button type="button" onClick={menu.open} aria-label={`Abrir menú de ${identity}`}
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-accent/15 text-accent text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
        {getInitials(displayName)}
      </button>
    </header>
  )
}
