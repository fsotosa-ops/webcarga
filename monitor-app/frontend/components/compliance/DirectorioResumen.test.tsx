import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/api/carriers', () => ({ carriersApi: { directorio: vi.fn() } }))

import { carriersApi } from '@/lib/api/carriers'
import { DirectorioResumen } from './DirectorioResumen'

function renderConQuery(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
  )
}

describe('DirectorioResumen', () => {
  it('nombra el ciclo de vida con el glosario: "dadas de baja", nunca "inactivas"', async () => {
    vi.mocked(carriersApi.directorio).mockResolvedValue({
      empresas: { total: 251, activas: 36, inactivas: 214, onboarding: 1 },
      flota: { tractos: 1, ramplas: 1, conductores: 78 },
    } as never)
    renderConQuery(<DirectorioResumen />)
    expect(await screen.findByText(/214 dadas de baja/)).toBeInTheDocument()
    expect(screen.queryByText(/inactivas/)).not.toBeInTheDocument()
  })
})
