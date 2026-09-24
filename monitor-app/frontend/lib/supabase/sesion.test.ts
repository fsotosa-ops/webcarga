import { describe, it, expect, vi } from 'vitest'
import { AuthRetryableFetchError, AuthInvalidJwtError, type SupabaseClient } from '@supabase/supabase-js'
import { leerSesion, LLAVES_SUPABASE } from './sesion'
import jwks from './jwks.json'

function cliente(respuesta: unknown) {
  const getClaims = vi.fn().mockResolvedValue(respuesta)
  return { supabase: { auth: { getClaims } } as unknown as SupabaseClient, getClaims }
}

describe('leerSesion', () => {
  it('verifica con la llave versionada, sin depender del JWKS de Auth', async () => {
    const { supabase, getClaims } = cliente({ data: { claims: { sub: 'u1', email: 'op@webcarga.cl' } }, error: null })

    expect(await leerSesion(supabase)).toEqual({ estado: 'activa', userId: 'u1', email: 'op@webcarga.cl' })
    expect(getClaims).toHaveBeenCalledWith(undefined, { jwks: LLAVES_SUPABASE })
  })

  // El 22/09: Auth no respondía y la app mandó a todos a /login, donde el
  // botón de Microsoft devolvía "Gateway Timeout".
  it('si Auth no responde, NO lo trata como "sin sesión"', async () => {
    const { supabase } = cliente({ data: null, error: new AuthRetryableFetchError('Gateway Timeout', 504) })
    expect(await leerSesion(supabase)).toEqual({ estado: 'auth-no-disponible' })
  })

  it('un token inválido sí es "sin sesión"', async () => {
    const { supabase } = cliente({ data: null, error: new AuthInvalidJwtError('Invalid JWT signature') })
    expect(await leerSesion(supabase)).toEqual({ estado: 'sin-sesion' })
  })

  it('el archivo sólo trae llaves públicas', () => {
    expect(jwks.keys.length).toBeGreaterThan(0)
    for (const k of jwks.keys) expect(k).not.toHaveProperty('d')
  })
})

describe('getClaims real con la llave provista', () => {
  // No un mock: la librería de verdad, con un token ES256 firmado acá. Fija que
  // la opción `jwks` verifica sin tocar la red (fetch explota si se llama).
  async function tokenFirmado(exp: number) {
    const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const jwk = { ...(await crypto.subtle.exportKey('jwk', par.publicKey)), kid: 'k-test', alg: 'ES256' }
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const cuerpo = `${b64({ alg: 'ES256', typ: 'JWT', kid: 'k-test' })}.${b64({ sub: 'u1', email: 'op@webcarga.cl', exp })}`
    const firma = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, par.privateKey, new TextEncoder().encode(cuerpo))
    return { token: `${cuerpo}.${Buffer.from(firma).toString('base64url')}`, jwk }
  }

  it('verifica localmente, sin llamar a Supabase', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const fetchQueFalla = vi.fn(async () => { throw new Error('no debía salir a la red') })
    const supabase = createClient('https://proyecto.supabase.co', 'anon', {
      global: { fetch: fetchQueFalla as unknown as typeof fetch },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { token, jwk } = await tokenFirmado(Math.floor(Date.now() / 1000) + 600)

    const { data, error } = await supabase.auth.getClaims(token, { jwks: { keys: [jwk as never] } })

    expect(error).toBeNull()
    expect(data?.claims.sub).toBe('u1')
    expect(fetchQueFalla).not.toHaveBeenCalled()
  })
})
