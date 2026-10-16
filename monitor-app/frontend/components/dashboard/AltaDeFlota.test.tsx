import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/lib/api/assets', () => ({
  assetsApi: {
    types: vi.fn().mockResolvedValue([
      { code: 'TRACTOCAMION', label: 'Tractocamión', is_power_unit: true },
      { code: 'RAMPLA', label: 'Rampla', is_power_unit: false },
    ]),
    create: vi.fn(),
  },
}))
vi.mock('@/lib/api/config', () => ({
  taxonomiesApi: { list: vi.fn().mockResolvedValue([{ id: 's1', label: 'Furgón Seco' }]) },
}))
vi.mock('@/lib/api/locations', () => ({ locationsApi: { list: vi.fn().mockResolvedValue([]) } }))

import { AltaDeFlota } from './AltaDeFlota'

describe('AltaDeFlota (equipo)', () => {
  it('el subtipo es la carrocería: se ofrece para una rampla, no para un tracto', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AltaDeFlota tipo="equipo" carrierId="c1" abiertoAlInicio onCreado={vi.fn()} />
      </QueryClientProvider>,
    )
    const tipo = await screen.findByRole('combobox', { name: 'Tipo de vehículo' })
    await screen.findByRole('option', { name: 'Rampla' })
    expect(tipo).toHaveValue('TRACTOCAMION')
    expect(screen.queryByRole('combobox', { name: 'Subtipo' })).not.toBeInTheDocument()
    fireEvent.change(tipo, { target: { value: 'RAMPLA' } })
    expect(screen.getByRole('combobox', { name: 'Subtipo' })).toBeInTheDocument()
  })
})
