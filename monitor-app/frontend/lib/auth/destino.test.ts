import { describe, it, expect } from 'vitest'
import { destinoSeguro } from './destino'

describe('destinoSeguro', () => {
  it('acepta una ruta interna', () => {
    expect(destinoSeguro('/auth/reset-password', '/x')).toBe('/auth/reset-password')
  })
  it('rechaza URLs externas y redirecciones abiertas', () => {
    for (const malo of ['https://evil.com', '//evil.com', '/\\evil.com', 'evil.com']) {
      expect(destinoSeguro(malo, '/x')).toBe('/x')
    }
  })
  it('sin next usa el destino por defecto', () => {
    expect(destinoSeguro(null, '/x')).toBe('/x')
  })
})
