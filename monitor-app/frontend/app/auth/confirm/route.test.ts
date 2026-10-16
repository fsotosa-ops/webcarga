// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: vi.fn() }) }))
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { verifyOtp: vi.fn().mockResolvedValue({ error: null }) } }),
}))

import { GET } from './route'

const abrir = async (consulta: string) =>
  (await GET(new NextRequest(`https://app.webcarga.test/auth/confirm?${consulta}`))).headers.get('location')

describe('/auth/confirm', () => {
  it('la invitación lleva a crear la contraseña: sin ella, la cuenta no puede volver a entrar con su correo', async () => {
    // Caso Enrique (16/10): entró por el enlace, nunca eligió clave y el login le decía que no la reconocía.
    expect(await abrir('token_hash=abc&type=invite')).toBe('https://app.webcarga.test/auth/reset-password')
  })

  it('recuperar la contraseña también, y un destino propio seguro manda', async () => {
    expect(await abrir('token_hash=abc&type=recovery')).toBe('https://app.webcarga.test/auth/reset-password')
    expect(await abrir('token_hash=abc&type=magiclink&next=/dashboard/compliance')).toBe('https://app.webcarga.test/dashboard/compliance')
  })
})
