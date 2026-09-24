import { isAuthRetryableFetchError, type JWK, type SupabaseClient } from '@supabase/supabase-js'
import jwks from './jwks.json'

/** La llave PÚBLICA con que el proyecto firma los JWT (ES256). No es secreta.
 *
 *  Versionada acá para verificar la sesión sin salir a la red: `getClaims`
 *  la usa antes que el JWKS de Supabase Auth, que se sirve desde la misma base
 *  y no respondió ni el 22/09 ni el 23/09 mientras estaba saturada. Una
 *  llave que no esté acá (rotación) se busca en el JWKS en vivo. REVOCAR una
 *  llave exige sacarla de este archivo y de backend/api/app/supabase_jwks.json.
 */
export const LLAVES_SUPABASE = { keys: jwks.keys as JWK[] }

export type Sesion =
  | { estado: 'activa'; userId: string; email: string | null }
  | { estado: 'sin-sesion' }
  /** Hay sesión, pero no se pudo confirmar ni refrescar porque Supabase Auth
   *  no responde. NO es "no autenticado": mandar a /login a esta persona la
   *  deja frente a un login que tampoco va a responder (el Gateway Timeout
   *  del 22/09). */
  | { estado: 'auth-no-disponible' }

/** La única lectura de sesión del lado del servidor (middleware y layouts).
 *
 *  Antes cada uno llamaba a `getUser()`, que va a Supabase Auth por HTTP en
 *  CADA request: cuando Auth cayó el 22/09, cada página tardó ~35 s y terminó
 *  en /login para todos, incluso con una sesión válida. `getClaims` verifica
 *  la firma localmente; sólo sale a la red para refrescar un token vencido. */
export async function leerSesion(supabase: SupabaseClient): Promise<Sesion> {
  const { data, error } = await supabase.auth.getClaims(undefined, { jwks: LLAVES_SUPABASE })
  if (error && isAuthRetryableFetchError(error)) return { estado: 'auth-no-disponible' }
  const claims = data?.claims
  if (!claims?.sub) return { estado: 'sin-sesion' }
  return { estado: 'activa', userId: claims.sub, email: (claims.email as string | undefined) ?? null }
}

/** A dónde va quien no tiene una sesión utilizable. */
export const RUTA_AUTH_NO_DISPONIBLE = '/auth/no-disponible'
