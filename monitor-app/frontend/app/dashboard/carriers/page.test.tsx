import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import EmpresasTransportePage from './page'
import { carriersApi } from '@/lib/api/carriers'
import { createClient } from '@/lib/supabase/client'
import type { CarrierListResponse } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: vi.fn(), useSearchParams: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { list: vi.fn(), create: vi.fn() },
}))

function emptyResponse(): CarrierListResponse {
  return { data: [], count: 0, page: 1, limit: 100, facets: { pending: 0, ok: 0, total: 0 } }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <EmpresasTransportePage />
    </QueryClientProvider>,
  )
}

const pushMock = vi.fn()

beforeEach(() => {
  pushMock.mockReset()
  vi.mocked(useRouter).mockReturnValue({ push: pushMock } as unknown as ReturnType<typeof useRouter>)
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>)
  vi.mocked(createClient).mockReturnValue({
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    from: vi.fn(),
  } as unknown as ReturnType<typeof createClient>)
  vi.mocked(carriersApi.list).mockReset().mockResolvedValue(emptyResponse())
  vi.mocked(carriersApi.create).mockReset()
})

describe('EmpresasTransportePage', () => {
  it('renders an Onboarding tab alongside Activas/Inactivo', async () => {
    renderPage()
    await waitFor(() => expect(carriersApi.list).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /^Activas/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Inactivo/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Onboarding/ })).toBeInTheDocument()
  })

  it('selecting the Onboarding tab re-queries with operational_status: ONBOARDING', async () => {
    renderPage()
    await waitFor(() => expect(carriersApi.list).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /^Onboarding/ }))
    await waitFor(() => expect(carriersApi.list).toHaveBeenCalledWith(
      expect.objectContaining({ operational_status: 'ONBOARDING' }),
    ))
    expect(screen.getByRole('button', { name: /^Onboarding/ })).toHaveAttribute('aria-pressed', 'true')
  })
})
