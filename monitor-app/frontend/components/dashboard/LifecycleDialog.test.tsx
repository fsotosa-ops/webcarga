import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { LifecycleDialog } from './LifecycleDialog'

const motivos = vi.hoisted(() => ({ filas: [] as object[] }))
vi.mock('@/lib/api/config', () => ({ taxonomiesApi: { list: vi.fn(() => Promise.resolve(motivos.filas)) } }))

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const IMPACT = { drivers: 2, assets: 1, trips_today: 3, open_closure_days: 1 }

describe('LifecycleDialog', () => {
  beforeEach(() => {
    motivos.filas = [{ id: 'r-fin', label: 'Término de la relación comercial', group: 'all', code: 'RELATIONSHIP_ENDED' }]
  })

  it('dar de baja una empresa: no se confirma mientras se calcula lo que toca', async () => {
    wrap(<LifecycleDialog action="deactivate" scope="carrier" label="Acme" impact={null} onClose={vi.fn()} onConfirm={vi.fn()} />)
    await screen.findByRole('option', { name: 'Término de la relación comercial' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Motivo' }), { target: { value: 'r-fin' } })
    expect(screen.getByText(/Calculando qué toca la baja/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar baja' })).toBeDisabled()
  })

  it('dar de baja una empresa: muestra su flota, sus viajes de hoy y los días abiertos', async () => {
    wrap(<LifecycleDialog action="deactivate" scope="carrier" label="Acme" impact={IMPACT} onClose={vi.fn()} onConfirm={vi.fn()} />)
    expect(await screen.findByText(/2 conductores y 1 equipo/)).toBeInTheDocument()
    expect(screen.getByText('Viajes de hoy: 3.')).toBeInTheDocument()
  })

  it('sin motivos activos lo dice y no deja confirmar', async () => {
    motivos.filas = []
    wrap(<LifecycleDialog action="reactivate" scope="driver" label="conductor Juan" onClose={vi.fn()} onConfirm={vi.fn()} />)
    expect(await screen.findByText(/No hay motivos de reactivación activos/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reactivar' })).toBeDisabled()
  })
})
