import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { leerSesion, RUTA_AUTH_NO_DISPONIBLE } from '@/lib/supabase/sesion'
import { puedeVerConfiguracion } from '@/lib/authz/acceso'
import { obtenerAccesoServidor } from '@/lib/authz/servidor'
import { destinoSinAcceso } from '@/lib/authz/respuestaMe'

/** Configuración: quien administra o configura alguna área (RBAC). La regla es
 *  la misma que decide si el menú muestra Configuración (lib/authz/acceso.ts);
 *  cada sección filtra lo que su permiso le deja tocar, y la API lo exige igual. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const sesion = await leerSesion(supabase)
  if (sesion.estado === 'auth-no-disponible') redirect(RUTA_AUTH_NO_DISPONIBLE)
  if (sesion.estado === 'sin-sesion') redirect('/login')

  // Mismo request que el layout del dashboard: obtenerAccesoServidor está en
  // cache(), así que /me se pide una sola vez.
  const resultado = await obtenerAccesoServidor()
  if (resultado.estado !== 'ok') redirect(destinoSinAcceso(resultado.estado))
  if (!puedeVerConfiguracion(resultado.acceso)) redirect('/dashboard/operations/monitor')

  return <>{children}</>
}
