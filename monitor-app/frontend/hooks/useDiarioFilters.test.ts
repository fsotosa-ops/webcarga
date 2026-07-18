import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDiarioFilters, countActiveFilters } from './useDiarioFilters'

describe('useDiarioFilters', () => {
  it('starts on en_curso with the given date and no filters', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    const [f] = result.current
    expect(f.tab).toBe('en_curso')
    expect(f.fecha).toBe('2026-07-04')
    expect(countActiveFilters(f)).toBe(0)
  })

  it('patch resets page to 1 unless page is in the patch', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    act(() => result.current[1]({ type: 'patch', patch: { page: 3 } }))
    expect(result.current[0].page).toBe(3)
    act(() => result.current[1]({ type: 'patch', patch: { q: 'ABCD' } }))
    expect(result.current[0].page).toBe(1)
    expect(result.current[0].q).toBe('ABCD')
  })

  it('toggleGroup activates and deactivates the same key', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    act(() => result.current[1]({ type: 'toggleGroup', key: 'default:en_ruta' }))
    expect(result.current[0].activeGroup).toBe('default:en_ruta')
    act(() => result.current[1]({ type: 'toggleGroup', key: 'default:en_ruta' }))
    expect(result.current[0].activeGroup).toBeNull()
  })

  it('toggleTms adds and removes sources', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    act(() => result.current[1]({ type: 'toggleTms', id: 'wingsuite' }))
    act(() => result.current[1]({ type: 'toggleTms', id: 'sodimac' }))
    expect(result.current[0].fTms).toEqual(['wingsuite', 'sodimac'])
    act(() => result.current[1]({ type: 'toggleTms', id: 'wingsuite' }))
    expect(result.current[0].fTms).toEqual(['sodimac'])
  })

  it('clear wipes filters (incluyendo el filtro KPI) but keeps tab and fecha', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    act(() => result.current[1]({ type: 'patch', patch: { q: 'x' } }))
    act(() => result.current[1]({ type: 'toggleFlag', field: 'fIsActive' }))
    act(() => result.current[1]({ type: 'toggleKpi', kpi: 'off_time' }))
    act(() => result.current[1]({ type: 'clear' }))
    const [f] = result.current
    expect(countActiveFilters(f)).toBe(0)
    expect(f.kpiFilter).toBeNull()
    expect(f.fecha).toBe('2026-07-04')
    expect(f.tab).toBe('en_curso')
  })

  it('fRegion/fCity cuentan como filtros activos y clear los resetea', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    act(() => result.current[1]({ type: 'patch', patch: { fRegion: 'Biobío', fCity: 'Concepción' } }))
    expect(countActiveFilters(result.current[0])).toBe(2)
    act(() => result.current[1]({ type: 'clear' }))
    expect(result.current[0].fRegion).toBe('')
    expect(result.current[0].fCity).toBe('')
    expect(countActiveFilters(result.current[0])).toBe(0)
  })

  it('kpiFilter cuenta en activeCount y togglea', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    act(() => result.current[1]({ type: 'toggleKpi', kpi: 'stale' }))
    expect(result.current[0].kpiFilter).toBe('stale')
    expect(countActiveFilters(result.current[0])).toBe(1)
    act(() => result.current[1]({ type: 'toggleKpi', kpi: 'stale' }))
    expect(result.current[0].kpiFilter).toBeNull()
  })
})
