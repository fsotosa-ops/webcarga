import { describe, expect, it } from 'vitest'
import { MONITOR, urlDelViaje, volverDesdeElViaje } from './viaje'

describe('abrir un viaje y volver a donde se estaba', () => {
  it('desde otra pantalla, el viaje se abre recordando a dónde volver', () => {
    expect(urlDelViaje('t1', '/dashboard/operations/closures?fecha=2026-08-04&tab=viajes')).toBe(
      '/dashboard/operations/monitor/trips/t1?next=%2Fdashboard%2Foperations%2Fclosures%3Ffecha%3D2026-08-04%26tab%3Dviajes',
    )
  })
  it('sin pantalla de origen, la URL es la de siempre', () => {
    expect(urlDelViaje('t1')).toBe('/dashboard/operations/monitor/trips/t1')
  })
  it('al cerrar vuelve a la pantalla de origen', () => {
    expect(volverDesdeElViaje('/dashboard/operations/closures?fecha=2026-08-04')).toBe(
      '/dashboard/operations/closures?fecha=2026-08-04')
  })
  it('sin origen, o con uno que no es de la app, vuelve al Monitor', () => {
    expect(volverDesdeElViaje(null)).toBe(MONITOR)
    expect(volverDesdeElViaje('https://otro-sitio.cl')).toBe(MONITOR)
    expect(volverDesdeElViaje('//otro-sitio.cl')).toBe(MONITOR)
  })
})
