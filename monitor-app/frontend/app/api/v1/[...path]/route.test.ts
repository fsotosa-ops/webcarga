import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1' } } }),
      getSession: async () => ({ data: { session: { access_token: 'tok' } } }),
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
