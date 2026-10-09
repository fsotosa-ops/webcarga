import { describe, expect, it } from 'vitest'
import {
  aplicarEnLote, cambiosDelBorrador, camposCambiados, editar, incompletos,
  renovacionDe, valorDe, vigenciaPara,
} from './borrador'
import type { RequirementOption } from '@/lib/types'

function req(over: Partial<RequirementOption> = {}): RequirementOption {
  return {
    id: 'r1', target_entity: 'CARRIER', requirement_code: 'DOC', name: 'Doc',
    requirement_level: 'LEGAL_MANDATORY', expiration_policy: 'NONE', vigencia: null,
    exigible_on: 'ON_ENTITY_START', is_active: false,
    applies_to_fleet_service_type_ids: null, applies_to_management_types: null,
    alcance: { alcanzadas: 1, universo: 1 }, aliases: [],
    ...over,
  } as RequirementOption
}

const ANUAL = { politica: 'ISSUE_PLUS_MONTHS' as const, validity_months: 12, warning_days: 30, grace_days: 0 }

describe('renovacionDe y vigenciaPara', () => {
  it('nombra las renovaciones de la planilla', () => {
    expect(renovacionDe({ politica: 'NONE' })).toBe('nunca')
    expect(renovacionDe({ politica: 'REQUIRED' })).toBe('fecha')
    expect(renovacionDe({ politica: 'OPTIONAL' })).toBe('fecha_opcional')
    expect(renovacionDe(ANUAL)).toBe('anual')
    expect(renovacionDe({ ...ANUAL, validity_months: 24 })).toBe('bienal')
    expect(renovacionDe({ politica: 'CALENDAR_PERIOD', frequency_months: 1 })).toBe('mes')
  })

  it('una regla que la celda no sabe escribir no se colapsa en otra', () => {
    // Un "cada 6 meses" elegido en el panel no puede volverse "anual" por
    // abrir la tabla: se muestra como otra y se edita en el panel.
    expect(renovacionDe({ ...ANUAL, validity_months: 6 })).toBe('otra')
    expect(renovacionDe({ politica: 'CALENDAR_PERIOD', frequency_months: 3 })).toBe('otra')
  })

  it('cambiar la renovación conserva el aviso y la gracia', () => {
    expect(vigenciaPara('bienal', ANUAL)).toEqual({ ...ANUAL, validity_months: 24 })
    expect(vigenciaPara('nunca', ANUAL)).toEqual({ politica: 'NONE' })
  })

  it('un mensual nuevo pide el día tope en vez de inventarlo', () => {
    const v = vigenciaPara('mes', { politica: 'NONE' })
    expect(v).toMatchObject({ politica: 'CALENDAR_PERIOD', frequency_months: 1,
      period_offset_months: 1, cutoff_day: null })
  })
})

describe('editar', () => {
  it('volver al valor guardado borra el cambio', () => {
    const r = req({ is_active: false })
    let b = editar({}, r, { is_active: true })
    expect(camposCambiados(b, r.id)).toEqual(new Set(['is_active']))
    b = editar(b, r, { is_active: false })
    expect(b).toEqual({})
  })

  it('una vigencia igual por contenido no es un cambio', () => {
    const r = req({ expiration_policy: 'ISSUE_PLUS_MONTHS', vigencia: { ...ANUAL } as never })
    expect(editar({}, r, { vigencia: { ...ANUAL } })).toEqual({})
  })

  it('valorDe muestra el borrador encima de lo guardado', () => {
    const r = req({ exigible_on: 'ON_ENTITY_START' })
    const b = editar({}, r, { exigible_on: 'ON_REQUEST' })
    expect(valorDe(r, b).exigible_on).toBe('ON_REQUEST')
    expect(valorDe(r, b).is_active).toBe(false)
  })
})

describe('cambiosDelBorrador', () => {
  it('manda solo los campos cambiados de cada documento', () => {
    const r = req()
    const b = editar({}, r, { exigible_on: 'ON_REQUEST' })
    expect(cambiosDelBorrador(b)).toEqual([
      { requirement_id: 'r1', patch: { exigible_on: 'ON_REQUEST' } },
    ])
  })
})

describe('incompletos', () => {
  it('un mensual sin día tope bloquea publicar', () => {
    const r = req()
    const b = editar({}, r, { vigencia: vigenciaPara('mes', { politica: 'NONE' }) })
    expect(incompletos(b)).toEqual(['r1'])
  })
})

describe('aplicarEnLote', () => {
  it('cuándo se exige de conductor no se aplica a una empresa', () => {
    const empresa = req({ id: 'e', target_entity: 'CARRIER' })
    const conductor = req({ id: 'c', target_entity: 'DRIVER' })
    const b = aplicarEnLote({}, [empresa, conductor], { exigible_on: 'MONTH_AFTER_START' })
    expect(Object.keys(b)).toEqual(['c'])
  })

  it('el aviso no se aplica a lo que no vence', () => {
    const noVence = req({ id: 'n' })
    const anual = req({ id: 'a', expiration_policy: 'ISSUE_PLUS_MONTHS', vigencia: { ...ANUAL } as never })
    const b = aplicarEnLote({}, [noVence, anual], { aviso: 7 })
    expect(Object.keys(b)).toEqual(['a'])
    expect(valorDe(anual, b).vigencia.warning_days).toBe(7)
  })

  it('la renovación en lote parte de la vigencia de cada fila', () => {
    const anual = req({ id: 'a', expiration_policy: 'ISSUE_PLUS_MONTHS', vigencia: { ...ANUAL } as never })
    const b = aplicarEnLote({}, [anual], { renovacion: 'bienal' })
    expect(valorDe(anual, b).vigencia).toMatchObject({ validity_months: 24, warning_days: 30 })
  })
})
