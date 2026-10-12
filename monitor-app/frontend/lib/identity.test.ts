// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { canonicalPlate, canonicalRut, plateSearchKey, rutSearchKey } from './identity'

describe('identidad canónica, espejo de la base (D1 §7.2)', () => {
  it('RUT: con o sin puntos y guion es el mismo; un DV que no cierra no es un RUT', () => {
    expect(canonicalRut('12.345.678-5')).toBe('12345678-5')
    expect(canonicalRut('123456785')).toBe('12345678-5')
    expect(canonicalRut('1.234.567-4')).toBe('1234567-4')
    expect(canonicalRut('10.000.013-k')).toBe('10000013-K')
    expect(canonicalRut('10000004-0')).toBe('10000004-0')
    expect(canonicalRut('12.345.678-9')).toBeNull()
    expect(canonicalRut('1234567')).toBeNull()
    expect(canonicalRut('K2345678')).toBeNull()
    expect(canonicalRut(null)).toBeNull()
  })

  it('patente: con guion, espacio o tabulador es la misma', () => {
    expect(canonicalPlate('ab-cd 12')).toBe('ABCD12')
    expect(canonicalPlate('GBVC90\t')).toBe('GBVC90')
    expect(canonicalPlate('ABC12')).toBeNull()
  })

  it('claves de búsqueda parcial: sin adornos, para comparar un pedazo', () => {
    expect(rutSearchKey('22.222.222')).toBe('22222222')
    expect(rutSearchKey('10.000.013-k')).toBe('10000013K')
    // La K mayúscula del DV también es parte del RUT, no "otra letra".
    expect(rutSearchKey('10.000.013-K')).toBe('10000013K')
    expect(rutSearchKey('013-K')).toBe('013K')
    expect(plateSearchKey('ab-cd')).toBe('ABCD')
  })

  it('la clave de RUT exige 4 caracteres y ninguna letra salvo K', () => {
    expect(rutSearchKey('123')).toBe('')
    expect(rutSearchKey('Kevin')).toBe('')
    expect(rutSearchKey('k')).toBe('')
    expect(rutSearchKey('12a45678')).toBe('')
  })
})
