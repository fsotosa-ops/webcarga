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

describe('destinoSeguro ante caracteres que el navegador descarta', () => {
  it('rechaza tabulaciones, saltos de línea y barras invertidas en cualquier lugar', () => {
    // El navegador quita \t y \n al resolver la URL: "/\t/evil.com" termina en https://evil.com.
    for (const next of ['/\t/evil.com', '/\n/evil.com', '/\r//evil.com', '/ok\\..\\evil', '/a\u0000b']) {
      expect(destinoSeguro(next, '/dashboard')).toBe('/dashboard')
    }
  })

  it('sigue aceptando una ruta interna normal, con su query', () => {
    expect(destinoSeguro('/dashboard/operations/closures?date=2026-10-08&tab=trips', '/x'))
      .toBe('/dashboard/operations/closures?date=2026-10-08&tab=trips')
  })
})
