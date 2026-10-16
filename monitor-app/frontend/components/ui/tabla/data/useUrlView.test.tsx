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
})
