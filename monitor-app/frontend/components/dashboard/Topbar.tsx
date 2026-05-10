import { createClient } from '@/lib/supabase/server'
import { Bell, ChevronRight, Home } from 'lucide-react'

export default async function Topbar() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user?.id ?? '')
    .single()

  const displayName = profile?.full_name ?? user?.email?.split('@')[0] ?? 'Usuario'
  const initials = displayName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()

  return (
    <header className="h-14 bg-white border-b border-border flex items-center px-6 shrink-0 gap-4">
      <nav className="flex items-center gap-1 text-sm flex-1 min-w-0">
        <Home size={14} className="text-gray-400 shrink-0" />
        <ChevronRight size={12} className="text-gray-300 shrink-0" />
        <span className="text-text-primary font-medium truncate">Gestor de Viajes</span>
      </nav>

      <div className="flex items-center gap-3">
        <button className="relative p-1.5 rounded-lg hover:bg-gray-100 transition-colors" title="Notificaciones">
          <Bell size={17} className="text-gray-500" />
        </button>

        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-semibold"
            style={{ background: 'linear-gradient(135deg, #1cb9ec 0%, #0e8db5 100%)' }}
          >
            {initials}
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-medium text-text-primary leading-tight">{displayName}</p>
            <p className="text-xs text-gray-400 capitalize">{profile?.role ?? 'operador'}</p>
          </div>
        </div>
      </div>
    </header>
  )
}
