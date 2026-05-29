import { createClient } from '@/lib/supabase/server'
import { Bell } from 'lucide-react'
import { TourProgressButton } from '@/components/tour/TourProgressButton'

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
    <header className="h-14 bg-white border-b border-border flex items-center px-4 md:px-6 shrink-0 gap-3">
      {/* Mobile brand — visible only when sidebar is hidden */}
      <div className="md:hidden flex items-center gap-2 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center shadow">
          <span className="text-white font-mulish font-bold text-xs">W</span>
        </div>
        <span className="font-mulish font-bold text-sm text-text-primary">WebCarga</span>
      </div>

      {/* Spacer on desktop (breadcrumb placeholder) */}
      <div className="hidden md:block flex-1" />

      <div className="flex items-center gap-2.5 ml-auto">
        <TourProgressButton />
        <button className="relative p-1.5 rounded-lg hover:bg-gray-100 transition-colors" title="Notificaciones">
          <Bell size={17} className="text-gray-500" />
        </button>

        <div className="flex items-center gap-2">
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
