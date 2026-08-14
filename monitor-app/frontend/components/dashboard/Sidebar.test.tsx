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

  it('la bandeja es un destino propio, no un tab de Certificación', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    setup()
    const links = await screen.findAllByRole('link', { name: /bandeja/i })
    expect(links[0]).toHaveAttribute('href', '/dashboard/compliance/inbox')
  })
})
