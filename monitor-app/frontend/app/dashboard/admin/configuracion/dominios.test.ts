import { describe, it, expect } from 'vitest'
import { DOMINIOS, dominioPorClave } from './dominios'

describe('registro de dominios', () => {
  it('las claves de dominio son unicas', () => {
    const claves = DOMINIOS.map(d => d.clave)
    expect(new Set(claves).size).toBe(claves.length)
  })

  it('las claves de seccion son unicas dentro de su dominio', () => {
    for (const d of DOMINIOS) {
      const claves = d.secciones.map(s => s.clave)
      expect(new Set(claves).size, `dominio ${d.clave}`).toBe(claves.length)
    }
  })

  // Un dominio sin secciones no tendria que dibujarse como visitable: seria una
  // tarjeta que lleva a una pantalla vacia.
  it('un dominio visitable tiene al menos una seccion', () => {
    for (const d of DOMINIOS.filter(x => !x.proximamente)) {
      expect(d.secciones.length, `dominio ${d.clave}`).toBeGreaterThan(0)
    }
  })

  it('un dominio marcado como proximamente no tiene secciones', () => {
    for (const d of DOMINIOS.filter(x => x.proximamente)) {
      expect(d.secciones.length, `dominio ${d.clave}`).toBe(0)
    }
  })

  it('busca un dominio por su clave', () => {
    expect(dominioPorClave('certificacion')?.titulo).toBe('Certificación')
    expect(dominioPorClave('no-existe')).toBeUndefined()
  })
})
