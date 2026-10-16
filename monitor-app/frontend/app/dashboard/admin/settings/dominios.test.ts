import { describe, it, expect } from 'vitest'
import { DOMINIOS, areasVisibles, dominioPorClave, puedeVerArea } from './dominios'
import { SECCION_DE_TAXONOMIA } from './settings-sources'
import { PERMISO_DE_SECCION } from './secciones'

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
        'operational-statuses', 'origins', 'temperature-ranges',
        // Spec 2026-10-11: la correspondencia cliente del TMS → cliente del directorio.
        'tms-clients', 'tms-statuses', 'unassigned-reasons', 'void-reasons',
      ],
      fleet:    ['operation-types', 'subtypes'],
      insurance: ['expiry-alerts'],
      people:   ['roles', 'users'],
      billing:  [],
    })
  })

  // La seccion activa se guarda por clave en useState, asi que dos secciones
  // con la misma clave en dominios distintos no colisionan hoy -- pero si
  // alguna vez se pasa a la URL, si.
  it('Operaciones tiene "Motivos de anulación", aparte y justo después de los de no asignación', () => {
    const claves = dominioPorClave('operations')!.secciones.map(s => s.clave)
    expect(claves.indexOf('void-reasons')).toBe(claves.indexOf('unassigned-reasons') + 1)
    expect(SECCION_DE_TAXONOMIA.TRIP_VOID_REASON).toEqual(['operations', 'void-reasons'])
  })

  // "Alertas de vencimiento" existe en Certificación y en Seguros: lo único que no
  // se repite es `area/section`, que es la clave del permiso (secciones.ts).
  it('cada sección tiene su permiso declarado con la clave area/section', () => {
    for (const d of DOMINIOS) for (const s of d.secciones) {
      expect(PERMISO_DE_SECCION, `${d.clave}/${s.clave}`).toHaveProperty([`${d.clave}/${s.clave}`])
    }
  })
})

describe('quién ve cada área (Parte 1)', () => {
  it('un área se ve con el permiso de alguna de sus secciones', () => {
    const personas = dominioPorClave('people')!
    expect(puedeVerArea(personas, ['operations.configure'])).toBe(false)
    expect(puedeVerArea(personas, ['users.manage'])).toBe(true)
    expect(puedeVerArea(personas, ['roles.manage'])).toBe(true)
  })
  it('Personas y accesos tiene las secciones Personas y Roles', () => {
    expect(dominioPorClave('people')!.secciones.map(s => s.titulo)).toEqual(['Personas', 'Roles'])
  })
  it('sin ningún permiso de configuración no se ve ningún área; la reservada nunca', () => {
    expect(areasVisibles([])).toEqual([])
    expect(areasVisibles(['users.manage', 'operations.configure', 'certification.configure', 'insurance.configure'])
      .map(a => a.clave)).not.toContain('billing')
  })
})
