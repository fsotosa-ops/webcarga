'use client'

import { useCallback, useState } from 'react'

export type Orden = { columna: string; direccion: 'asc' | 'desc' } | null

/** El estado de orden de una tabla. Generico a proposito: la columna es un
 *  string y la comparacion la aporta quien lo usa, porque ordenar viajes y
 *  ordenar requisitos no se parece en nada. Lo que se comparte es el
 *  COMPORTAMIENTO —primer clic ascendente, segundo descendente— no los datos. */
export function useOrden(inicial: Orden = null) {
  const [orden, setOrden] = useState<Orden>(inicial)

  const ordenarPor = useCallback((columna: string) => {
    setOrden(prev =>
      prev?.columna === columna
        ? { columna, direccion: prev.direccion === 'asc' ? 'desc' : 'asc' }
        : { columna, direccion: 'asc' },
    )
  }, [])

  /** Ordena una copia: Array.prototype.sort muta en el lugar. */
  function comparar<T>(filas: T[], valor: (fila: T) => string | number): T[] {
    if (!orden) return filas
    const signo = orden.direccion === 'asc' ? 1 : -1
    return [...filas].sort((a, b) => {
      const va = valor(a), vb = valor(b)
      // Los textos se comparan CON LAS REGLAS DEL ESPANOL: `>` compara
      // unidades UTF-16, asi que la "N" (U+00D1) cae despues de la "z" y los
      // acentos quedan fuera de lugar. Los numeros siguen comparandose como
      // numeros: localeCompare los ordenaria como texto ("10" antes que "2").
      if (typeof va === 'string' && typeof vb === 'string') {
        return va.localeCompare(vb, 'es') * signo
      }
      if (va === vb) return 0
      return va > vb ? signo : -signo
    })
  }

  return { orden, ordenarPor, comparar }
}
