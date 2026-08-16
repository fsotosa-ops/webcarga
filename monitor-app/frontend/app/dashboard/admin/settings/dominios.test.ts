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
    expect(dominioPorClave('certification')?.titulo).toBe('Certificación')
    expect(dominioPorClave('no-existe')).toBeUndefined()
  })

  // RED DE LA MUDANZA. Los demas tests iteran DOMINIOS, asi que borrar una
  // seccion —o el dominio Flota entero— los deja a todos en verde: una seccion
  // sin ruta es INVISIBLE, no rota, y ningun test la extrana.
  //
  // Esta es la unica expectativa independiente del registro, y por eso se
  // escribe a mano. Si se agrega un dominio, se agrega aca; si se quita uno a
  // proposito, este test lo obliga a ser una decision explicita.
  it('estan los dominios y secciones que la mudanza tenia que preservar', () => {
    const mapa = Object.fromEntries(
      DOMINIOS.map(d => [d.clave, d.secciones.map(s => s.clave).sort()]),
    )

    expect(mapa).toEqual({
      certification: ['conditions', 'expiry-alerts'],
      operations: [
        'alert-thresholds', 'driver-reasons', 'equipment-statuses',
        'operational-statuses', 'temperature-ranges', 'tms-statuses',
      ],
      fleet:    ['operation-types', 'subtypes'],
      people:   ['users'],
      billing:  [],
    })
  })

  // La seccion activa se guarda por clave en useState, asi que dos secciones
  // con la misma clave en dominios distintos no colisionan hoy -- pero si
  // alguna vez se pasa a la URL, si.
  it('las claves de seccion no se repiten entre dominios', () => {
    const todas = DOMINIOS.flatMap(d => d.secciones.map(s => s.clave))
    expect(new Set(todas).size).toBe(todas.length)
  })
})
