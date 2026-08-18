import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
  })),
}))

import { tripsApi } from './trips'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('tripsApi.list — construcción de URL', () => {
  // BUG REAL (2026-07-21, confirmado en logs de Cloud Run producción): la
  // URL se armaba como `/api/v1/trips/${suffix}` (slash de más antes del
  // query string) — con cualquier filtro aplicado quedaba
  // `/api/v1/trips/?fecha=...`, y next.config.ts (trailingSlash: false,
  // default) hacía que Next.js devolviera 308 antes de que el route handler
  // catch-all llegara a ejecutarse. El Diario nunca cargaba viajes
  // filtrados en producción.
  it('no antepone un slash extra antes del query string', async () => {
    let requestedUrl: string | null = null
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requestedUrl = url
      return new Response(JSON.stringify({ data: [], count: 0, page: 1, limit: 200 }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }))

    await tripsApi.list({ fecha: '2026-07-21', view: 'en_curso', limit: 200 })

    expect(requestedUrl).not.toBeNull()
    expect(requestedUrl).not.toContain('/trips/?')
    expect(requestedUrl).toMatch(/^\/api\/v1\/trips\?/)
  })

  it('no deja trailing slash cuando no hay ningún filtro', async () => {
    let requestedUrl: string | null = null
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requestedUrl = url
      return new Response(JSON.stringify({ data: [], count: 0, page: 1, limit: 100 }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }))

    await tripsApi.list()

    expect(requestedUrl).toBe('/api/v1/trips')
  })

  it('serializa fleet_match cuando se pasa (HU-04)', async () => {
    let requestedUrl: string | null = null
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requestedUrl = url
      return new Response(JSON.stringify({ data: [], count: 0, page: 1, limit: 100 }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }))

    await tripsApi.list({ fleet_match: 'mismatch' })

    expect(requestedUrl).toBe('/api/v1/trips?fleet_match=mismatch')
  })
})

describe('tripsApi.cierreViajes — construcción de URL', () => {
  // Menor 10 (revisión de rama, 2026-08-18): `cierreViajes` interpolaba
  // `?fecha=${fecha}` sin `encodeURIComponent`, a diferencia de
  // `dailyClosuresApi.get` en el mismo flujo (Centro de Cierre). No rompe
  // hoy porque `fecha` siempre llega como YYYY-MM-DD, pero es el mismo
  // patrón inconsistente que ya causó bugs de URL en este archivo.
  it('codifica la fecha en el query string', async () => {
    let requestedUrl: string | null = null
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requestedUrl = url
      return new Response(JSON.stringify({ grupos: {}, bloquean: 0 }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }))

    await tripsApi.cierreViajes('2026-08-18')

    expect(requestedUrl).toBe('/api/v1/trips/cierre-viajes?fecha=2026-08-18')
  })

  // Sin encodeURIComponent, un valor con caracteres especiales (p.ej. un
  // "&" o un espacio pegado por error) rompe el query string en vez de
  // viajar como parte del valor de `fecha`. Prueba real de que la función
  // codifica, no sólo que un ISO date pasa igual con o sin ella.
  it('escapa caracteres que romperían el query string', async () => {
    let requestedUrl: string | null = null
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requestedUrl = url
      return new Response(JSON.stringify({ grupos: {}, bloquean: 0 }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }))

    await tripsApi.cierreViajes('2026-08-18&extra=1')

    expect(requestedUrl).toBe('/api/v1/trips/cierre-viajes?fecha=2026-08-18%26extra%3D1')
  })
})
