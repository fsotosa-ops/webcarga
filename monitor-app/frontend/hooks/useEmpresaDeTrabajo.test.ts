import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useEmpresaDeTrabajo } from './useEmpresaDeTrabajo'

const HUEMUL   = { id: 'c1', business_name: 'Inversiones Huemul Spa' }
const HUERAMAN = { id: 'c2', business_name: 'Sociedad De Transportes Hueraman' }
const DEL_LINK = { id: 'c3', business_name: 'Transportes Del Enlace' }

/** El picker devuelve `tax_id` además del nombre; el hook sólo usa dos campos. */
const comoDelPicker = (c: { id: string; business_name: string }) =>
  ({ ...c, tax_id: '76.111.111-1' })

describe('useEmpresaDeTrabajo', () => {
  it('sin nada, no hay empresa y no hay nada que quitar', () => {
    const { result } = renderHook(() => useEmpresaDeTrabajo({}))
    expect(result.current.empresa).toBeNull()
    expect(result.current.origen).toBe('ninguna')
    expect(result.current.sePuedeQuitar).toBe(false)
  })

  // ── La precedencia. Un HECHO manda sobre una ELECCIÓN, porque una elección
  // que contradice al dato no se puede aplicar.

  it('la ruta gana sobre todo: ahí no se está eligiendo, se está parado', () => {
    const { result } = renderHook(() => useEmpresaDeTrabajo({
      deLaRuta: HUEMUL, deLosArchivos: HUERAMAN, inicial: DEL_LINK,
    }))
    act(() => result.current.fijar(comoDelPicker(HUERAMAN)))

    expect(result.current.empresa).toEqual(HUEMUL)
    expect(result.current.origen).toBe('ruta')
    // Y por eso NO se ofrece quitarla: sugeriría que se puede salir de la
    // bandeja de una empresa sin navegar.
    expect(result.current.sePuedeQuitar).toBe(false)
  })

  it('los archivos ganan sobre la elección: es un hecho del dato', () => {
    const { result } = renderHook(() => useEmpresaDeTrabajo({
      deLosArchivos: HUERAMAN, inicial: DEL_LINK,
    }))
    act(() => result.current.fijar(comoDelPicker(HUEMUL)))

    expect(result.current.empresa).toEqual(HUERAMAN)
    expect(result.current.origen).toBe('archivos')
    expect(result.current.sePuedeQuitar).toBe(false)
  })

  it('elegir gana sobre la preselección del enlace', () => {
    const { result } = renderHook(() => useEmpresaDeTrabajo({ inicial: DEL_LINK }))
    expect(result.current.empresa).toEqual(DEL_LINK)

    act(() => result.current.fijar(comoDelPicker(HUEMUL)))
    expect(result.current.empresa).toEqual(HUEMUL)
    expect(result.current.origen).toBe('elegida')
    expect(result.current.sePuedeQuitar).toBe(true)
  })

  // ── El inverso, que es lo que no existía.

  it('se puede quitar, y quitarla no la devuelve en el render siguiente', () => {
    // El caso que hacía parecer roto el botón: quitar una empresa que vino por
    // el enlace la resucitaba, porque la precedencia volvía a encontrarla.
    const { result } = renderHook(() => useEmpresaDeTrabajo({ inicial: DEL_LINK }))
    expect(result.current.empresa).toEqual(DEL_LINK)

    act(() => result.current.quitar())
    expect(result.current.empresa).toBeNull()
    expect(result.current.origen).toBe('ninguna')
  })

  it('después de quitarla se puede volver a elegir', () => {
    const { result } = renderHook(() => useEmpresaDeTrabajo({ inicial: DEL_LINK }))
    act(() => result.current.quitar())
    act(() => result.current.fijar(comoDelPicker(HUEMUL)))

    expect(result.current.empresa).toEqual(HUEMUL)
    expect(result.current.sePuedeQuitar).toBe(true)
  })

  // ── No sembrar estado desde un prop: el bug que este frontend tuvo tres veces.

  it('si la preselección del enlace cambia, la sigue — no quedó congelada', () => {
    const { result, rerender } = renderHook(
      ({ inicial }) => useEmpresaDeTrabajo({ inicial }),
      { initialProps: { inicial: DEL_LINK } },
    )
    expect(result.current.empresa).toEqual(DEL_LINK)

    rerender({ inicial: HUEMUL })
    expect(result.current.empresa).toEqual(HUEMUL)
  })

  it('pero una elección propia NO la pisa un cambio de la preselección', () => {
    const { result, rerender } = renderHook(
      ({ inicial }) => useEmpresaDeTrabajo({ inicial }),
      { initialProps: { inicial: DEL_LINK } },
    )
    act(() => result.current.fijar(comoDelPicker(HUERAMAN)))

    rerender({ inicial: HUEMUL })
    expect(result.current.empresa).toEqual(HUERAMAN)
  })

  it('los archivos marcados destapan la elección cuando dejan de traer empresa', () => {
    // Marcar archivos de una empresa y después desmarcarlos no puede borrar lo
    // que se había elegido a mano: el estado no se pierde, sólo deja de mandar.
    const { result, rerender } = renderHook(
      ({ deLosArchivos }) => useEmpresaDeTrabajo({ deLosArchivos }),
      { initialProps: { deLosArchivos: null as { id: string; business_name: string } | null } },
    )
    act(() => result.current.fijar(comoDelPicker(HUEMUL)))
    expect(result.current.origen).toBe('elegida')

    rerender({ deLosArchivos: HUERAMAN })
    expect(result.current.empresa).toEqual(HUERAMAN)

    rerender({ deLosArchivos: null })
    expect(result.current.empresa).toEqual(HUEMUL)
    expect(result.current.origen).toBe('elegida')
  })
})
