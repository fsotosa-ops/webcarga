// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
}))
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
  })),
}))

import { POST } from './route'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('proxy BFF', () => {
  it('reenvía cuerpos binarios (multipart) byte-idénticos al backend', async () => {
    // Bytes inválidos como UTF-8 (cabecera PNG + 0xFF): con req.text() se
    // corrompen a U+FFFD y el backend respondía 400 al parsear el multipart
    const binary = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x01,
    ])
    const boundary = 'testboundary'
    const head = new TextEncoder().encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`
    )
    const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`)
    const body = new Uint8Array([...head, ...binary, ...tail])

    let forwarded: Uint8Array | null = null
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      forwarded = new Uint8Array(init.body as Buffer)
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    const req = new NextRequest('http://localhost/api/v1/trips/t1/notes', {
      method: 'POST',
      body,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    })
    const res = await POST(req, { params: Promise.resolve({ path: ['trips', 't1', 'notes'] }) })

    expect(res.status).toBe(200)
    expect(forwarded).not.toBeNull()
    expect(Array.from(forwarded!)).toEqual(Array.from(body))
  })

  it('reenvía JSON intacto con el token de auth', async () => {
    let forwardedBody: string | null = null
    let forwardedAuth: string | null = null
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      forwardedBody = Buffer.from(init.body as Buffer).toString('utf-8')
      forwardedAuth = (init.headers as Record<string, string>)['Authorization'] ?? null
      return new Response('{}', { status: 200 })
    }))

    const req = new NextRequest('http://localhost/api/v1/trips', {
      method: 'POST',
      body: JSON.stringify({ planning_date: '2026-07-06' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req, { params: Promise.resolve({ path: ['trips'] }) })

    expect(res.status).toBe(200)
    expect(forwardedBody).toBe('{"planning_date":"2026-07-06"}')
    expect(forwardedAuth).toBe('Bearer tok')
  })
})
