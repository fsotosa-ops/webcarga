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
