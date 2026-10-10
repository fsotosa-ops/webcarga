import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Trip } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({ tripsApi: { bulkRemove: vi.fn() } }))

import { useEliminarViajes } from './useEliminarViajes'
import { ApiError } from '@/lib/api/client'
import { tripsApi } from '@/lib/api/trips'

const bulkRemove = vi.mocked(tripsApi.bulkRemove)

const viaje = (id: string, can_delete: boolean) => ({ id, can_delete } as Trip)

function montar(visibles: Trip[]) {
  const qc = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  return renderHook(({ v }) => useEliminarViajes(v), { wrapper, initialProps: { v: visibles } })
}

beforeEach(() => bulkRemove.mockReset())

describe('useEliminarViajes', () => {
  it('"todos" marca sólo los que se pueden eliminar, y la segunda vez desmarca', () => {
    const { result } = montar([viaje('a', true), viaje('b', false), viaje('c', true)])

    act(() => result.current.seleccion.onToggleAll())
    expect([...result.current.seleccion.ids]).toEqual(['a', 'c'])

    act(() => result.current.seleccion.onToggleAll())
    expect(result.current.seleccion.ids.size).toBe(0)
  })

  it('un viaje que sale de la vista se desmarca solo', () => {
    const { result, rerender } = montar([viaje('a', true), viaje('c', true)])
    act(() => result.current.seleccion.onToggleAll())

    rerender({ v: [viaje('a', true)] })

    expect([...result.current.seleccion.ids]).toEqual(['a'])
  })

  it('si el backend rechaza el lote, muestra el motivo por viaje y no desmarca', async () => {
    bulkRemove.mockRejectedValueOnce(new ApiError('No se eliminó ningún viaje', 409, {
      message: 'No se eliminó ningún viaje',
      errors: [{ trip_id: 'a', error: 'Pertenece al cierre firmado del 22/09; reabre ese día para eliminarlo' }],
    }))
    const { result } = montar([viaje('a', true)])
    act(() => result.current.seleccion.onToggle('a'))

    await act(async () => { await result.current.eliminarSeleccion() })

    expect(result.current.error).toMatch(/cierre firmado del 22\/09/)
    expect(result.current.seleccion.ids.has('a')).toBe(true)
  })

  it('al eliminar manda los marcados y los desmarca', async () => {
    bulkRemove.mockResolvedValue({ ok: true, deleted: 2 })
    const { result } = montar([viaje('a', true), viaje('c', true)])
    act(() => result.current.seleccion.onToggleAll())

    await act(async () => { await result.current.eliminarSeleccion() })

    expect(bulkRemove).toHaveBeenCalledWith(['a', 'c'])
    expect(result.current.seleccion.ids.size).toBe(0)
    expect(result.current.error).toBeNull()
  })
})
