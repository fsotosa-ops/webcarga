import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/dashboard/Sidebar'
import Topbar from '@/components/dashboard/Topbar'
import { Providers } from './providers'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Se pide `full_name` acá aunque el layout no lo use: el Topbar lo necesita
  // y antes lo consultaba por su cuenta, repitiendo getUser() y la consulta a
  // profiles en cada render. Una sola vez alcanza para los dos.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, active, full_name')
    .eq('id', user.id)
    .single()

  if (profile?.active === false) redirect('/login?error=cuenta_desactivada')

  const displayName = profile?.full_name ?? user.email?.split('@')[0] ?? 'Usuario'

  return (
    <Providers>
      <div className="flex h-screen overflow-hidden">
        <Sidebar role={profile?.role} />
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <Topbar displayName={displayName} role={profile?.role} />
          {/* pb-16 md:pb-0: space for mobile bottom nav */}
          <main className="flex-1 overflow-y-auto bg-bg-main pb-16 md:pb-0">
            {children}
          </main>
        </div>
      </div>
    </Providers>
  )
}
