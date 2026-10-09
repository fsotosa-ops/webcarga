import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { leerSesion, RUTA_AUTH_NO_DISPONIBLE } from '@/lib/supabase/sesion'
import Sidebar from '@/components/dashboard/Sidebar'
import Topbar from '@/components/dashboard/Topbar'
import { Providers } from './providers'
import { hasRole } from '@/lib/types'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const sesion = await leerSesion(supabase)
  if (sesion.estado === 'auth-no-disponible') redirect(RUTA_AUTH_NO_DISPONIBLE)
  if (sesion.estado === 'sin-sesion') redirect('/login')
  const user = { id: sesion.userId, email: sesion.email }

  // Se pide `full_name` acá aunque el layout no lo use: el Topbar lo necesita
  // y antes lo consultaba por su cuenta, repitiendo getUser() y la consulta a
  // profiles en cada render. Una sola vez alcanza para los dos.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, active, full_name')
    .eq('id', user.id)
    .single()

  // Solo por invitación (seguridad, 09/10): sin perfil no hay acceso. Antes
  // una cuenta cualquiera de Google entraba como lectora. A /auth/access-denied y
  // no a /login: con la sesión todavía abierta, /login la devolvía acá (bucle).
  if (!profile) redirect('/auth/access-denied?reason=not-invited')
  if (profile.active === false) redirect('/auth/access-denied?reason=deactivated')

  // Verificación en dos pasos (seguridad, 09/10). Si la cuenta la tiene, la
  // sesión tiene que haberla pasado. Si el rol administra (admin, owner) y no
  // la inscribió, se inscribe antes de entrar: la API exige aal2 para esos roles.
  const { data: nivel } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (nivel?.nextLevel === 'aal2' && nivel.currentLevel !== 'aal2') redirect('/auth/mfa/verify')
  if (hasRole(profile.role, 'admin') && nivel?.nextLevel !== 'aal2') redirect('/auth/mfa/setup')

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
