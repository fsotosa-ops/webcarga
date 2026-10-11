import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Trip } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({ tripsApi: { voidTrips: vi.fn(), revertVoid: vi.fn() } }))

vi.mock('@/hooks/useMotivosDeAnulacion', async importOriginal => ({
  ...(await importOriginal<typeof import('@/hooks/useMotivosDeAnulacion')>()),
  useMotivosDeAnulacion: () => ({ cargando: false, motivos: [
    { id: 'dup', label: 'Duplicado', pideNota: false },
    { id: 'otro', label: 'Otro', pideNota: true },
  ] }),
}))

import { AnularViaje } from './AnularViaje'
import { tripsApi } from '@/lib/api/trips'

const voidTrips = vi.mocked(tripsApi.voidTrips)
const revertVoid = vi.mocked(tripsApi.revertVoid)

function montar(trip: Partial<Trip>) {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <AnularViaje trip={{ id: 't1', ...trip } as Trip} />
    </QueryClientProvider>,
  )
}

beforeEach(() => { voidTrips.mockReset(); revertVoid.mockReset() })

describe('AnularViaje', () => {
  it('no aparece si no se puede anular ni revertir', () => {
    const { container } = montar({ can_void: false, can_revert_void: false })
    expect(container).toBeEmptyDOMElement()
  })

  it('no anula sin motivo', () => {
    montar({ can_void: true })
    fireEvent.click(screen.getByRole('button', { name: /anular viaje/i }))
    expect(screen.getByRole('button', { name: /sí, anular/i })).toBeDisabled()
  })

  it('anula con el motivo elegido', async () => {
    voidTrips.mockResolvedValue({ ok: true, voided: 1 })
    montar({ can_void: true })
    fireEvent.click(screen.getByRole('button', { name: /anular viaje/i }))
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: 'dup' } })
    fireEvent.click(screen.getByRole('button', { name: /sí, anular/i }))
    await waitFor(() => expect(voidTrips).toHaveBeenCalledWith(['t1'], 'dup', undefined))
  })

  it('con «Otro» exige comentario', () => {
    montar({ can_void: true })
    fireEvent.click(screen.getByRole('button', { name: /anular viaje/i }))
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: 'otro' } })
    expect(screen.getByRole('button', { name: /sí, anular/i })).toBeDisabled()
    expect(screen.getByLabelText(/comentario \(obligatorio\)/i)).toBeInTheDocument()
  })

  it('un viaje anulado ofrece deshacer la anulación', async () => {
    revertVoid.mockResolvedValue({ ok: true, reverted: 1 })
    montar({ can_revert_void: true, voided_at: '2026-10-10T20:00:00Z', void_reason_label: 'Duplicado' })
    fireEvent.click(screen.getByRole('button', { name: /deshacer anulación/i }))
    await waitFor(() => expect(revertVoid).toHaveBeenCalledWith(['t1']))
  })
})
