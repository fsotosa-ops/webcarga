import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { leerSesion, RUTA_AUTH_NO_DISPONIBLE } from '@/lib/supabase/sesion'
import { puedeVerConfiguracion } from '@/lib/authz/acceso'
import { obtenerAccesoServidor } from '@/lib/authz/servidor'

/** Configuración: quien administra o configura alguna área (RBAC). La regla es
 *  la misma que decide si el menú muestra Configuración (lib/authz/acceso.ts);
 *  cada sección filtra lo que su permiso le deja tocar, y la API lo exige igual. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const sesion = await leerSesion(supabase)
  if (sesion.estado === 'auth-no-disponible') redirect(RUTA_AUTH_NO_DISPONIBLE)
  if (sesion.estado === 'sin-sesion') redirect('/login')

  const acceso = await obtenerAccesoServidor()
  if (!acceso || acceso === 'deactivated' || !puedeVerConfiguracion(acceso)) {
    redirect('/dashboard/operations/monitor')
  }

  return <>{children}</>
}
