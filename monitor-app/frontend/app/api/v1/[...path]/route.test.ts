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

// El fetch de Node descomprime de forma transparente lo que responde FastAPI,
// asi que lo que comprimiera el backend se perdia en este mismo archivo y el
// navegador recibia el JSON crudo. Medido en dev sobre la ficha de una
// empresa: encodedBodySize 57.183 == decodedBodySize 57.183, 0% de ahorro. La
// compresion se mueve aca, al unico salto que de verdad llega al navegador.
import { gunzipSync } from 'node:zlib'

function pedido(acepta: string) {
  // El handler lee `req.nextUrl.search`: un Request de fetch pelado no lo
  // tiene, igual que en `req()` mas arriba en este archivo.
  const base = new Request('http://localhost/api/v1/lo-que-sea', {
    headers: { 'Accept-Encoding': acepta },
  })
  return Object.assign(base, { nextUrl: new URL(base.url) }) as never
}

const paramsCompresion = Promise.resolve({ path: ['lo-que-sea'] })

describe('el proxy comprime lo que devuelve', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('una respuesta grande viaja comprimida, y se puede descomprimir', async () => {
    // La forma real: JSON con las mismas claves repetidas en cada fila.
    const grande = JSON.stringify(
      Array.from({ length: 400 }, (_, i) => ({ id: `c${i}`, business_name: 'Transportes De Prueba' })),
    )
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(grande, { status: 200, headers: { 'content-type': 'application/json' } }),
    ))

    const res = await GET(pedido('gzip'), { params: paramsCompresion })

    expect(res.headers.get('content-encoding')).toBe('gzip')
    const bytes = Buffer.from(await res.arrayBuffer())
    // Se descomprime y da EXACTAMENTE lo que mandó el backend: comprimir mal
    // rompe la aplicación entera de una forma que sólo se ve en vivo.
    expect(gunzipSync(bytes).toString()).toBe(grande)
    expect(bytes.length).toBeLessThan(grande.length / 5)
  })

  it('una respuesta chica viaja sin comprimir', async () => {
    const chica = JSON.stringify({ ok: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(chica, { status: 200, headers: { 'content-type': 'application/json' } }),
    ))

    const res = await GET(pedido('gzip'), { params: paramsCompresion })

    expect(res.headers.get('content-encoding')).toBeNull()
    expect(await res.text()).toBe(chica)
  })

  it('si el cliente no acepta gzip, no se comprime', async () => {
    const grande = 'x'.repeat(5000)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(grande, { status: 200, headers: { 'content-type': 'application/json' } }),
    ))

    const res = await GET(pedido('identity'), { params: paramsCompresion })

    expect(res.headers.get('content-encoding')).toBeNull()
    expect(await res.text()).toBe(grande)
  })

  it('comprime sin bloquear el event loop', async () => {
    // `gzipSync` bloquearia el bucle en el camino de cada peticion y con varias
    // en paralelo se serializan: la optimizacion se vuelve el cuello de botella.
    // Se afirma que durante la compresion el bucle sigue atendiendo.
    const grande = 'a'.repeat(2_000_000)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(grande, { status: 200, headers: { 'content-type': 'application/json' } }),
    ))

    let tickCorrio = false
    const enVuelo = GET(pedido('gzip'), { params: paramsCompresion })
    setImmediate(() => { tickCorrio = true })
    await enVuelo

    expect(tickCorrio, 'el bucle no atendio nada mientras comprimia').toBe(true)
  })

  it('un 204 sigue sin cuerpo', async () => {
    // Ya rompió una vez: construir una Response con cuerpo para 204 lanza
    // TypeError y el navegador veía un 502 en TODO DELETE de la app.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))

    const res = await GET(pedido('gzip'), { params: paramsCompresion })

    expect(res.status).toBe(204)
    expect(res.headers.get('content-encoding')).toBeNull()
  })
})
