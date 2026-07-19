import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePinnedAlertSignals } from './usePinnedAlertSignals'

beforeEach(() => {
  localStorage.clear()
})

describe('usePinnedAlertSignals', () => {
  it('defaults to off_time/unassigned/stale when localStorage is empty', () => {
    const { result } = renderHook(() => usePinnedAlertSignals())
    expect(result.current.pinned).toEqual(['off_time', 'unassigned', 'stale'])
  })

  it('togglePin adds and removes, persisting to localStorage', () => {
    const { result } = renderHook(() => usePinnedAlertSignals())
    act(() => result.current.togglePin('active'))
    expect(result.current.pinned).toContain('active')
    expect(JSON.parse(localStorage.getItem('diario:alertas-pineadas')!)).toContain('active')

    act(() => result.current.togglePin('off_time'))
    expect(result.current.pinned).not.toContain('off_time')
  })

  it('reads a previously saved preference on mount', () => {
    localStorage.setItem('diario:alertas-pineadas', JSON.stringify(['dwell']))
    const { result } = renderHook(() => usePinnedAlertSignals())
    expect(result.current.pinned).toEqual(['dwell'])
  })

  it('ignores corrupted localStorage and keeps the default', () => {
    localStorage.setItem('diario:alertas-pineadas', 'not json{')
    const { result } = renderHook(() => usePinnedAlertSignals())
    expect(result.current.pinned).toEqual(['off_time', 'unassigned', 'stale'])
  })
})
