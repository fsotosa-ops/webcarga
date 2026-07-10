'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import {
  Truck, Building2, Users, LogOut,
  ChevronLeft, ChevronRight, Shield, ShieldCheck, Settings,
} from 'lucide-react'

const NAV_ITEMS = [
  { href: '/dashboard/diario',         label: 'Diario',   icon: Truck },
  { href: '/dashboard/transportistas', label: 'Empresas', icon: Building2 },
  { href: '/dashboard/seguros',        label: 'Seguros',  icon: ShieldCheck },
]

const ROLE_BADGE: Record<string, string> = {
  owner:  'bg-amber-500/20 text-amber-300',
  admin:  'bg-purple-500/20 text-purple-300',
  editor: 'bg-teal-500/20 text-teal-300',
  writer: 'bg-blue-500/20 text-blue-300',
  viewer: 'bg-white/10 text-white/50',
}

interface SidebarProps {
  role?: string
}

export default function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()
  const [collapsed, setCollapsed] = useState(false)

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
  const isAdminUsers  = pathname.startsWith('/dashboard/admin/usuarios')
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
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href)
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
                href="/dashboard/admin/usuarios"
                title={collapsed ? 'Usuarios' : undefined}
                className={`group relative flex items-center rounded-xl text-[13px] transition-all duration-150 ${
                  collapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-3 py-2.5'
                } ${isAdminUsers
                  ? 'bg-white/12 text-white'
                  : 'text-white/40 hover:bg-white/6 hover:text-white/75'
                }`}
              >
                {isAdminUsers && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent rounded-full" />
                )}
                <Users size={16} className={`shrink-0 ${isAdminUsers ? 'text-accent' : 'group-hover:text-white/65'}`} />
                {!collapsed && (
                  <span className={`font-medium truncate ${isAdminUsers ? 'text-white' : ''}`}>Usuarios</span>
                )}
                {!collapsed && role === 'owner' && (
                  <Shield size={11} className="ml-auto shrink-0 text-amber-400/60" />
                )}
              </Link>
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
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
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
