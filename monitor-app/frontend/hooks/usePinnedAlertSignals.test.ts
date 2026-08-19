import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePinnedAlertSignals } from './usePinnedAlertSignals'

beforeEach(() => {
  localStorage.clear()
})

describe('usePinnedAlertSignals', () => {
  it('defaults to dwell_severity/temp_out/stale/tms_dropped when localStorage is empty', () => {
    const { result } = renderHook(() => usePinnedAlertSignals())
    expect(result.current.pinned).toEqual(['dwell_severity', 'temp_out', 'stale', 'tms_dropped'])
  })

  it('togglePin adds and removes, persisting to localStorage', () => {
    const { result } = renderHook(() => usePinnedAlertSignals())
    act(() => result.current.togglePin('active'))
    expect(result.current.pinned).toContain('active')
    expect(JSON.parse(localStorage.getItem('diario:alertas-pineadas')!)).toContain('active')

    act(() => result.current.togglePin('dwell_severity'))
    expect(result.current.pinned).not.toContain('dwell_severity')
  })

  it('reads a previously saved preference on mount', () => {
    localStorage.setItem('diario:alertas-pineadas', JSON.stringify(['temp_out']))
    const { result } = renderHook(() => usePinnedAlertSignals())
    expect(result.current.pinned).toEqual(['temp_out'])
  })

  it('ignores corrupted localStorage and keeps the default', () => {
    localStorage.setItem('diario:alertas-pineadas', 'not json{')
    const { result } = renderHook(() => usePinnedAlertSignals())
    expect(result.current.pinned).toEqual(['dwell_severity', 'temp_out', 'stale', 'tms_dropped'])
  })
})
