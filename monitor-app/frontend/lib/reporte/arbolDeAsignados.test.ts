import { describe, it, expect } from 'vitest'
import type { AssignedRow } from '@/lib/types'
import { arbolDeAsignados, filasDelArbol } from './arbolDeAsignados'

const fila = (client_name: string, origin: string, carrier_name: string, rm: number, region = 0): AssignedRow => ({
  client_name, origin, carrier_name, rm, z0: 0, region, unclassified: 0, total: rm + region,
})

// Ordenadas como las manda la API: cliente, origen, empresa.
const ROWS = [
  fila('Sodimac', 'CD Quilicura', 'Norte Spa', 1),
  fila('Walmart', 'CD Lo Aguirre', 'Norte Spa', 2, 1),
  fila('Walmart', 'CD Lo Aguirre', 'Transportes Sur', 3),
  fila('Walmart', 'CD Quilicura', 'Transportes Sur', 1),
]

describe('arbolDeAsignados', () => {
  it('suma cada cliente y cada origen con sus hijos, y el total con todo', () => {
    const arbol = arbolDeAsignados(ROWS)
    const walmart = arbol.clientes.find(c => c.client_name === 'Walmart')!
    expect(walmart.cifras).toEqual({ rm: 6, z0: 0, region: 1, unclassified: 0, total: 7 })
    expect(walmart.origenes.map(o => [o.origin, o.cifras.total])).toEqual([['CD Lo Aguirre', 6], ['CD Quilicura', 1]])
    expect(arbol.total.total).toBe(8)
  })

  it('sin estado de apertura lista todo en orden de lectura (el Excel)', () => {
    const filas = filasDelArbol(arbolDeAsignados(ROWS))
    expect(filas.map(f => `${f.nivel}:${f.etiqueta}`)).toEqual([
      '0:Sodimac', '1:CD Quilicura', '2:Norte Spa',
      '0:Walmart', '1:CD Lo Aguirre', '2:Norte Spa', '2:Transportes Sur', '1:CD Quilicura', '2:Transportes Sur',
    ])
  })

  it('un cliente cerrado esconde sus orígenes y un origen cerrado sus empresas', () => {
    const arbol = arbolDeAsignados(ROWS)
    const soloWalmartAbierto = (clave: string, nivel: 0 | 1) => nivel === 0 && clave === 'Walmart'
    expect(filasDelArbol(arbol, soloWalmartAbierto).map(f => f.etiqueta))
      .toEqual(['Sodimac', 'Walmart', 'CD Lo Aguirre', 'CD Quilicura'])
  })

  it('el mismo origen en dos clientes son dos nodos distintos', () => {
    const claves = filasDelArbol(arbolDeAsignados(ROWS)).filter(f => f.nivel === 1).map(f => f.clave)
    expect(new Set(claves).size).toBe(claves.length)
  })

  it('sin filas no hay clientes y el total es cero', () => {
    const arbol = arbolDeAsignados([])
    expect(arbol.clientes).toEqual([])
    expect(arbol.total.total).toBe(0)
  })
})
