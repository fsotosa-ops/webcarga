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

// HU-04: un módulo por objeto de trabajo. Certificación es UNA entrada con el
// contador del trabajo pendiente; Bandeja y Pendientes dejaron de ser ítems
// del menú y pasaron a ser dos vistas de la misma pantalla.
describe('Sidebar — Certificación es una sola entrada', () => {
  beforeEach(() => {
    vi.mocked(documentIngestApi.listQueue).mockReset()
  })

  it('muestra el contador de trabajo pendiente', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 2000, rows: [] })
    setup()
    expect(await screen.findByText('2000')).toBeInTheDocument()
  })

  it('sin cola pendiente no muestra un cero al pedo', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    setup()
    expect(await screen.findAllByText('Certificación')).not.toHaveLength(0)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('apunta al módulo, no a un submódulo', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    setup()
    const links = await screen.findAllByRole('link', { name: /certificación/i })
    expect(links[0]).toHaveAttribute('href', '/dashboard/compliance')
  })

  it('no quedan Bandeja ni Pendientes como entradas propias', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    setup()
    await screen.findAllByText('Certificación')
    expect(screen.queryByRole('link', { name: /^bandeja$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^pendientes$/i })).not.toBeInTheDocument()
  })
})
