import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'tok' } } }),
    },
  }),
}))

import { apiFetch } from './client'

beforeEach(() => vi.restoreAllMocks())

describe('apiFetch — respuestas sin cuerpo', () => {
  // BUG REAL visto en vivo el 2026-08-14: `res.json()` se llamaba siempre, y
  // un 204 no trae cuerpo, así que lanzaba SyntaxError. La baja de un
  // documento se aplicaba en el backend pero la interfaz la trataba como
  // error: no refrescaba la lista ni mostraba el aviso. Afectaba a todo DELETE.
  it('un 204 resuelve en vez de lanzar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))

    await expect(apiFetch('/api/v1/document-ingest/items/i1', { method: 'DELETE' }))
      .resolves.toBeUndefined()
  })

  it('un 200 con JSON sigue devolviendo el cuerpo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ total: 3 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })))

    await expect(apiFetch<{ total: number }>('/api/v1/x')).resolves.toEqual({ total: 3 })
  })

  it('un error del backend sigue lanzando con su mensaje', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ detail: 'Documento no encontrado' }),
      { status: 404, headers: { 'content-type': 'application/json' } },
    )))

    await expect(apiFetch('/api/v1/x')).rejects.toThrow(/Documento no encontrado/)
  })
})

describe('apiFetch — errores sin detalle', () => {
  // El 22/09 la base se saturó y el cierre del día "falló" con un mensaje que
  // no decía si se había aplicado. Un 502/503/504 lo produce la
  // infraestructura: lo que sirve saber es que NO se aplicó y que se puede
  // reintentar.
  it.each([502, 503, 504])('un %i sin detalle dice que no se aplicó y que se puede reintentar', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Gateway Timeout', { status })))

    await expect(apiFetch('/api/v1/closures/2026-09-22/close', { method: 'POST' }))
      .rejects.toThrow(/no se aplicó.*reintenta/i)
  })

  it('un 500 del backend con detalle muestra ese detalle', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ detail: 'Error inesperado al procesar la solicitud (ref. ab12cd34).' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    )))

    await expect(apiFetch('/api/v1/trips', { method: 'POST' })).rejects.toThrow(/ref\. ab12cd34/)
  })
})
