'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Truck, Building2, Users, LogOut, ChevronLeft, ChevronRight } from 'lucide-react'

const navItems = [
  { href: '/dashboard/diario',         label: 'Diario',   icon: Truck },
  { href: '/dashboard/transportistas', label: 'Empresas', icon: Building2 },
]

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

  const isAdmin = pathname.startsWith('/dashboard/admin')

  return (
    <>
      {/* ── Desktop sidebar (md+) ─────────────────────────────── */}
      <aside className={`hidden md:flex ${collapsed ? 'w-16' : 'w-56'} bg-sidebar min-h-screen flex-col shrink-0 transition-[width] duration-200`}>

        {/* Logo / collapse header */}
        {collapsed ? (
          /* Collapsed: full-width expand button */
          <div className="h-14 border-b border-white/10 shrink-0">
            <button
              onClick={toggle}
              title="Expandir menú"
              className="w-full h-full flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        ) : (
          /* Expanded: logo + name + collapse button */
          <div className="h-14 px-4 border-b border-white/10 flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shrink-0 shadow-lg">
              <span className="text-white font-mulish font-bold text-sm">W</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-mulish font-bold text-sm leading-tight">WebCarga</p>
              <p className="text-white/40 text-[11px]">Diario 2.0</p>
            </div>
            <button
              onClick={toggle}
              title="Colapsar menú"
              className="shrink-0 p-1.5 rounded text-white/35 hover:text-white/80 hover:bg-white/5 transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href)
            return (
              <Link
                key={href} href={href}
                title={collapsed ? label : undefined}
                className={`flex items-center py-2.5 rounded-lg text-sm transition-all ${
                  collapsed ? 'justify-center px-2.5' : 'gap-3 px-3'
                } ${active
                  ? 'bg-white/10 text-white font-medium'
                  : 'text-white/55 hover:bg-white/5 hover:text-white/80'
                }`}
              >
                <Icon size={16} className={active ? 'text-accent' : ''} />
                {!collapsed && <span className="truncate">{label}</span>}
                {!collapsed && active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
              </Link>
            )
          })}

          {role === 'admin' && (
            <div className="pt-3 mt-3 border-t border-white/10">
              {!collapsed && (
                <p className="px-3 text-[10px] font-semibold text-white/25 uppercase tracking-widest mb-1.5">Admin</p>
              )}
              <Link
                href="/dashboard/admin/usuarios"
                title={collapsed ? 'Admin' : undefined}
                className={`flex items-center py-2.5 rounded-lg text-sm transition-all ${
                  collapsed ? 'justify-center px-2.5' : 'gap-3 px-3'
                } ${isAdmin
                  ? 'bg-white/10 text-white font-medium'
                  : 'text-white/55 hover:bg-white/5 hover:text-white/80'
                }`}
              >
                <Users size={16} className={isAdmin ? 'text-accent' : ''} />
                {!collapsed && <span className="truncate">Usuarios</span>}
                {!collapsed && isAdmin && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
              </Link>
            </div>
          )}
        </nav>

        {/* Sign out */}
        <div className="px-2 py-3 border-t border-white/10">
          <button
            onClick={signOut}
            title={collapsed ? 'Cerrar sesión' : undefined}
            className={`w-full flex items-center py-2.5 rounded-lg text-sm text-white/55 hover:bg-white/5 hover:text-white/80 transition-all ${
              collapsed ? 'justify-center px-2.5' : 'gap-3 px-3'
            }`}
          >
            <LogOut size={16} />
            {!collapsed && <span>Cerrar sesión</span>}
          </button>
        </div>
      </aside>

      {/* ── Mobile bottom nav ─────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-sidebar border-t border-white/10 flex items-stretch">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link key={href} href={href}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 transition-colors ${
                active ? 'text-white' : 'text-white/45 hover:text-white/80'
              }`}>
              <Icon size={21} className={active ? 'text-accent' : ''} />
              <span className="text-[10px] font-medium">{label}</span>
              {active && <div className="w-1 h-1 rounded-full bg-accent" />}
            </Link>
          )
        })}

        {role === 'admin' && (
          <Link href="/dashboard/admin/usuarios"
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 transition-colors ${
              isAdmin ? 'text-white' : 'text-white/45 hover:text-white/80'
            }`}>
            <Users size={21} className={isAdmin ? 'text-accent' : ''} />
            <span className="text-[10px] font-medium">Admin</span>
            {isAdmin && <div className="w-1 h-1 rounded-full bg-accent" />}
          </Link>
        )}

        <button onClick={signOut}
          className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-white/45 hover:text-white/80 transition-colors">
          <LogOut size={21} />
          <span className="text-[10px] font-medium">Salir</span>
        </button>
      </nav>
    </>
  )
}
