import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const replace = vi.fn()
let query = 'date=2026-10-16&tab=fleet&f.empresa=Hasa'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(query),
  usePathname: () => '/dashboard/operations/closures',
}))

import { useUrlView } from './useUrlView'

beforeEach(() => { replace.mockReset(); query = 'date=2026-10-16&tab=fleet&f.empresa=Hasa' })

describe('useUrlView', () => {
  it('lee la vista de la URL y la escribe con replace, conservando lo ajeno', () => {
    const { result } = renderHook(() => useUrlView())
    expect(result.current[0].filters).toEqual({ empresa: ['Hasa'] })
    act(() => result.current[1]({ filters: {}, q: 'ana', sort: null }))
    expect(replace).toHaveBeenCalledWith('/dashboard/operations/closures?date=2026-10-16&tab=fleet&q=ana', { scroll: false })
  })

  // Revisión final (16/10): `router.replace` llega a la URL recién cuando Next la
  // confirma (una ida y vuelta). Mientras tanto, la vista es la que se escribió.
  it('dos cambios seguidos antes de que la URL confirme: el segundo parte del primero', () => {
    const { result } = renderHook(() => useUrlView())
    act(() => result.current[1]({ ...result.current[0], filters: { empresa: ['Hasa', 'Huemul'] } }))
    expect(result.current[0].filters).toEqual({ empresa: ['Hasa', 'Huemul'] })
    act(() => result.current[1]({ ...result.current[0], q: 'ana' }))
    expect(replace).toHaveBeenLastCalledWith(
      '/dashboard/operations/closures?date=2026-10-16&tab=fleet&f.empresa=Hasa%2CHuemul&q=ana', { scroll: false })
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
})
