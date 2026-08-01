import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDiarioFilters, countActiveFilters } from './useDiarioFilters'

describe('useDiarioFilters', () => {
  it('starts on en_curso with no filters', () => {
    const { result } = renderHook(() => useDiarioFilters())
    const [f] = result.current
    expect(f.tab).toBe('en_curso')
    expect(countActiveFilters(f)).toBe(0)
  })

  it('patch resets page to 1 unless page is in the patch', () => {
    const { result } = renderHook(() => useDiarioFilters())
    act(() => result.current[1]({ type: 'patch', patch: { page: 3 } }))
    expect(result.current[0].page).toBe(3)
    act(() => result.current[1]({ type: 'patch', patch: { q: 'ABCD' } }))
    expect(result.current[0].page).toBe(1)
    expect(result.current[0].q).toBe('ABCD')
  })

  it('toggleGroup activates and deactivates the same key', () => {
    const { result } = renderHook(() => useDiarioFilters())
    act(() => result.current[1]({ type: 'toggleGroup', key: 'default:en_ruta' }))
    expect(result.current[0].activeGroup).toBe('default:en_ruta')
    act(() => result.current[1]({ type: 'toggleGroup', key: 'default:en_ruta' }))
    expect(result.current[0].activeGroup).toBeNull()
  })

  it('toggleTms adds and removes sources', () => {
    const { result } = renderHook(() => useDiarioFilters())
    act(() => result.current[1]({ type: 'toggleTms', id: 'wingsuite' }))
    act(() => result.current[1]({ type: 'toggleTms', id: 'sodimac' }))
    expect(result.current[0].fTms).toEqual(['wingsuite', 'sodimac'])
    act(() => result.current[1]({ type: 'toggleTms', id: 'wingsuite' }))
    expect(result.current[0].fTms).toEqual(['sodimac'])
  })

  it('toggleOperationType adds and removes types', () => {
    const { result } = renderHook(() => useDiarioFilters())
    act(() => result.current[1]({ type: 'toggleOperationType', id: 'RM' }))
    act(() => result.current[1]({ type: 'toggleOperationType', id: 'ZONA_CERO' }))
    expect(result.current[0].fOperationType).toEqual(['RM', 'ZONA_CERO'])
    act(() => result.current[1]({ type: 'toggleOperationType', id: 'RM' }))
    expect(result.current[0].fOperationType).toEqual(['ZONA_CERO'])
  })

  it('toggleSignal adds and removes signals, any kind, same action', () => {
    const { result } = renderHook(() => useDiarioFilters())
    act(() => result.current[1]({ type: 'toggleSignal', id: 'dwell_severity' }))
    act(() => result.current[1]({ type: 'toggleSignal', id: 'active' }))
    expect(result.current[0].activeSignals).toEqual(['dwell_severity', 'active'])
    act(() => result.current[1]({ type: 'toggleSignal', id: 'dwell_severity' }))
    expect(result.current[0].activeSignals).toEqual(['active'])
  })

  // 2026-08-02: Cliente/Tipo de carga/Origen — filtros nuevos (ver AGENTLOG,
  // rediseño UX/UI del Diario), mismo patrón toggle que fTms/fOperationType.
  it('toggleClient adds and removes clients', () => {
    const { result } = renderHook(() => useDiarioFilters())
    act(() => result.current[1]({ type: 'toggleClient', id: 'Walmart' }))
    act(() => result.current[1]({ type: 'toggleClient', id: 'Sodimac' }))
    expect(result.current[0].fClient).toEqual(['Walmart', 'Sodimac'])
    act(() => result.current[1]({ type: 'toggleClient', id: 'Walmart' }))
    expect(result.current[0].fClient).toEqual(['Sodimac'])
  })

  it('toggleCargoType adds and removes cargo types', () => {
    const { result } = renderHook(() => useDiarioFilters())
    act(() => result.current[1]({ type: 'toggleCargoType', id: 'FRIO' }))
    expect(result.current[0].fCargoType).toEqual(['FRIO'])
    act(() => result.current[1]({ type: 'toggleCargoType', id: 'FRIO' }))
    expect(result.current[0].fCargoType).toEqual([])
  })

  it('toggleOrigin adds and removes origins', () => {
    const { result } = renderHook(() => useDiarioFilters())
    act(() => result.current[1]({ type: 'toggleOrigin', id: 'CD Quilicura' }))
    expect(result.current[0].fOrigin).toEqual(['CD Quilicura'])
    act(() => result.current[1]({ type: 'toggleOrigin', id: 'CD Quilicura' }))
    expect(result.current[0].fOrigin).toEqual([])
  })

  // 2026-08-02: ordenamiento server-side real — mismo ciclo de 3 estados
  // que antes vivía como useState local dentro de TripTable.tsx.
  describe('toggleSort', () => {
    it('cycles null → asc → desc → null for the same column', () => {
      const { result } = renderHook(() => useDiarioFilters())
      act(() => result.current[1]({ type: 'toggleSort', col: 'planning_date' }))
      expect(result.current[0]).toMatchObject({ sortKey: 'planning_date', sortDir: 'asc' })
      act(() => result.current[1]({ type: 'toggleSort', col: 'planning_date' }))
      expect(result.current[0]).toMatchObject({ sortKey: 'planning_date', sortDir: 'desc' })
      act(() => result.current[1]({ type: 'toggleSort', col: 'planning_date' }))
      expect(result.current[0]).toMatchObject({ sortKey: null, sortDir: 'asc' })
    })

    it('switching to a different column resets to asc', () => {
      const { result } = renderHook(() => useDiarioFilters())
      act(() => result.current[1]({ type: 'toggleSort', col: 'planning_date' }))
      act(() => result.current[1]({ type: 'toggleSort', col: 'planning_date' })) // now desc
      act(() => result.current[1]({ type: 'toggleSort', col: 'driver_name' }))
      expect(result.current[0]).toMatchObject({ sortKey: 'driver_name', sortDir: 'asc' })
    })
  })

  it('clear wipes filters (incluyendo activeSignals/fClient/fCargoType/fOrigin) but keeps tab', () => {
    const { result } = renderHook(() => useDiarioFilters())
    act(() => result.current[1]({ type: 'patch', patch: { q: 'x' } }))
    act(() => result.current[1]({ type: 'toggleSignal', id: 'active' }))
    act(() => result.current[1]({ type: 'toggleSignal', id: 'dwell_severity' }))
    act(() => result.current[1]({ type: 'toggleClient', id: 'Walmart' }))
    act(() => result.current[1]({ type: 'toggleCargoType', id: 'FRIO' }))
    act(() => result.current[1]({ type: 'toggleOrigin', id: 'CD Quilicura' }))
    act(() => result.current[1]({ type: 'clear' }))
    const [f] = result.current
    expect(countActiveFilters(f)).toBe(0)
    expect(f.activeSignals).toEqual([])
    expect(f.fClient).toEqual([])
    expect(f.fCargoType).toEqual([])
    expect(f.fOrigin).toEqual([])
    expect(f.tab).toBe('en_curso')
  })

  it('fOperationType cuenta como filtro activo y clear lo resetea', () => {
    const { result } = renderHook(() => useDiarioFilters())
    act(() => result.current[1]({ type: 'toggleOperationType', id: 'RM' }))
    act(() => result.current[1]({ type: 'toggleOperationType', id: 'ZONA_CERO' }))
    expect(countActiveFilters(result.current[0])).toBe(2)
    act(() => result.current[1]({ type: 'clear' }))
    expect(result.current[0].fOperationType).toEqual([])
    expect(countActiveFilters(result.current[0])).toBe(0)
  })

  it('activeSignals cuenta en activeCount, cada señal por separado', () => {
    const { result } = renderHook(() => useDiarioFilters())
    act(() => result.current[1]({ type: 'toggleSignal', id: 'stale' }))
    expect(countActiveFilters(result.current[0])).toBe(1)
    act(() => result.current[1]({ type: 'toggleSignal', id: 'active' }))
    expect(countActiveFilters(result.current[0])).toBe(2)
  })
})
