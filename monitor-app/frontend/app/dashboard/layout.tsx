import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { leerSesion, RUTA_AUTH_NO_DISPONIBLE } from '@/lib/supabase/sesion'
import Sidebar from '@/components/dashboard/Sidebar'
import Topbar from '@/components/dashboard/Topbar'
import { Providers } from './providers'
import { tienePrivilegios } from '@/lib/authz/acceso'
import { obtenerAccesoServidor } from '@/lib/authz/servidor'
import { PermisosProvider } from '@/lib/authz/PermisosProvider'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const sesion = await leerSesion(supabase)
  if (sesion.estado === 'auth-no-disponible') redirect(RUTA_AUTH_NO_DISPONIBLE)
  if (sesion.estado === 'sin-sesion') redirect('/login')
  const user = { id: sesion.userId, email: sesion.email }

  // Los permisos vienen de la API (GET /me, RBAC): ninguna pantalla decide por
  // rol. Solo por invitación (seguridad, 09/10): sin roles no hay acceso. A
  // /auth/access-denied y no a /login: con la sesión todavía abierta, /login la
  // devolvía acá (bucle).
  const acceso = await obtenerAccesoServidor()
  if (acceso === 'deactivated') redirect('/auth/access-denied?reason=deactivated')
  if (!acceso) redirect('/auth/access-denied?reason=not-invited')

  // Verificación en dos pasos (seguridad, 09/10). Si la cuenta la tiene, la
  // sesión tiene que haberla pasado. Si algún permiso es privilegiado
  // (administrar personas, roles o la configuración general) y no la inscribió,
  // se inscribe antes de entrar: la API exige aal2 para esos permisos.
  const { data: nivel } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (nivel?.nextLevel === 'aal2' && nivel.currentLevel !== 'aal2') redirect('/auth/mfa/verify')
  if (tienePrivilegios(acceso) && nivel?.nextLevel !== 'aal2') redirect('/auth/mfa/setup')

  const displayName = acceso.full_name ?? user.email?.split('@')[0] ?? 'Usuario'

  return (
    <Providers>
      <div className="flex h-screen overflow-hidden">
        <Sidebar acceso={acceso} />
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <Topbar displayName={displayName} rol={acceso.role_names[0] ?? null} />
          {/* pb-16 md:pb-0: space for mobile bottom nav */}
          <main className="flex-1 overflow-y-auto bg-bg-main pb-16 md:pb-0">
            <PermisosProvider acceso={acceso}>{children}</PermisosProvider>
          </main>
        </div>
      </div>
    </Providers>
  )
}
