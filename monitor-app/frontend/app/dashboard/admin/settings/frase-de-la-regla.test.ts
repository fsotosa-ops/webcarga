import { describe, it, expect } from 'vitest'
import type { RequirementOption } from '@/lib/types'
import { fraseDeLaRegla, celdaSeExigeA } from './frase-de-la-regla'

const SUBTIPO = (id: string) =>
  ({ t1: 'Furgón Congelado', t2: 'Sider', t3: 'Rampla Plana' }[id] ?? 'un subtipo dado de baja')

// Las etiquetas de gestión salen del catálogo, igual que las de subtipo: acá
// se simula ese catálogo, no se copia el mapa que el frontend tenía escrito.
const GESTION = (code: string) =>
  ({ TRACTOREO: 'Tractoreo', EQUIPO_COMPLETO: 'Equipo Completo' }[code]
   ?? 'un tipo de gestión que ya no existe')

const VOCABULARIO = { subtipo: SUBTIPO, totalSubtipos: 10, gestion: GESTION, totalGestiones: 2 }

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
    expect(fraseDeLaRegla(requisito(), VOCABULARIO)).toBe('Todos los vehículos')
    expect(fraseDeLaRegla(requisito({ target_entity: 'CARRIER' }), VOCABULARIO)).toBe('Todas las empresas')
    expect(fraseDeLaRegla(requisito({ target_entity: 'DRIVER' }), VOCABULARIO)).toBe('Todos los conductores')
  })

  it('con un solo subtipo lo nombra', () => {
    expect(fraseDeLaRegla(requisito({ applies_to_fleet_service_type_ids: ['t1'] }), VOCABULARIO))
      .toBe('Sólo Furgón Congelado')
  })

  // "Sólo 9" cuando el catálogo tiene 10 SUBESTIMA: se lee como una
  // restricción fuerte y en realidad excluye uno solo. El "N de M" es además
  // la forma que ya usa la columna de al lado ("36 de 118").
  it('con varios subtipos dice cuántos de cuántos', () => {
    expect(fraseDeLaRegla(requisito({ applies_to_fleet_service_type_ids: ['t1', 't2', 't3'] }), VOCABULARIO))
      .toBe('3 de 10 subtipos')
  })

  it('nueve de diez no se enuncia como "sólo"', () => {
    const nueve = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    const frase = fraseDeLaRegla(requisito({ applies_to_fleet_service_type_ids: nueve }), VOCABULARIO)
    expect(frase).toBe('9 de 10 subtipos')
    expect(frase).not.toMatch(/sólo/i)
  })

  // Sin catálogo de subtipos no hay total que enunciar: "3 de 0" seria peor
  // que no decirlo.
  it('sin catálogo de subtipos no inventa un total', () => {
    expect(fraseDeLaRegla(requisito({ applies_to_fleet_service_type_ids: ['t1', 't2', 't3'] }), { ...VOCABULARIO, totalSubtipos: 0 }))
      .toBe('Sólo 3 subtipos')
  })

  // Un subtipo dado de baja desaparece del catálogo pero su id sigue en la
  // regla: sin respaldo la frase diría "Sólo undefined".
  it('un subtipo dado de baja no rompe la frase', () => {
    expect(fraseDeLaRegla(requisito({ applies_to_fleet_service_type_ids: ['borrado'] }), VOCABULARIO))
      .toBe('Sólo un subtipo dado de baja')
  })

  it('nombra los tipos de gestión de una empresa', () => {
    expect(fraseDeLaRegla(requisito({ target_entity: 'CARRIER', applies_to_management_types: ['TRACTOREO'] }), VOCABULARIO))
      .toBe('Sólo Tractoreo')
  })

  // Misma forma que los subtipos, por la misma razón: marcar todas menos una
  // no es una restricción fuerte. Antes decía "Tractoreo y Equipo Completo",
  // una frase escrita a mano que sólo funcionaba mientras el catálogo tuviera
  // exactamente esos dos valores.
  it('con varios tipos de gestión dice cuántos de cuántos', () => {
    expect(fraseDeLaRegla(requisito({
      target_entity: 'CARRIER', applies_to_management_types: ['TRACTOREO', 'EQUIPO_COMPLETO'],
    }), VOCABULARIO)).toBe('2 de 2 tipos de gestión')
  })

  // La etiqueta la pone el CATÁLOGO. Renombrar "Tractoreo" en Configuración
  // tiene que cambiar la frase y nada más — antes cambiaba también a qué
  // empresas alcanzaba la regla, porque la función de Postgres reconocía el
  // tipo de gestión por su nombre visible.
  it('la etiqueta de gestión sale del vocabulario, no de un mapa escrito acá', () => {
    const renombrado = { ...VOCABULARIO, gestion: () => 'Tractoreo (renombrado)' }
    expect(fraseDeLaRegla(
      requisito({ target_entity: 'CARRIER', applies_to_management_types: ['TRACTOREO'] }),
      renombrado,
    )).toBe('Sólo Tractoreo (renombrado)')
  })

  it('un tipo de gestión que ya no existe no rompe la frase', () => {
    expect(fraseDeLaRegla(
      requisito({ target_entity: 'CARRIER', applies_to_management_types: ['BORRADO'] as never }),
      VOCABULARIO,
    )).toBe('Sólo un tipo de gestión que ya no existe')
  })
})

describe('celdaSeExigeA', () => {
  it('una regla vigente enuncia la condición y su alcance', () => {
    expect(celdaSeExigeA(requisito({
      applies_to_fleet_service_type_ids: ['t1'],
      alcance: { alcanzadas: 36, universo: 118 },
    }), VOCABULARIO)).toEqual({ regla: 'Sólo Furgón Congelado', alcance: '36 de 118' })
  })

  // `alcance.alcanzadas` cuenta LA CONDICIÓN, no la vigencia: un requisito
  // apagado sin condición trae 248 de 248. Leído tal cual, la fila diría
  // "Todas las empresas · 248 de 248 · Sin vigencia", que se contradice sola.
  // La incoherencia se resuelve en la celda y no en el número, porque un
  // número con dos significados es un defecto que este módulo ya tuvo.
  it('una regla sin vigencia no dice que se exige a nadie', () => {
    const celda = celdaSeExigeA(requisito({
      target_entity: 'CARRIER', is_active: false, alcance: { alcanzadas: 248, universo: 248 },
    }), VOCABULARIO)
    expect(celda.regla).toBe('No se exige')
    expect(celda.regla).not.toMatch(/todas/i)
  })

  it('el alcance de una regla sin vigencia se enuncia en condicional', () => {
    const celda = celdaSeExigeA(requisito({
      target_entity: 'CARRIER', is_active: false, alcance: { alcanzadas: 248, universo: 248 },
    }), VOCABULARIO)
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
    }), VOCABULARIO)
    expect(celda.regla).toBe('No se exige')
    expect(celda.alcance).toBe('Alcanzaría a 36 de 118')
  })
})
