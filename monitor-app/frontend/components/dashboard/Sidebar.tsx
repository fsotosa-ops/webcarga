'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Truck, Building2, Users, LogOut } from 'lucide-react'

const navItems = [
  { href: '/dashboard/diario',          label: 'Diario',          icon: Truck },
  { href: '/dashboard/transportistas',  label: 'Transportistas',  icon: Building2 },
]

interface SidebarProps {
  role?: string
}

export default function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="w-56 bg-sidebar min-h-screen flex flex-col shrink-0">
      <div className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center shrink-0 shadow-lg">
            <span className="text-white font-mulish font-bold text-sm">W</span>
          </div>
          <div>
            <p className="text-white font-mulish font-bold text-sm leading-tight">WebCarga</p>
            <p className="text-white/40 text-[11px]">Diario 2.0</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                active
                  ? 'bg-white/10 text-white font-medium'
                  : 'text-white/55 hover:bg-white/5 hover:text-white/80'
              }`}
            >
              <Icon size={16} className={active ? 'text-accent' : ''} />
              {label}
              {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-accent" />}
            </Link>
          )
        })}

        {role === 'admin' && (
          <div className="pt-3 mt-3 border-t border-white/10">
            <p className="px-3 text-[10px] font-semibold text-white/25 uppercase tracking-widest mb-1.5">
              Admin
            </p>
            <Link
              href="/dashboard/admin/usuarios"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                pathname.startsWith('/dashboard/admin')
                  ? 'bg-white/10 text-white font-medium'
                  : 'text-white/55 hover:bg-white/5 hover:text-white/80'
              }`}
            >
              <Users size={16} className={pathname.startsWith('/dashboard/admin') ? 'text-accent' : ''} />
              Usuarios
              {pathname.startsWith('/dashboard/admin') && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-accent" />
              )}
            </Link>
          </div>
        )}
      </nav>

      <div className="px-3 py-4 border-t border-white/10">
        <button
          onClick={signOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/55 hover:bg-white/5 hover:text-white/80 transition-all"
        >
          <LogOut size={16} />
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}
