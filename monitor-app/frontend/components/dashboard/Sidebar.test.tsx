import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/carriers',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}))
vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: { listQueue: vi.fn() },
}))

import { documentIngestApi } from '@/lib/api/documentIngest'
import Sidebar from './Sidebar'

function setup() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Sidebar role="admin" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(documentIngestApi.listQueue).mockReset()
})

describe('Sidebar — la bandeja', () => {
  it('muestra el contador de trabajo pendiente', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 2000, rows: [] })
    setup()
    expect(await screen.findByText('2000')).toBeInTheDocument()
  })

  it('sin cola pendiente no muestra un cero al pedo', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    setup()
    expect(await screen.findAllByText('Bandeja')).not.toHaveLength(0)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('apunta a la ruta de la bandeja', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    setup()
    const links = await screen.findAllByRole('link', { name: /bandeja/i })
    expect(links[0]).toHaveAttribute('href', '/dashboard/compliance/inbox')
  })
})

// HU-04: un módulo por objeto de trabajo. Bandeja, Pendientes y Empresas son
// vistas DE Certificación, no módulos hermanos — tenerlas sueltas en el primer
// nivel es la fragmentación que la HU viene a resolver.
describe('Sidebar — Certificación es un módulo, no un ítem suelto', () => {
  beforeEach(() => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
  })

  it('agrupa Bandeja, Pendientes y Empresas bajo Certificación', async () => {
    setup()
    const grupo = await screen.findByRole('button', { name: /certificación/i })
    expect(grupo).toHaveAttribute('aria-expanded', 'true')

    for (const [label, href] of [
      ['Bandeja', '/dashboard/compliance/inbox'],
      ['Pendientes', '/dashboard/compliance'],
      ['Empresas', '/dashboard/carriers'],
    ] as const) {
      const links = await screen.findAllByRole('link', { name: new RegExp(`^${label}$`, 'i') })
      expect(links[0]).toHaveAttribute('href', href)
    }
  })

  it('Empresas ya no es un módulo de primer nivel', async () => {
    setup()
    await screen.findByRole('button', { name: /certificación/i })
    // Si siguiera suelto, habría un botón de grupo propio para Empresas.
    expect(screen.queryByRole('button', { name: /^empresas$/i })).not.toBeInTheDocument()
  })

  it('el grupo se abre solo cuando estás dentro de una de sus vistas', async () => {
    setup()
    // pathname mockeado = /dashboard/carriers, que ahora vive en el grupo.
    const grupo = await screen.findByRole('button', { name: /certificación/i })
    expect(grupo).toHaveAttribute('aria-expanded', 'true')
  })
})
