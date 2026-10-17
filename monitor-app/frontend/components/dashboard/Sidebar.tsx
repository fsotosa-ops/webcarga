'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronLeft, ChevronDown } from 'lucide-react'
import { getDisplayName, puedeVerConfiguracion, type Acceso } from '@/lib/authz/acceso'
import { activeHref, isGroup, visibleNav, type NavBadge, type NavGroup } from '@/lib/navegacion/menu'
import { useNavCounts } from '@/hooks/useNavCounts'
import LogoWebCarga from '@/components/brand/LogoWebCarga'
import SidebarAccount from './SidebarAccount'
import { useSignOut } from '@/hooks/useSignOut'

/** Grupo expandible del sidebar. Existe una sola vez: antes el bloque estaba
 *  escrito a mano para Operaciones, y sumar un segundo grupo obligaba a
 *  duplicar ~55 lineas — que fue exactamente la razon equivocada por la que la
 *  Bandeja termino colgando del primer nivel en vez de vivir dentro de
 *  Certificacion, como manda la HU-04. */
function SidebarGroup({
  group, pathname, collapsed, counts,
}: {
  group:     NavGroup
  pathname:  string
  collapsed: boolean
  /** Los contadores del menú (`useNavCounts`): Por asignar, Pendientes y Cuotas. */
  counts:    Partial<Record<NavBadge, number>>
}) {
  const countOf = (badge?: NavBadge) => (badge ? counts[badge] ?? 0 : 0)
  const current = activeHref(pathname, group.items.map(i => i.href))
  const groupActive = !!current

  const [open, setOpen] = useState(groupActive)
  // Si navegan directo a una sub-ruta (deep-link, back/forward), el submenu se
  // abre solo para mostrar donde estan.
  useEffect(() => {
    if (groupActive) setOpen(true)
  }, [groupActive])

  const Icon = group.icon
  const pending = group.items.reduce((n, i) => n + countOf(i.badge), 0)

  if (collapsed) {
    return (
      <Link
        href={group.items[0].href}
        title={group.label}
        className={`group relative flex items-center justify-center h-10 w-10 mx-auto rounded-xl text-[13px] transition-all duration-150 ${
          groupActive ? 'bg-white/12 text-white' : 'text-white/45 hover:bg-white/6 hover:text-white/80'
        }`}
      >
        {groupActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent rounded-full" />
        )}
        <Icon size={16} className={groupActive ? 'text-accent' : 'group-hover:text-white/70'} />
        {pending > 0 && (
          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-status-incidente" />
        )}
      </Link>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className={`group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] transition-all duration-150 ${
          groupActive ? 'bg-white/12 text-white' : 'text-white/45 hover:bg-white/6 hover:text-white/80'
        }`}
      >
        {groupActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent rounded-full" />
        )}
        <Icon size={16} className={`shrink-0 ${groupActive ? 'text-accent' : 'group-hover:text-white/70'}`} />
        <span className={`font-medium truncate flex-1 text-left ${groupActive ? 'text-white' : ''}`}>{group.label}</span>
        {pending > 0 && !open && (
          <span className="shrink-0 bg-status-incidente/90 text-white text-etiqueta font-bold rounded-full px-1.5 py-0.5 tabular-nums">
            {pending}
          </span>
        )}
        <ChevronDown size={13} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-0.5 ml-3 pl-3.5 border-l border-white/8 flex flex-col gap-0.5">
          {group.items.map(({ href, label, badge }) => {
            const active = href === current
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`relative flex items-center gap-2 rounded-lg text-[12.5px] px-2.5 py-2 transition-colors ${
                  active ? 'bg-white/12 text-white font-medium' : 'text-white/40 hover:bg-white/6 hover:text-white/75'
                }`}
              >
                <span className="truncate">{label}</span>
                {countOf(badge) > 0 && (
                  <span className="ml-auto shrink-0 bg-status-incidente/90 text-white text-etiqueta font-bold rounded-full px-1.5 py-0.5 tabular-nums">
                    {countOf(badge)}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface SidebarProps {
  acceso: Acceso
}

export default function Sidebar({ acceso }: SidebarProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  // Las entradas sueltas del primer nivel (Tarifario): la activa, por `activeHref`.
  const nav = visibleNav(acceso.permissions)
  const topActive = activeHref(pathname, nav.flatMap(e => (isGroup(e) ? [] : [e.href])))

  const counts = useNavCounts(acceso.permissions)

  useEffect(() => {
    if (localStorage.getItem('sidebar-collapsed') === 'true') setCollapsed(true)
  }, [])

  const toggle = () => setCollapsed(v => {
    const next = !v
    localStorage.setItem('sidebar-collapsed', String(next))
    return next
  })

  const signOut = useSignOut()

  // Configuración: quien administra o configura alguna área (misma regla que
  // el layout de admin, lib/authz/acceso.ts).
  const canAdmin      = puedeVerConfiguracion(acceso)

  return (
    <>
      {/* ── Desktop sidebar (md+) ─────────────────────────────── */}
      <aside className={`hidden md:flex ${collapsed ? 'w-[60px]' : 'w-[220px]'} bg-sidebar min-h-screen flex-col shrink-0 transition-[width] duration-200 ease-out`}>

        {/* ── Header ── */}
        <div className={`h-14 border-b border-white/8 flex items-center shrink-0 ${collapsed ? 'justify-center px-0' : 'px-4 gap-3'}`}>
          {collapsed ? (
            /* Contraída: el cubo de WebCarga, que también expande la barra. */
            <button
              onClick={toggle}
              aria-label="Expandir barra lateral"
              title="Expandir barra lateral"
              className="w-full h-full flex items-center justify-center hover:bg-white/5 transition-colors"
            >
              <LogoWebCarga forma="isotipo" alto={28} prioridad />
            </button>
          ) : (
            <>
              <div className="flex-1 min-w-0">
                {/* block: una imagen en línea deja el espacio de los descendentes
                    abajo y empujaba el logo contra el borde superior. */}
                <LogoWebCarga forma="completo" alto={20} prioridad className="block" />
                <p className="text-white/35 text-etiqueta leading-none tracking-wide mt-1.5">Plataforma logística</p>
              </div>
              <button
                onClick={toggle}
                aria-label="Contraer barra lateral"
                title="Contraer barra lateral"
                className="shrink-0 p-1.5 rounded-lg text-white/25 hover:text-white/60 hover:bg-white/5 transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
            </>
          )}
        </div>

        {/* ── Main nav ── */}
        <nav aria-label="Navegación principal" className="flex-1 flex flex-col px-2.5 py-3 gap-0.5 overflow-hidden">
          {nav.map(entrada => {
            if (isGroup(entrada)) {
              return (
                <SidebarGroup
                  key={entrada.label}
                  group={entrada}
                  pathname={pathname}
                  collapsed={collapsed}
                  counts={counts}
                />
              )
            }
            const { href, label, icon: Icon } = entrada
            const active = href === topActive
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                title={collapsed ? label : undefined}
                className={`group relative flex items-center rounded-xl text-[13px] transition-all duration-150 ${
                  collapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-3 py-2.5'
                } ${active
                  ? 'bg-white/12 text-white'
                  : 'text-white/45 hover:bg-white/6 hover:text-white/80'
                }`}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent rounded-full" />
                )}
                <Icon size={16} className={`shrink-0 ${active ? 'text-accent' : 'group-hover:text-white/70'}`} />
                {!collapsed && (
                  <span className={`font-medium truncate ${active ? 'text-white' : ''}`}>{label}</span>
                )}
              </Link>
            )
          })}
        </nav>

        <SidebarAccount
          displayName={getDisplayName(acceso)}
          email={acceso.email}
          roleName={acceso.role_names[0] ?? null}
          collapsed={collapsed}
          canConfigure={canAdmin}
          onSignOut={signOut}
        />
      </aside>

    </>
  )
}
