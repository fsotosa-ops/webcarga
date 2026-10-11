import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useQuickView } from './quickView'

const driver = { kind: 'driver' as const, id: 'd1', label: 'Vidal Gallardo' }
const carrier = { kind: 'carrier' as const, id: 'c1', label: 'Hueraman' }

describe('useQuickView', () => {
  it('abre una entidad, navega a otra dentro del panel y vuelve, sin abrir un segundo panel', () => {
    const { result } = renderHook(() => useQuickView())
    act(() => result.current.open(driver))
    expect(result.current.current).toEqual(driver)
    expect(result.current.canGoBack).toBe(false)

    act(() => result.current.navigate(carrier))
    expect(result.current.current).toEqual(carrier)
    expect(result.current.canGoBack).toBe(true)

    act(() => result.current.back())
    expect(result.current.current).toEqual(driver)
  })

  it('abrir desde una fila empieza de cero, y cerrar lo vacía', () => {
    const { result } = renderHook(() => useQuickView())
    act(() => { result.current.open(driver); result.current.navigate(carrier) })
    act(() => result.current.open(carrier))
    expect(result.current.canGoBack).toBe(false)
    act(() => result.current.close())
    expect(result.current.current).toBeNull()
  })
})
