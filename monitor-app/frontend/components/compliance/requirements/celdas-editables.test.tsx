import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RequirementOption } from '@/lib/types'

vi.mock('@/lib/api/requirements', () => ({
  requirementsApi: { patchConditions: vi.fn() },
}))
import { requirementsApi } from '@/lib/api/requirements'
import { CeldaNombre } from './celdas-editables'

const REQ: RequirementOption = {
  id: 'r1', requirement_code: 'F30_MULTAS', name: 'F30 Multas',
  target_entity: 'CARRIER', requirement_level: 'LEGAL_MANDATORY',
  expiration_policy: 'REQUIRED', is_active: true,
  applies_to_fleet_service_type_ids: null, applies_to_management_types: null,
  alcance: { alcanzadas: 39, universo: 248 },
} as RequirementOption

function montar(ui: React.ReactNode) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(requirementsApi.patchConditions).mockReset().mockResolvedValue({} as never)
})

describe('CeldaNombre', () => {
  it('renombra en la celda, sin abrir nada', async () => {
    montar(<CeldaNombre requisito={REQ} puedeEditar />)
    fireEvent.click(screen.getByRole('button', { name: 'Renombrar F30 Multas' }))
    fireEvent.change(screen.getByLabelText('Nombre de F30_MULTAS'), {
      target: { value: 'F30-1 Multas' },
    })
    fireEvent.keyDown(screen.getByLabelText('Nombre de F30_MULTAS'), { key: 'Enter' })

    await waitFor(() => expect(requirementsApi.patchConditions)
      .toHaveBeenCalledWith('r1', { name: 'F30-1 Multas' }))
  })

  // Sin salida que no sea guardar, empezar a editar por accidente obliga a
  // dejar algo escrito.
  it('Escape descarta y no guarda', () => {
    montar(<CeldaNombre requisito={REQ} puedeEditar />)
    fireEvent.click(screen.getByRole('button', { name: 'Renombrar F30 Multas' }))
    const input = screen.getByLabelText('Nombre de F30_MULTAS')
    fireEvent.change(input, { target: { value: 'otra cosa' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(requirementsApi.patchConditions).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Renombrar F30 Multas' })).toBeInTheDocument()
  })

  it('un nombre vacío se descarta: una fila sin nombre no se puede identificar', () => {
    montar(<CeldaNombre requisito={REQ} puedeEditar />)
    fireEvent.click(screen.getByRole('button', { name: 'Renombrar F30 Multas' }))
    const input = screen.getByLabelText('Nombre de F30_MULTAS')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)

    expect(requirementsApi.patchConditions).not.toHaveBeenCalled()
  })

  it('sin cambios no escribe: un UPDATE sin efecto deja una fila de auditoría falsa', () => {
    montar(<CeldaNombre requisito={REQ} puedeEditar />)
    fireEvent.click(screen.getByRole('button', { name: 'Renombrar F30 Multas' }))
    fireEvent.blur(screen.getByLabelText('Nombre de F30_MULTAS'))

    expect(requirementsApi.patchConditions).not.toHaveBeenCalled()
  })

  it('el código se muestra y no se edita: es la llave del clasificador', () => {
    montar(<CeldaNombre requisito={REQ} puedeEditar />)
    expect(screen.getByText('F30_MULTAS')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Renombrar F30 Multas' }))
    // Un solo campo de texto: el nombre. El código no tiene ninguno.
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
  })

  it('sin permiso no ofrece editar', () => {
    montar(<CeldaNombre requisito={REQ} puedeEditar={false} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('F30 Multas')).toBeInTheDocument()
  })
})
