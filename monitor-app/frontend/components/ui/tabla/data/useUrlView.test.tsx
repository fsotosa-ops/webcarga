import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

// La vista se escribe con `history.replaceState` (sin ida y vuelta al servidor): aquí,
// como con una URL lenta, no cambia lo que lee `useSearchParams` hasta que el test lo dice.
const replace = vi.fn()
let query = 'date=2026-10-16&tab=fleet&f.empresa=Hasa'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(query),
  usePathname: () => '/dashboard/operations/closures',
}))

import { useUrlView } from './useUrlView'

beforeEach(() => {
  replace.mockReset()
  vi.spyOn(window.history, 'replaceState').mockImplementation((_s, _t, url) => replace(url))
  query = 'date=2026-10-16&tab=fleet&f.empresa=Hasa'
})

describe('useUrlView', () => {
  it('lee la vista de la URL y la escribe con replace, conservando lo ajeno', () => {
    const { result } = renderHook(() => useUrlView())
    expect(result.current[0].filters).toEqual({ empresa: ['Hasa'] })
    act(() => result.current[1]({ filters: {}, q: 'ana', sort: null }))
    expect(replace).toHaveBeenCalledWith('/dashboard/operations/closures?date=2026-10-16&tab=fleet&q=ana')
  })

  // Revisión final (16/10): `router.replace` llega a la URL recién cuando Next la
  // confirma (una ida y vuelta). Mientras tanto, la vista es la que se escribió.
  it('dos cambios seguidos antes de que la URL confirme: el segundo parte del primero', () => {
    const { result } = renderHook(() => useUrlView())
    act(() => result.current[1]({ ...result.current[0], filters: { empresa: ['Hasa', 'Huemul'] } }))
    expect(result.current[0].filters).toEqual({ empresa: ['Hasa', 'Huemul'] })
    act(() => result.current[1]({ ...result.current[0], q: 'ana' }))
    expect(replace).toHaveBeenLastCalledWith(
      '/dashboard/operations/closures?date=2026-10-16&tab=fleet&f.empresa=Hasa%2CHuemul&q=ana')
  })

  it('cuando la URL confirma una escritura vieja, la vista no retrocede', () => {
    const { result, rerender } = renderHook(() => useUrlView())
    act(() => result.current[1]({ ...result.current[0], q: 'tra' }))
    act(() => result.current[1]({ ...result.current[0], q: 'tran' }))
    query = 'date=2026-10-16&tab=fleet&f.empresa=Hasa&q=tra'
    rerender()
    expect(result.current[0].q).toBe('tran')
  })

  it('un cambio de la URL que no escribió la tabla ("Volver", otro enlace) manda', () => {
    const { result, rerender } = renderHook(() => useUrlView())
    act(() => result.current[1]({ ...result.current[0], q: 'tra' }))
    query = 'date=2026-10-16&tab=fleet&f.empresa=Huemul'
    rerender()
    expect(result.current[0]).toEqual({ filters: { empresa: ['Huemul'] }, q: '', sort: null })
  })

  it('escribe la URL sin pasar por el router: un filtro no es una navegación ni un pedido al servidor', () => {
    const router = vi.fn()
    const { result } = renderHook(() => useUrlView())
    act(() => result.current[1]({ ...result.current[0], q: 'ana' }))
    expect(replace).toHaveBeenCalledTimes(1)
    expect(router).not.toHaveBeenCalled()
  })

  describe('la vista inicial (Seguros › Empresas abre en "No al día")', () => {
    const INICIAL = { filters: { standing: ['not_up_to_date'] }, q: '', sort: null }

    it('sin vista en la URL, abre con la inicial y la escribe en la URL', () => {
      query = ''
      const { result } = renderHook(() => useUrlView({ initial: INICIAL }))
      expect(result.current[0].filters).toEqual({ standing: ['not_up_to_date'] })
      expect(replace).toHaveBeenCalledWith('/dashboard/operations/closures?f.standing=not_up_to_date')
    })

    it('quitar el filtro lo deja dicho en la URL (view=all), y no se vuelve a poner', () => {
      query = ''
      const { result, rerender } = renderHook(() => useUrlView({ initial: INICIAL }))
      query = 'f.standing=not_up_to_date'
      rerender()
      act(() => result.current[1]({ filters: {}, q: '', sort: null }))
      query = 'view=all'
      rerender()
      expect(result.current[0].filters).toEqual({})
      expect(replace).toHaveBeenLastCalledWith('/dashboard/operations/closures?view=all')
    })

    it('volver a la pantalla (Atrás, un marcador) con view=all no reaplica la inicial', () => {
      query = 'view=all'
      const { result } = renderHook(() => useUrlView({ initial: INICIAL }))
      expect(result.current[0]).toEqual({ filters: {}, q: '', sort: null })
      expect(replace).not.toHaveBeenCalled()
    })

    it('con un filtro de nuevo, view=all sobra y se va', () => {
      query = 'view=all'
      const { result } = renderHook(() => useUrlView({ initial: INICIAL }))
      act(() => result.current[1]({ filters: { standing: ['up_to_date'] }, q: '', sort: null }))
      expect(replace).toHaveBeenLastCalledWith('/dashboard/operations/closures?f.standing=up_to_date')
    })

    it('una tabla sin vista inicial no escribe view=all al vaciarse', () => {
      const { result } = renderHook(() => useUrlView())
      act(() => result.current[1]({ filters: {}, q: '', sort: null }))
      expect(replace).toHaveBeenLastCalledWith('/dashboard/operations/closures?date=2026-10-16&tab=fleet')
    })

    it('un enlace con su propia vista (?q=RUT) manda sobre la inicial', () => {
      query = 'q=76777777'
      const { result } = renderHook(() => useUrlView({ initial: INICIAL }))
      expect(result.current[0]).toEqual({ filters: {}, q: '76777777', sort: null })
      expect(replace).not.toHaveBeenCalled()
    })
  })
})
