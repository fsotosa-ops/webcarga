import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/dashboard/Sidebar'
import Topbar from '@/components/dashboard/Topbar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, active')
    .eq('id', user.id)
    .single()

  if (profile?.active === false) redirect('/login?error=cuenta_desactivada')

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar role={profile?.role} />
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <Topbar />
        {/* pb-16 md:pb-0: space for mobile bottom nav */}
        <main className="flex-1 overflow-y-auto bg-bg-main pb-16 md:pb-0">
          {children}
        </main>
      </div>
    </div>
  )
}
