import { describe, it, expect } from 'vitest'
import type { RequirementOption } from '@/lib/types'
import { fraseDeLaRegla, celdaSeExigeA } from './frase-de-la-regla'

const ETIQUETA = (id: string) => ({ t1: 'Furgón Congelado', t2: 'Sider', t3: 'Rampla Plana' }[id] ?? 'un subtipo dado de baja')

function requisito(patch: Partial<RequirementOption> = {}): RequirementOption {
  return {
    id: 'r1',
    target_entity: 'ASSET',
    requirement_code: 'MANTENCION_FRIO',
    name: 'Mantención Cámara de Frío',
    requirement_level: 'SHIPPER_REQUIRED',
    has_expiration: true,
    is_active: true,
    applies_to_fleet_service_type_ids: null,
    applies_to_management_types: null,
    alcance: { alcanzadas: 118, universo: 118 },
    ...patch,
  }
}

describe('fraseDeLaRegla', () => {
  it('sin condición nombra el universo de la entidad', () => {
    expect(fraseDeLaRegla(requisito(), ETIQUETA)).toBe('Todos los vehículos')
    expect(fraseDeLaRegla(requisito({ target_entity: 'CARRIER' }), ETIQUETA)).toBe('Todas las empresas')
    expect(fraseDeLaRegla(requisito({ target_entity: 'DRIVER' }), ETIQUETA)).toBe('Todos los conductores')
  })

  it('con un solo subtipo lo nombra', () => {
    expect(fraseDeLaRegla(requisito({ applies_to_fleet_service_type_ids: ['t1'] }), ETIQUETA))
      .toBe('Sólo Furgón Congelado')
  })

  it('con varios subtipos los cuenta', () => {
    expect(fraseDeLaRegla(requisito({ applies_to_fleet_service_type_ids: ['t1', 't2', 't3'] }), ETIQUETA))
      .toBe('Sólo 3 subtipos')
  })

  // Un subtipo dado de baja desaparece del catálogo pero su id sigue en la
  // regla: sin respaldo la frase diría "Sólo undefined".
  it('un subtipo dado de baja no rompe la frase', () => {
    expect(fraseDeLaRegla(requisito({ applies_to_fleet_service_type_ids: ['borrado'] }), ETIQUETA))
      .toBe('Sólo un subtipo dado de baja')
  })

  it('nombra los tipos de gestión de una empresa', () => {
    expect(fraseDeLaRegla(requisito({ target_entity: 'CARRIER', applies_to_management_types: ['TRACTOREO'] }), ETIQUETA))
      .toBe('Sólo Tractoreo')
    expect(fraseDeLaRegla(requisito({
      target_entity: 'CARRIER', applies_to_management_types: ['TRACTOREO', 'EQUIPO_COMPLETO'],
    }), ETIQUETA)).toBe('Tractoreo y Equipo Completo')
  })
})

describe('celdaSeExigeA', () => {
  it('una regla vigente enuncia la condición y su alcance', () => {
    expect(celdaSeExigeA(requisito({
      applies_to_fleet_service_type_ids: ['t1'],
      alcance: { alcanzadas: 36, universo: 118 },
    }), ETIQUETA)).toEqual({ regla: 'Sólo Furgón Congelado', alcance: '36 de 118' })
  })

  // `alcance.alcanzadas` cuenta LA CONDICIÓN, no la vigencia: un requisito
  // apagado sin condición trae 248 de 248. Leído tal cual, la fila diría
  // "Todas las empresas · 248 de 248 · Sin vigencia", que se contradice sola.
  // La incoherencia se resuelve en la celda y no en el número, porque un
  // número con dos significados es un defecto que este módulo ya tuvo.
  it('una regla sin vigencia no dice que se exige a nadie', () => {
    const celda = celdaSeExigeA(requisito({
      target_entity: 'CARRIER', is_active: false, alcance: { alcanzadas: 248, universo: 248 },
    }), ETIQUETA)
    expect(celda.regla).toBe('No se exige')
    expect(celda.regla).not.toMatch(/todas/i)
  })

  it('el alcance de una regla sin vigencia se enuncia en condicional', () => {
    const celda = celdaSeExigeA(requisito({
      target_entity: 'CARRIER', is_active: false, alcance: { alcanzadas: 248, universo: 248 },
    }), ETIQUETA)
    expect(celda.alcance).toBe('Alcanzaría a 248 de 248')
  })

  // Apagar la vigencia no borra la condición guardada: al volver a encenderla
  // tiene que reaparecer tal cual, así que la celda no puede ser el único
  // lugar donde vive.
  it('una regla sin vigencia con condición sigue mostrando a cuántos alcanzaría', () => {
    const celda = celdaSeExigeA(requisito({
      is_active: false,
      applies_to_fleet_service_type_ids: ['t1'],
      alcance: { alcanzadas: 36, universo: 118 },
    }), ETIQUETA)
    expect(celda.regla).toBe('No se exige')
    expect(celda.alcance).toBe('Alcanzaría a 36 de 118')
  })
})
