import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { Acceso } from './acceso'

/** GET /me desde un server component, con el token de la sesión (mismo
 *  criterio que el proxy /api/v1). `null` = sin sesión o sin acceso;
 *  `'deactivated'` = la cuenta existe pero está desactivada (403 de la API).
 *  Solo para componentes de servidor: usa next/headers. */
export async function obtenerAccesoServidor(): Promise<Acceso | 'deactivated' | null> {
  const cookieStore = await cookies()
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => cookieStore.getAll(), setAll() {} },
  })
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  const base = (process.env.FASTAPI_URL ?? 'http://localhost:8001').trim()
  const res = await fetch(`${base}/api/v1/me`, {
    headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store',
  })
  if (res.status === 403) {
    const { detail } = await res.json().catch(() => ({ detail: '' }))
    return String(detail).includes('desactivada') ? 'deactivated' : null
  }
  if (!res.ok) return null
  return res.json()
}
