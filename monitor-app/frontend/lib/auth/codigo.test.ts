import { describe, it, expect } from 'vitest'
import { soloDigitos } from './codigo'

describe('soloDigitos', () => {
  it('acepta el código con espacio de Microsoft Authenticator', () => {
    expect(soloDigitos('123 456')).toBe('123456')
  })
  it('acepta guiones y espacios al pegar', () => {
    expect(soloDigitos(' 123-456 ')).toBe('123456')
  })
  it('no pasa de 6 dígitos', () => {
    expect(soloDigitos('1234567')).toBe('123456')
  })
})
