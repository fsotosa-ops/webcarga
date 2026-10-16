import { describe, it, expect } from 'vitest'
import type { AssignedRow } from '@/lib/types'
import { arbolDeAsignados, filasDelArbol } from './arbolDeAsignados'

const fila = (client_name: string, origin: string, carrier_name: string, rm: number, region = 0): AssignedRow => ({
  client_name, origin, carrier_name, rm, z0: 0, region, unclassified: 0, total: rm + region,
  vehicles: [
    ...Array.from({ length: rm }, (_, i) => ({ tractor_plate: `RM${i}`, driver_name: `Conductor RM${i}`, zone: 'rm' as const })),
    ...Array.from({ length: region }, (_, i) => ({ tractor_plate: `RG${i}`, driver_name: null, zone: 'region' as const })),
  ],
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

  it('hasta la empresa lista todo en orden de lectura (el Excel)', () => {
    const filas = filasDelArbol(arbolDeAsignados(ROWS), (_clave, nivel) => nivel < 2)
    expect(filas.map(f => `${f.nivel}:${f.etiqueta}`)).toEqual([
      '0:Sodimac', '1:CD Quilicura', '2:Norte Spa',
      '0:Walmart', '1:CD Lo Aguirre', '2:Norte Spa', '2:Transportes Sur', '1:CD Quilicura', '2:Transportes Sur',
    ])
  })

  it('un cliente cerrado esconde sus orígenes y un origen cerrado sus empresas', () => {
    const arbol = arbolDeAsignados(ROWS)
    const soloWalmartAbierto = (clave: string, nivel: number) => nivel === 0 && clave === 'Walmart'
    expect(filasDelArbol(arbol, soloWalmartAbierto).map(f => f.etiqueta))
      .toEqual(['Sodimac', 'Walmart', 'CD Lo Aguirre', 'CD Quilicura'])
  })

  it('una empresa abierta muestra sus conductores, cada uno con su patente y un 1 en su zona', () => {
    const arbol = arbolDeAsignados(ROWS)
    const filas = filasDelArbol(arbol)
    const conductores = filas.filter(f => f.nivel === 3 && f.clave.startsWith('Walmart\u0000CD Lo Aguirre\u0000Norte Spa'))
    expect(conductores.map(f => f.etiqueta)).toEqual(['Conductor RM0 · RM0', 'Conductor RM1 · RM1', 'Sin conductor · RG0'])
    expect(conductores[2].cifras).toEqual({ rm: 0, z0: 0, region: 1, unclassified: 0, total: 1 })
    expect(conductores.every(f => !f.plegable)).toBe(true)
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

  it('cada conductor trae sus viajes del día; los subtotales no (D8)', () => {
    const conViajes: AssignedRow = { ...fila('Walmart', 'CD Lo Aguirre', 'Norte Spa', 1),
      vehicles: [{ tractor_plate: 'RM0', driver_name: 'Ana', zone: 'rm', trips: [{ id: 't1', code: '30' }, { id: 't2', code: '31' }] }] }
    const filas = filasDelArbol(arbolDeAsignados([conViajes]))
    expect(filas.find(f => f.nivel === 3)!.trips.map(t => t.code)).toEqual(['30', '31'])
    expect(filas.filter(f => f.nivel < 3).every(f => f.trips.length === 0)).toBe(true)
  })
})
