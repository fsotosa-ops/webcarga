import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { TripOperationType } from './TripOperationType'
import { tripsApi } from '@/lib/api/trips'
import type { Trip } from '@/lib/types'

const permisos = vi.hoisted(() => ({ editar: true }))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => permisos.editar }))
vi.mock('@/lib/api/trips', () => ({ tripsApi: { declareOperationType: vi.fn(), clearOperationType: vi.fn() } }))
vi.mock('@/lib/api/config', () => ({ taxonomiesApi: { list: vi.fn().mockResolvedValue([
  { id: 't-tr', label: 'Tractoreo', code: 'TRACTOREO' },
  { id: 't-ec', label: 'Equipo Completo', code: 'EQUIPO_COMPLETO' },
]) } }))

const TRIP = {
  id: 'v1', operation_type_id: 't-ec', operation_type_label: 'Equipo Completo',
  operation_type_source: 'client', operation_type_conflict: true,
} as unknown as Trip

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('TripOperationType', () => {
  beforeEach(() => {
    permisos.editar = true
    vi.mocked(tripsApi.declareOperationType).mockReset()
    vi.mocked(tripsApi.clearOperationType).mockReset()
  })

  it('dice el tipo, de dónde sale y marca el conflicto con el cliente', () => {
    wrap(<TripOperationType trip={TRIP} onSaved={vi.fn()} />)
    expect(screen.getByText('Equipo Completo')).toBeInTheDocument()
    expect(screen.getByText('· Según el cliente')).toBeInTheDocument()
    expect(screen.getByText('Tipo distinto al del cliente')).toBeInTheDocument()
  })

  it('Operaciones lo cambia con un comentario y el viaje vuelve actualizado', async () => {
    const onSaved = vi.fn()
    const actualizado = { ...TRIP, operation_type_source: 'declared', operation_type_conflict: false } as Trip
    vi.mocked(tripsApi.declareOperationType).mockResolvedValue(actualizado)
    wrap(<TripOperationType trip={TRIP} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }))
    await screen.findByRole('option', { name: 'Tractoreo' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Tipo de operación' }), { target: { value: 't-tr' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Comentario' }), { target: { value: 'Llevó solo el tracto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(tripsApi.declareOperationType).toHaveBeenCalledWith('v1', {
      operation_type_id: 't-tr', note: 'Llevó solo el tracto' }))
    expect(onSaved).toHaveBeenCalledWith(actualizado)
  })

  it('lo declarado se puede devolver a lo calculado', async () => {
    vi.mocked(tripsApi.clearOperationType).mockResolvedValue(TRIP)
    wrap(<TripOperationType trip={{ ...TRIP, operation_type_source: 'declared' } as Trip} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Volver al tipo calculado' }))
    await waitFor(() => expect(tripsApi.clearOperationType).toHaveBeenCalledWith('v1'))
  })

  it('sin permiso se lee, no se cambia', () => {
    permisos.editar = false
    wrap(<TripOperationType trip={TRIP} onSaved={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Cambiar' })).not.toBeInTheDocument()
  })
})
