'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import {
  Truck, Users, LogOut,
  ChevronLeft, ChevronRight, ChevronDown, Shield, Settings, Receipt, BadgeCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { documentIngestApi } from '@/lib/api/documentIngest'

// "Operaciones" agrupa Monitor bajo un solo item expandible —
// Empresas/Seguros no tienen esa profundidad todavía, se quedan planos.
// "Cerrar el día" (ex-Cuadratura) dejó de ser un item de nav — ahora es
// un botón dentro del propio Monitor (spec
// 2026-07-21-cuadratura-reporteria-redesign-design.md).
// "Cierres" (ex-Reportería, ahora en /operations/closures/history) se sacó
// del Sidebar — /dashboard/operations/closures pasará a ser el Centro de
// Cierre del Día (tarea futura), que todavía no tiene link de nav propio.
type NavLeaf  = { href: string; label: string; badge?: 'inbox' }
type NavGroupDef = { label: string; icon: LucideIcon; items: NavLeaf[] }

// Un modulo por objeto de trabajo, con sus vistas adentro (HU-04). La
// certificacion de una empresa se resuelve sin saltar entre modulos: la cola
// transversal, la sabana de pendientes y la ficha viven bajo el mismo techo.
const NAV_GROUPS: NavGroupDef[] = [
  {
    label: 'Operaciones',
    icon:  Truck,
    items: [
      { href: '/dashboard/operations/monitor', label: 'Monitor' },
    ],
  },
]

// Un modulo por objeto de trabajo. Certificacion es UNA lista de empresas con
// dos maneras de mirarla (por empresa / por documento), no tres submodulos:
// tenerlos separados obligaba a cruzar de memoria listas del mismo objeto.
// Seguros sigue aparte: pasarlo a seccion de la ficha es la HU-06.
const NAV_ITEMS: { href: string; label: string; icon: LucideIcon; badge?: 'inbox' }[] = [
  { href: '/dashboard/compliance', label: 'Certificación', icon: BadgeCheck, badge: 'inbox' },
  { href: '/dashboard/insurance',  label: 'Seguros',       icon: Shield },
  { href: '/dashboard/pricing',    label: 'Tarifario',     icon: Receipt },
]

// Solo para el bottom nav mobile — sin concepto de dropdown ahi, se listan
// los items de los grupos ya aplanados junto a los demas.
const MOBILE_NAV_ITEMS = [
  { href: '/dashboard/operations/monitor', label: 'Monitor', icon: Truck },
  ...NAV_ITEMS,
]

const ROLE_BADGE: Record<string, string> = {
  owner:  'bg-amber-500/20 text-amber-300',
  admin:  'bg-purple-500/20 text-purple-300',
  editor: 'bg-teal-500/20 text-teal-300',
  writer: 'bg-blue-500/20 text-blue-300',
  viewer: 'bg-white/10 text-white/50',
}

/** Grupo expandible del sidebar. Existe una sola vez: antes el bloque estaba
 *  escrito a mano para Operaciones, y sumar un segundo grupo obligaba a
 *  duplicar ~55 lineas — que fue exactamente la razon equivocada por la que la
 *  Bandeja termino colgando del primer nivel en vez de vivir dentro de
 *  Certificacion, como manda la HU-04. */
