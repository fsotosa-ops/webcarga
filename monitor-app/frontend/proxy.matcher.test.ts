// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { config } from './proxy'

// El proxy manda al login a quien no tiene sesión. Los archivos estáticos
// (logo, ícono) los pide también la pantalla de login: si pasaran por el
// proxy, el logo se vería roto justo ahí.
const pasaPorElProxy = (ruta: string) => new RegExp(`^${config.matcher[0]}$`).test(ruta)

describe('matcher del proxy', () => {
  it('no intercepta el logo ni el ícono', () => {
    expect(pasaPorElProxy('/brand/webcarga-logo.png')).toBe(false)
    expect(pasaPorElProxy('/icon.png')).toBe(false)
    expect(pasaPorElProxy('/favicon.ico')).toBe(false)
  })
  it('sí intercepta las pantallas', () => {
    expect(pasaPorElProxy('/dashboard/operations/monitor')).toBe(true)
    expect(pasaPorElProxy('/login')).toBe(true)
  })
})
