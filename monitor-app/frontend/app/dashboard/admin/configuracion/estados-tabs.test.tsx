import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TaxonomyTab } from './estados-tabs'
import { taxonomiesApi } from '@/lib/api/config'

vi.mock('@/lib/api/config', () => ({
  taxonomiesApi: { list: vi.fn(), create: vi.fn(), patch: vi.fn(), deactivate: vi.fn() },
}))

beforeEach(() => {
  vi.mocked(taxonomiesApi.list).mockReset()
  vi.mocked(taxonomiesApi.create).mockReset()
})

describe('TaxonomyTab', () => {
  it('lists rows for the given domain and hides the board-column select for non-OPERATIONAL_STATE domains', async () => {
    vi.mocked(taxonomiesApi.list).mockResolvedValue([
      { id: 't1', label: 'Disponible', bg_color: '#f0fdf4', text_color: '#166534', sort_order: 1, active: true },
    ])
    render(<TaxonomyTab domain="EQUIPMENT_STATE" title="Estados de Equipo" hint="hint" newLabel="estado de equipo" />)
    expect(await screen.findByDisplayValue('Disponible')).toBeInTheDocument()
    expect(taxonomiesApi.list).toHaveBeenCalledWith('EQUIPMENT_STATE')
    expect(screen.queryByText('Columna del tablero')).not.toBeInTheDocument()
  })

  it('creates a new row scoped to the domain', async () => {
    vi.mocked(taxonomiesApi.list).mockResolvedValue([])
    vi.mocked(taxonomiesApi.create).mockResolvedValue({
      id: 't2', label: 'En Pana', bg_color: '#fef2f2', text_color: '#b91c1c', sort_order: 3, active: true,
    })
    render(<TaxonomyTab domain="EQUIPMENT_STATE" title="Estados de Equipo" hint="hint" newLabel="estado de equipo" />)
    fireEvent.click(await screen.findByText('Nuevo estado de equipo'))
    fireEvent.change(screen.getByLabelText('Nombre de estado de equipo nuevo'), { target: { value: 'En Pana' } })
    fireEvent.click(screen.getByText('Crear'))
    await waitFor(() => expect(taxonomiesApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'EQUIPMENT_STATE', label: 'En Pana' }),
    ))
  })

  it('shows the board-column select for OPERATIONAL_STATE domain', async () => {
    vi.mocked(taxonomiesApi.list).mockResolvedValue([
      { id: 't1', label: 'En bodega', bg_color: '#f3f4f6', text_color: '#374151', sort_order: 1, active: true, group: 'otro' },
    ])
    render(<TaxonomyTab domain="OPERATIONAL_STATE" title="Estados Operacionales" hint="hint" newLabel="estado operacional" />)
    expect(await screen.findByDisplayValue('En bodega')).toBeInTheDocument()
    expect(screen.getByText('Columna del tablero')).toBeInTheDocument()
  })
})
