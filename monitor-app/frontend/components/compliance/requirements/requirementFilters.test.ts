import { describe, it, expect } from 'vitest'
import { matchesSearch, matchesState } from './requirementFilters'
import type { ReglaDeVigencia, RequirementOption } from '@/lib/types'

const REGLA: ReglaDeVigencia = {
  validity_months: null, frequency_months: null, cutoff_day: null, period_offset_months: null, warning_days: null, grace_days: 0,
}
function req(over: Partial<RequirementOption>): RequirementOption {
  return {
    id: 'r', target_entity: 'ASSET', requirement_code: 'DOC', name: 'Doc',
    requirement_level: 'LEGAL_MANDATORY', expiration_policy: 'REQUIRED', vigencia: null,
    exigible_on: 'ON_ENTITY_START', is_active: true,
    applies_to_fleet_service_type_ids: null, applies_to_management_types: null,
    alcance: { alcanzadas: 1, universo: 1 }, aliases: [],
    ...over,
  }
}
const nadieRevisado = () => true

describe('los filtros de Documentos exigidos', () => {
  it('Sin vigencia es no exigirse a nadie (is_active), no "no vence"', () => {
    expect(matchesState(req({ is_active: false }), 'sin-vigencia', nadieRevisado)).toBe(true)
    expect(matchesState(req({ expiration_policy: 'NONE' }), 'sin-vigencia', nadieRevisado)).toBe(false)
  })

  it('Mensuales son los períodos de un mes, no cualquier período', () => {
    const mensual = req({ expiration_policy: 'CALENDAR_PERIOD', vigencia: { ...REGLA, frequency_months: 1, cutoff_day: 18 } })
    const trimestral = req({ expiration_policy: 'CALENDAR_PERIOD', vigencia: { ...REGLA, frequency_months: 3, cutoff_day: 18 } })
    expect(matchesState(mensual, 'mensuales', nadieRevisado)).toBe(true)
    expect(matchesState(trimestral, 'mensuales', nadieRevisado)).toBe(false)
  })

  it('Con condición es tener subtipos o tipos de gestión elegidos', () => {
    expect(matchesState(req({ applies_to_fleet_service_type_ids: ['t1'] }), 'con-condicion', nadieRevisado)).toBe(true)
    expect(matchesState(req({ applies_to_management_types: [] }), 'con-condicion', nadieRevisado)).toBe(false)
  })

  it('Sin revisar pregunta a las revisiones', () => {
    expect(matchesState(req({ id: 'a' }), 'sin-revisar', id => id === 'a')).toBe(true)
    expect(matchesState(req({ id: 'b' }), 'sin-revisar', id => id === 'a')).toBe(false)
  })

  it('la búsqueda encuentra por nombre o por código, sin mayúsculas', () => {
    expect(matchesSearch(req({ name: 'Formulario 30', requirement_code: 'F30' }), 'f30')).toBe(true)
    expect(matchesSearch(req({ name: 'Formulario 30', requirement_code: 'F30' }), 'formu')).toBe(true)
    expect(matchesSearch(req({ name: 'SOAP' }), 'gps')).toBe(false)
  })
})