function NavGroup({
  group, pathname, collapsed, inboxCount,
}: {
  group:      NavGroupDef
  pathname:   string
  collapsed:  boolean
  inboxCount: number
}) {
  // Match mas especifico primero: /dashboard/compliance/inbox gana sobre
  // /dashboard/compliance, que es su prefijo.
  const activeHref = group.items
    .map(i => i.href)
    .filter(href => pathname.startsWith(href))
    .sort((a, b) => b.length - a.length)[0]
  const groupActive = !!activeHref

  const [open, setOpen] = useState(groupActive)
  // Si navegan directo a una sub-ruta (deep-link, back/forward), el submenu se
  // abre solo para mostrar donde estan.
  useEffect(() => {
    if (groupActive) setOpen(true)
  }, [groupActive])

  const Icon = group.icon
  const pending = group.items.some(i => i.badge === 'inbox') ? inboxCount : 0

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
          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500" />
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
          <span className="shrink-0 bg-red-500/90 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5 tabular-nums">
            {pending}
          </span>
        )}
        <ChevronDown size={13} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-0.5 ml-3 pl-3.5 border-l border-white/8 flex flex-col gap-0.5">
          {group.items.map(({ href, label, badge }) => {
            const active = href === activeHref
            return (
              <Link
                key={href}
                href={href}
                className={`relative flex items-center gap-2 rounded-lg text-[12.5px] px-2.5 py-2 transition-colors ${
                  active ? 'bg-white/12 text-white font-medium' : 'text-white/40 hover:bg-white/6 hover:text-white/75'
                }`}
              >
                <span className="truncate">{label}</span>
                {badge === 'inbox' && inboxCount > 0 && (
                  <span className="ml-auto shrink-0 bg-red-500/90 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5 tabular-nums">
                    {inboxCount}
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
  role?: string
}

export default function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()
  const [collapsed, setCollapsed] = useState(false)

  // Match más específico primero (ej. /dashboard/compliance/inbox no debe
  // también resaltar /dashboard/compliance) — evita 2 items activos a la vez.
  const activeHref = [...NAV_ITEMS]
    .map(i => i.href)
    .filter(href => pathname.startsWith(href))
    .sort((a, b) => b.length - a.length)[0]

  // Cuánto trabajo hay esperando en la bandeja. Se pide con limit=1: de la
  // respuesta solo interesa `total`.
  const inboxCount = useQuery({
    queryKey: ['ingest-queue-count'],
    queryFn: () => documentIngestApi.listQueue({ limit: 1 }),
    staleTime: 60_000,
  }).data?.total ?? 0

  useEffect(() => {
    if (localStorage.getItem('sidebar-collapsed') === 'true') setCollapsed(true)
  }, [])

  const toggle = () => setCollapsed(v => {
    const next = !v
    localStorage.setItem('sidebar-collapsed', String(next))
    return next
  })

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const isAdmin       = pathname.startsWith('/dashboard/admin')
  const isConfig      = pathname.startsWith('/dashboard/admin/configuracion')
  const canAdmin      = role === 'admin' || role === 'owner'
  const roleBadge = ROLE_BADGE[role ?? 'viewer'] ?? ROLE_BADGE.viewer

  return (
    <>
      {/* ── Desktop sidebar (md+) ─────────────────────────────── */}
      <aside className={`hidden md:flex ${collapsed ? 'w-[60px]' : 'w-[220px]'} bg-sidebar min-h-screen flex-col shrink-0 transition-[width] duration-200 ease-out`}>

        {/* ── Header ── */}
        <div className={`h-14 border-b border-white/8 flex items-center shrink-0 ${collapsed ? 'justify-center px-0' : 'px-4 gap-3'}`}>
          {collapsed ? (
            <button
              onClick={toggle}
              className="w-full h-full flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/5 transition-colors"
            >
              <ChevronRight size={15} />
            </button>
          ) : (
            <>
              <div className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center shrink-0 shadow-lg shadow-accent/30">
                <span className="text-white font-mulish font-bold text-sm">W</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-mulish font-bold text-[13px] leading-tight tracking-tight">WebCarga</p>
                <p className="text-white/35 text-[10px] tracking-wide">Monitor · Diario 2.0</p>
              </div>
              <button
                onClick={toggle}
                className="shrink-0 p-1.5 rounded-lg text-white/25 hover:text-white/60 hover:bg-white/5 transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
            </>
          )}
        </div>

        {/* ── Main nav ── */}
        <nav className="flex-1 flex flex-col px-2.5 py-3 gap-0.5 overflow-hidden">
          {NAV_GROUPS.map(group => (
            <NavGroup
              key={group.label}
              group={group}
              pathname={pathname}
              collapsed={collapsed}
              inboxCount={inboxCount}
            />
          ))}

          {NAV_ITEMS.map(({ href, label, icon: Icon, badge }) => {
            const active = href === activeHref
            return (
              <Link
                key={href}
                href={href}
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
                {badge === 'inbox' && inboxCount > 0 && !collapsed && (
                  <span className="ml-auto shrink-0 bg-red-500/90 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5 tabular-nums">
                    {inboxCount}
                  </span>
                )}
              </Link>
            )
          })}

          {/* ── Admin section ── */}
          {canAdmin && (
            <div className={`mt-auto pt-3 ${!collapsed ? 'border-t border-white/8' : ''}`}>
              {!collapsed && (
                <p className="px-3 text-[9px] font-bold text-white/20 uppercase tracking-[0.12em] mb-1.5">
                  Administración
                </p>
              )}
              <Link
                href="/dashboard/admin/configuracion"
                title={collapsed ? 'Configuración' : undefined}
                className={`group relative flex items-center rounded-xl text-[13px] transition-all duration-150 ${
                  collapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-3 py-2.5'
                } ${isConfig
                  ? 'bg-white/12 text-white'
                  : 'text-white/40 hover:bg-white/6 hover:text-white/75'
                }`}
              >
                {isConfig && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent rounded-full" />
                )}
                <Settings size={16} className={`shrink-0 ${isConfig ? 'text-accent' : 'group-hover:text-white/65'}`} />
                {!collapsed && (
                  <span className={`font-medium truncate ${isConfig ? 'text-white' : ''}`}>Configuración</span>
                )}
              </Link>
            </div>
          )}
        </nav>

        {/* ── Footer: sign out ── */}
        <div className="px-2.5 pb-3 border-t border-white/8 pt-2">
          <button
            onClick={signOut}
            title={collapsed ? 'Cerrar sesión' : undefined}
            className={`w-full group flex items-center rounded-xl text-[13px] text-white/35 hover:bg-white/6 hover:text-white/65 transition-all duration-150 ${
              collapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-3 py-2.5'
            }`}
          >
            <LogOut size={15} className="shrink-0" />
            {!collapsed && <span>Cerrar sesión</span>}
          </button>
        </div>
      </aside>

      {/* ── Mobile bottom nav ─────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-sidebar border-t border-white/8 flex items-stretch safe-area-inset-bottom">
        {MOBILE_NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href) && (href !== '/dashboard/operations/monitor' || pathname === href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 transition-colors ${
                active ? 'text-white' : 'text-white/40 hover:text-white/70'
              }`}
            >
              <Icon size={20} className={active ? 'text-accent' : ''} />
              <span className="text-[9px] font-semibold tracking-wide uppercase">{label}</span>
              {active && <span className="w-1 h-1 rounded-full bg-accent" />}
            </Link>
          )
        })}

        {canAdmin && (
          <Link
            href="/dashboard/admin/usuarios"
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 transition-colors ${
              isAdmin ? 'text-white' : 'text-white/40 hover:text-white/70'
            }`}
          >
            <Users size={20} className={isAdmin ? 'text-accent' : ''} />
            <span className="text-[9px] font-semibold tracking-wide uppercase">Admin</span>
            {isAdmin && <span className="w-1 h-1 rounded-full bg-accent" />}
          </Link>
        )}

        <button
          onClick={signOut}
          className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-white/35 hover:text-white/65 transition-colors"
        >
          <LogOut size={20} />
          <span className="text-[9px] font-semibold tracking-wide uppercase">Salir</span>
        </button>
      </nav>
    </>
  )
}
