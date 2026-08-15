import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/requirements', () => ({
  requirementsApi: {
    patchConditions: vi.fn().mockResolvedValue({}),
    recalcPreview:   vi.fn().mockResolvedValue({ crear: 0, quitar: 16, bloqueados: 4 }),
    recalc:          vi.fn().mockResolvedValue({ creados: 0, quitados: 16, bloqueados: 4 }),
  },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))

import { requirementsApi } from '@/lib/api/requirements'
import { RequirementConditionsPanel } from './RequirementConditionsPanel'

const REQ = {
  id: 'r1', requirement_code: 'MANTENCION_FRIO', name: 'Mantención Cámara de Frío',
  target_entity: 'ASSET' as const, is_active: true,
  applies_to_fleet_service_type_ids: null, applies_to_management_types: null,
}
const SUBTIPOS = [
  { id: 't1', label: 'Furgón Congelado / Refrigerado' },
  { id: 't2', label: 'Furgón Seco' },
]

function setup(over = {}) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RequirementConditionsPanel requisito={{ ...REQ, ...over }} subtipos={SUBTIPOS} />
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('RequirementConditionsPanel', () => {
  it('un requisito sin restriccion lo dice, en vez de mostrar cero marcas', () => {
    setup()
    expect(screen.getByText(/aplica a todos/i)).toBeInTheDocument()
  })

  it('no aplica el cambio sin mostrar antes que va a pasar', async () => {
    setup()
    fireEvent.click(screen.getByLabelText('Furgón Congelado / Refrigerado'))
    fireEvent.click(screen.getByRole('button', { name: /ver qué cambia/i }))

    expect(await screen.findByText(/se quitan 16/i)).toBeInTheDocument()
    expect(requirementsApi.recalc).not.toHaveBeenCalled()
  })

  it('nombra los que no puede quitar, en vez de esconderlos', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /ver qué cambia/i }))
    expect(await screen.findByText(/4 .*documento/i)).toBeInTheDocument()
  })

  it('aplicar recien despues de la vista previa', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /ver qué cambia/i }))
    await screen.findByText(/se quitan 16/i)
    fireEvent.click(screen.getByRole('button', { name: /aplicar/i }))
    await waitFor(() => expect(requirementsApi.recalc).toHaveBeenCalledWith('r1'))
  })

  it('un requisito no vigente lo dice', () => {
    setup({ is_active: false })
    expect(screen.getByText(/no está vigente/i)).toBeInTheDocument()
  })

  it('un lector no puede cambiar nada', async () => {
    vi.resetModules()
    vi.doMock('@/hooks/useCanEdit', () => ({ useCanEdit: () => false }))
    const { RequirementConditionsPanel: SoloLectura } = await import('./RequirementConditionsPanel')
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SoloLectura requisito={REQ} subtipos={SUBTIPOS} />
      </QueryClientProvider>,
    )
    expect(screen.queryByRole('button', { name: /aplicar/i })).not.toBeInTheDocument()
  })
})
