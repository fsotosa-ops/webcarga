import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ replace: vi.fn(), next: null as string | null }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.next ? `next=${encodeURIComponent(nav.next)}` : ''),
}))
vi.mock('@/lib/api/entitySummary', async original => ({
  ...(await original<typeof import('@/lib/api/entitySummary')>()),
  fetchEntitySummary: vi.fn(),
}))

import { fetchEntitySummary } from '@/lib/api/entitySummary'
import { EntityRedirect } from './EntityRedirect'

function renderRedirect(kind: 'driver' | 'asset', id = 'd1') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EntityRedirect kind={kind} id={id} />
    </QueryClientProvider>,
  )
}

beforeEach(() => { nav.replace.mockReset(); nav.next = null; vi.mocked(fetchEntitySummary).mockReset() })

describe('EntityRedirect', () => {
  it('un conductor con empresa abre su panel en la ficha de la empresa, conservando la vuelta', async () => {
    nav.next = '/dashboard/operations/closures?date=2026-10-08'
    vi.mocked(fetchEntitySummary).mockResolvedValue({ carrier: { id: 'c9', name: 'Bugarín' } } as never)
    renderRedirect('driver')
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(
      `/dashboard/carriers/c9?tab=conductores&driver=d1&next=${encodeURIComponent(nav.next!)}`))
  })

  it('un equipo abre el panel de equipos', async () => {
    vi.mocked(fetchEntitySummary).mockResolvedValue({ carrier: { id: 'c9', name: 'Bugarín' } } as never)
    renderRedirect('asset', 'a1')
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/dashboard/carriers/c9?tab=equipos&asset=a1'))
  })

  it('sin empresa no redirige: dice por qué y ofrece el Directorio', async () => {
    vi.mocked(fetchEntitySummary).mockResolvedValue({ carrier: null } as never)
    renderRedirect('driver')
    expect(await screen.findByText('Este conductor no está asignado a ninguna empresa')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ir al Directorio' })).toHaveAttribute('href', '/dashboard/carriers')
    expect(nav.replace).not.toHaveBeenCalled()
  })

  it('si no existe lo dice, en vez de una página en blanco', async () => {
    vi.mocked(fetchEntitySummary).mockRejectedValue(Object.assign(new Error('Conductor no encontrado'), { status: 404 }))
    renderRedirect('driver')
    expect(await screen.findByText('No se encontró en el directorio')).toBeInTheDocument()
  })
})
