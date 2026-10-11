import { describe, it, expect } from 'vitest'
import { esUrlVieja, leerUrlDelCierre, urlDelCierre } from './cierre'

const p = (q: string) => new URLSearchParams(q)

describe('URL del Cierre', () => {
  it('lee la forma en inglés', () => {
    expect(leerUrlDelCierre(p('date=2026-10-10&tab=trips&trips=tracking')))
      .toEqual({ date: '2026-10-10', tab: 'trips', trips: 'tracking' })
  })

  it('lee los enlaces viejos en español, para no romper marcadores ni el ?next= del detalle', () => {
    expect(leerUrlDelCierre(p('fecha=2026-10-07&tab=viajes'))).toEqual({ date: '2026-10-07', tab: 'trips', trips: null })
    expect(leerUrlDelCierre(p('tab=flota')).tab).toBe('fleet')
    expect(leerUrlDelCierre(p('tab=pendientes')).tab).toBe('pending')
    expect(leerUrlDelCierre(p('tab=reporte')).tab).toBe('report')
  })

  it('lo que no reconoce lo deja en null, sin inventar', () => {
    expect(leerUrlDelCierre(p('tab=xyz&trips=foo'))).toEqual({ date: null, tab: null, trips: null })
  })

  it('escribe siempre en inglés, y borra las claves viejas', () => {
    expect(urlDelCierre(p('fecha=2026-10-07&tab=viajes&otro=1'), { trips: 'resolved' }))
      .toBe('/dashboard/operations/closures?otro=1&date=2026-10-07&tab=trips&trips=resolved')
  })

  it('reconoce una URL vieja para reescribirla', () => {
    expect(esUrlVieja(p('fecha=2026-10-07'))).toBe(true)
    expect(esUrlVieja(p('tab=viajes'))).toBe(true)
    expect(esUrlVieja(p('date=2026-10-07&tab=trips'))).toBe(false)
  })
})
