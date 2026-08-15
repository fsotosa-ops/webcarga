import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUser = vi.fn(async () => ({ data: { user: { id: 'u1' } } }))
let expiresAt = Math.floor(Date.now() / 1000) + 3600

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser,
      getSession: async () => ({ data: { session: { access_token: 'tok', expires_at: expiresAt } } }),
    },
  }),
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}))

import { DELETE, GET } from './route'

function req(method = 'DELETE') {
  // El handler solo usa nextUrl.search, headers, method y arrayBuffer.
  const base = new Request('http://localhost/api/v1/document-ingest/items/i1', { method })
  return Object.assign(base, { nextUrl: new URL(base.url) }) as never
}

const params = Promise.resolve({ path: ['document-ingest', 'items', 'i1'] })

beforeEach(() => vi.restoreAllMocks())

describe('proxy /api/v1 — respuestas sin cuerpo', () => {
  // BUG REAL visto en vivo el 2026-08-14: el backend respondía 204 al descartar
  // un documento, el proxy hacía `new NextResponse(body, { status: 204 })`, el
  // constructor lanzaba —204 no admite cuerpo— y el catch devolvía 502. El
  // documento SÍ se descartaba, pero la interfaz mostraba un error. Afectaba a
  // todos los DELETE de la app.
  it('un 204 del backend llega como 204, no como 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))

    const res = await DELETE(req(), { params })

    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
  })

  it('un 200 con cuerpo sigue pasando el cuerpo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })))

    const res = await GET(req('GET'), { params })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('si el backend no responde, ahí sí es 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))

    const res = await GET(req('GET'), { params })

    expect(res.status).toBe(502)
  })
})


// INCIDENTE REAL (2026-08-15): el proxy llamaba a getUser() en CADA request, y
// getUser() sale a la red contra la API de Auth de Supabase. Una ficha dispara
// decenas de llamadas en paralelo, asi que se alcanzaba el limite y la
// aplicacion devolvia 429 ("Many requests") al abrir un conductor.
describe('proxy /api/v1 — no golpea Auth en cada request', () => {
  beforeEach(() => {
    getUser.mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
      status: 200, headers: { 'content-type': 'application/json' },
    })))
  })

  it('con el token vigente lee la cookie y no sale a la red', async () => {
    expiresAt = Math.floor(Date.now() / 1000) + 3600
    await GET(req('GET'), { params })
    expect(getUser).not.toHaveBeenCalled()
  })

  it('cerca del vencimiento sí refresca', async () => {
    expiresAt = Math.floor(Date.now() / 1000) + 30
    await GET(req('GET'), { params })
    expect(getUser).toHaveBeenCalledTimes(1)
  })
})
