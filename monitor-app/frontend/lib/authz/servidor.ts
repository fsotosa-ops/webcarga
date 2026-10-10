import { cache } from 'react'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { Acceso } from './acceso'
import { clasificarRespuestaMe, type EstadoDeAcceso } from './respuestaMe'

export type ResultadoDeAcceso =
  | { estado: 'ok'; acceso: Acceso }
  | { estado: Exclude<EstadoDeAcceso, 'ok'> }

/** GET /me desde un server component, con el token de la sesión (mismo
 *  criterio que el proxy /api/v1). Solo para componentes de servidor: usa
 *  next/headers. `cache`: el layout del dashboard y el de Configuración la
 *  piden en el mismo request y la API responde una sola vez. */
export const obtenerAccesoServidor = cache(async (): Promise<ResultadoDeAcceso> => {
  const cookieStore = await cookies()
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => cookieStore.getAll(), setAll() {} },
  })
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { estado: 'sin-sesion' }
  const base = (process.env.FASTAPI_URL ?? 'http://localhost:8001').trim()
  let res: Response
  try {
    res = await fetch(`${base}/api/v1/me`, {
      headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store',
    })
  } catch {
    // Red o API caída: no es una negación de acceso.
    return { estado: 'no-disponible' }
  }
  const cuerpo = await res.json().catch(() => null)
  const estado = clasificarRespuestaMe(res.status, cuerpo?.detail)
  return estado === 'ok' ? { estado, acceso: cuerpo as Acceso } : { estado }
})
