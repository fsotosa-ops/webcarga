import { describe, it, expect } from 'vitest'
import { esUrlVieja, leerUrlDelCierre, urlDelCierre } from './cierre'

const p = (q: string) => new URLSearchParams(q)

describe('URL del Cierre', () => {
  it('lee la forma en inglés', () => {
    expect(leerUrlDelCierre(p('date=2026-10-10&tab=trips&scope=equipo_completo')))
      .toEqual({ date: '2026-10-10', tab: 'trips', scope: 'equipo_completo' })
  })

  it('lee los enlaces viejos en español, para no romper marcadores ni el ?next= del detalle', () => {
    expect(leerUrlDelCierre(p('fecha=2026-10-07&tab=viajes'))).toEqual({ date: '2026-10-07', tab: 'trips', scope: 'tractoreo' })
    expect(leerUrlDelCierre(p('tab=flota')).tab).toBe('fleet')
    expect(leerUrlDelCierre(p('tab=pendientes')).tab).toBe('pending')
    expect(leerUrlDelCierre(p('tab=reporte')).tab).toBe('report')
  })

  it('lo que no reconoce lo deja en null, sin inventar', () => {
    expect(leerUrlDelCierre(p('tab=xyz&scope=foo'))).toEqual({ date: null, tab: null, scope: 'tractoreo' })
  })

  it('escribe siempre en inglés, y borra las claves viejas', () => {
    expect(urlDelCierre(p('fecha=2026-10-07&tab=viajes&otro=1'), { scope: 'equipo_completo' }))
      .toBe('/dashboard/operations/closures?otro=1&date=2026-10-07&tab=trips&scope=equipo_completo')
  })

  it('reconoce una URL vieja para reescribirla', () => {
    expect(esUrlVieja(p('fecha=2026-10-07'))).toBe(true)
    expect(esUrlVieja(p('tab=viajes'))).toBe(true)
    expect(esUrlVieja(p('date=2026-10-07&tab=trips'))).toBe(false)
    expect(esUrlVieja(p('date=2026-10-07&tab=trips&trips=tracking'))).toBe(true)
  })

  it('la sub-pestaña vieja de Viajes (?trips=) pasa a ser el filtro de Situación', () => {
    expect(urlDelCierre(p('date=2026-10-07&tab=trips&trips=tracking'), {}))
      .toBe('/dashboard/operations/closures?date=2026-10-07&tab=trips&f.situation=En%2520seguimiento')
  })

  it('cambiar de pestaña o de alcance no arrastra los filtros de la tabla anterior', () => {
    const conFiltros = p('date=2026-10-07&tab=fleet&f.carrier=Hasa&q=ana&sort=primary:asc')
    expect(urlDelCierre(conFiltros, { tab: 'trips' })).toBe('/dashboard/operations/closures?date=2026-10-07&tab=trips')
    // Cambiar de alcance conserva los filtros: la sección decide cuáles siguen aplicando (C7).
    expect(urlDelCierre(conFiltros, { scope: 'equipo_completo' }))
      .toBe('/dashboard/operations/closures?f.carrier=Hasa&q=ana&sort=primary%3Aasc&date=2026-10-07&tab=fleet&scope=equipo_completo')
  })
})
