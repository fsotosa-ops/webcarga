import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Trip } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({ tripsApi: { voidTrips: vi.fn() } }))

import { useAnularViajes } from './useAnularViajes'
import { ApiError } from '@/lib/api/client'
import { tripsApi } from '@/lib/api/trips'

const voidTrips = vi.mocked(tripsApi.voidTrips)

const viaje = (id: string, can_void: boolean) => ({ id, can_void } as Trip)

function montar(visibles: Trip[]) {
  const qc = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  return renderHook(({ v }) => useAnularViajes(v), { wrapper, initialProps: { v: visibles } })
}

beforeEach(() => voidTrips.mockReset())

describe('useAnularViajes', () => {
  it('"todos" marca sólo los que se pueden anular, y la segunda vez desmarca', () => {
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
    voidTrips.mockRejectedValueOnce(new ApiError('No se anuló ningún viaje', 409, {
      message: 'No se anuló ningún viaje',
      errors: [{ trip_id: 'a', error: 'El cierre del 22/09 está firmado: lo anula quien puede firmar el cierre' }],
    }))
    const { result } = montar([viaje('a', true)])
    act(() => result.current.seleccion.onToggle('a'))

    await act(async () => { await result.current.anularSeleccion('Duplicado') })

    expect(result.current.error).toMatch(/cierre del 22\/09 está firmado/)
    expect(result.current.seleccion.ids.has('a')).toBe(true)
  })

  it('al anular manda los marcados con el motivo y los desmarca', async () => {
    voidTrips.mockResolvedValue({ ok: true, voided: 2 })
    const { result } = montar([viaje('a', true), viaje('c', true)])
    act(() => result.current.seleccion.onToggleAll())

    await act(async () => { await result.current.anularSeleccion('Duplicado') })

    expect(voidTrips).toHaveBeenCalledWith(['a', 'c'], 'Duplicado')
    expect(result.current.seleccion.ids.size).toBe(0)
    expect(result.current.error).toBeNull()
  })
})
