import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useOrden } from './useOrden'

describe('useOrden', () => {
  it('el primer clic ordena ascendente', () => {
    const { result } = renderHook(() => useOrden())
    act(() => result.current.ordenarPor('nombre'))
    expect(result.current.orden).toEqual({ columna: 'nombre', direccion: 'asc' })
  })

  it('el segundo clic en la misma columna invierte', () => {
    const { result } = renderHook(() => useOrden())
    act(() => result.current.ordenarPor('nombre'))
    act(() => result.current.ordenarPor('nombre'))
    expect(result.current.orden).toEqual({ columna: 'nombre', direccion: 'desc' })
  })

  // Cambiar de columna arranca ascendente otra vez: heredar el descendente de
  // la columna anterior sorprende, porque el usuario no pidio ese orden.
  it('cambiar de columna vuelve a ascendente', () => {
    const { result } = renderHook(() => useOrden())
    act(() => result.current.ordenarPor('nombre'))
    act(() => result.current.ordenarPor('nombre'))
    act(() => result.current.ordenarPor('otra'))
    expect(result.current.orden).toEqual({ columna: 'otra', direccion: 'asc' })
  })

  it('sin orden devuelve las filas como vinieron', () => {
    const { result } = renderHook(() => useOrden())
    const filas = [{ n: 3 }, { n: 1 }, { n: 2 }]
    expect(result.current.comparar(filas, f => f.n)).toEqual(filas)
  })

  it('ordena por el valor que se le indique, en las dos direcciones', () => {
    const { result } = renderHook(() => useOrden())
    const filas = [{ n: 3 }, { n: 1 }, { n: 2 }]

    act(() => result.current.ordenarPor('n'))
    expect(result.current.comparar(filas, f => f.n).map(f => f.n)).toEqual([1, 2, 3])

    act(() => result.current.ordenarPor('n'))
    expect(result.current.comparar(filas, f => f.n).map(f => f.n)).toEqual([3, 2, 1])
  })

  // Array.prototype.sort MUTA en el lugar. Sin la copia, ordenar la tabla
  // reordenaria el arreglo que vino de react-query -- el mismo objeto que la
  // cache guarda y que otros componentes leen.
  it('no muta el arreglo que recibe', () => {
    const { result } = renderHook(() => useOrden())
    const filas = [{ n: 3 }, { n: 1 }, { n: 2 }]

    act(() => result.current.ordenarPor('n'))
    result.current.comparar(filas, f => f.n)

    expect(filas.map(f => f.n)).toEqual([3, 1, 2])
  })

  // La app esta en espanol: comparar con `>` compara unidades UTF-16, asi que
  // la "N" cae despues de la "z" y los acentos quedan fuera de lugar. Un
  // usuario que busca "Nandu" en una lista alfabetica no lo encuentra al final.
  it('ordena en espanol: la N va entre la N y la O, no despues de la Z', () => {
    const { result } = renderHook(() => useOrden())
    const filas = [{ s: 'Zorro' }, { s: 'Ñandú' }, { s: 'Nube' }, { s: 'Ostra' }]

    act(() => result.current.ordenarPor('s'))
    expect(result.current.comparar(filas, f => f.s).map(f => f.s))
      .toEqual(['Nube', 'Ñandú', 'Ostra', 'Zorro'])
  })

  it('el acento no manda a una etiqueta al final de la lista', () => {
    const { result } = renderHook(() => useOrden())
    const filas = [{ s: 'Bodega' }, { s: 'Área' }, { s: 'Cámara' }]

    act(() => result.current.ordenarPor('s'))
    expect(result.current.comparar(filas, f => f.s).map(f => f.s))
      .toEqual(['Área', 'Bodega', 'Cámara'])
  })

  it('los valores iguales conservan su posicion relativa', () => {
    const { result } = renderHook(() => useOrden())
    const filas = [{ id: 'a', n: 1 }, { id: 'b', n: 1 }, { id: 'c', n: 0 }]

    act(() => result.current.ordenarPor('n'))
    expect(result.current.comparar(filas, f => f.n).map(f => f.id)).toEqual(['c', 'a', 'b'])
  })
})
