import { describe, expect, it } from 'vitest'
import { countOf, placesLabel } from './clients'

describe('countOf', () => {
  it('cifra y sustantivo concuerdan', () => {
    expect(countOf(1, 'empresa', 'empresas')).toBe('1 empresa')
    expect(countOf(1830, 'viaje', 'viajes')).toBe('1.830 viajes')
  })
})

describe('placesLabel', () => {
  it('dice cuántos lugares y, si hay, cuántos son de origen', () => {
    expect(placesLabel({ locations: 0, origins: 0 })).toBe('0')
    expect(placesLabel({ locations: 12, origins: 1 })).toBe('12 · 1 origen')
    expect(placesLabel({ locations: 1200, origins: 3 })).toBe('1.200 · 3 orígenes')
  })

  it('fuera de una columna "Lugares" dice qué cuenta', () => {
    expect(placesLabel({ locations: 0, origins: 0 }, { noun: true })).toBe('0 lugares')
    expect(placesLabel({ locations: 1, origins: 1 }, { noun: true })).toBe('1 lugar · 1 origen')
  })
})
