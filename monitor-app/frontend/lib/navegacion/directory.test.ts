import { describe, expect, it } from 'vitest'
import { assetHref, carrierHref, carrierPanelHref, driverHref, returnLink } from './directory'

describe('direcciones canónicas del Directorio', () => {
  it('cada entidad tiene una dirección que depende solo de su id', () => {
    expect(carrierHref('c1')).toBe('/dashboard/carriers/c1')
    expect(driverHref('d1')).toBe('/dashboard/drivers/d1')
    expect(assetHref('a1')).toBe('/dashboard/assets/a1')
  })

  it('la vuelta viaja codificada en ?next=', () => {
    const cierre = '/dashboard/operations/closures?date=2026-10-08&tab=trips'
    expect(driverHref('d1', cierre)).toBe(`/dashboard/drivers/d1?next=${encodeURIComponent(cierre)}`)
  })

  it('el panel de la ficha de empresa conserva la vuelta', () => {
    expect(carrierPanelHref('c1', { kind: 'driver', id: 'd1' })).toBe('/dashboard/carriers/c1?tab=conductores&driver=d1')
    expect(carrierPanelHref('c1', { kind: 'asset', id: 'a1' }, '/x'))
      .toBe(`/dashboard/carriers/c1?tab=equipos&asset=a1&next=${encodeURIComponent('/x')}`)
  })
})

describe('returnLink', () => {
  it('nombra adónde vuelve y solo acepta rutas de la app', () => {
    expect(returnLink('/dashboard/operations/closures?date=2026-10-08'))
      .toEqual({ href: '/dashboard/operations/closures?date=2026-10-08', label: 'Volver al Cierre' })
    expect(returnLink('/dashboard/operations/monitor')?.label).toBe('Volver al Monitor')
    expect(returnLink('/dashboard/compliance')?.label).toBe('Volver')
    expect(returnLink('https://phishing.example')).toBeNull()
    expect(returnLink(null)).toBeNull()
  })

  it('volver a una lista del Directorio la nombra', () => {
    expect(returnLink('/dashboard/drivers?documents=pending')?.label).toBe('Volver a Conductores')
    expect(returnLink('/dashboard/assets')?.label).toBe('Volver a Equipos')
    expect(returnLink('/dashboard/carriers?q=andes')?.label).toBe('Volver al Directorio')
    expect(returnLink('/dashboard/carriers/t1?tab=conductores')?.label).toBe('Volver a la empresa')
    expect(returnLink('/dashboard/clients?vista=inactivos')?.label).toBe('Volver a Clientes')
    expect(returnLink('/dashboard/clients/s1?tab=empresas')?.label).toBe('Volver al cliente')
    expect(returnLink('/dashboard/compliance/requirements?state=sin-vigencia')?.label).toBe('Volver a Documentos exigidos')
  })
})

