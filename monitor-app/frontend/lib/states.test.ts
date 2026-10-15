// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  alertSeverityStyle, documentEvidenceStyle, documentStateCount, documentStateCounts, documentStateStyle,
  enablementStyle, enablementStyleFromFlag, FUNNEL_BUCKET_ORDER, funnelBucketStyle, fleetMemberStyle, isBlocking, lifecycleStyle, stateCountsLine, summaryStyle,
  type ComplianceSummary,
} from './states'

const summary = (over: Partial<ComplianceSummary> = {}): ComplianceSummary => ({
  worst_state: 'UP_TO_DATE', own: { overdue: 0, expiring: 0, missing: 0 }, fleet: null, can_operate: true,
  blocking: { own: 0, fleet: null }, ...over,
})

describe('glosario de estados (spec D1 §3)', () => {
  it('ciclo de vida: concuerda en género y dice igual INACTIVE y LEGACY_INACTIVE', () => {
    expect(lifecycleStyle('carrier', 'ACTIVE').label).toBe('Activa')
    expect(lifecycleStyle('carrier', 'ONBOARDING').label).toBe('En onboarding')
    expect(lifecycleStyle('carrier', 'INACTIVE').label).toBe('Dada de baja')
    expect(lifecycleStyle('carrier', 'LEGACY_INACTIVE').label).toBe('Dada de baja')
    expect(lifecycleStyle('driver', 'ACTIVE').label).toBe('Activo')
    expect(lifecycleStyle('asset', 'INACTIVE').label).toBe('Dado de baja')
    expect(lifecycleStyle('carrier', 'ACTIVE').tone).toBe('resolved')
    expect(lifecycleStyle('carrier', 'LEGACY_INACTIVE').tone).toBe('neutral')
  })

  it('estado del documento: las cinco palabras y sus señales', () => {
    expect(documentStateStyle('UP_TO_DATE')).toMatchObject({ label: 'Al día', tone: 'resolved' })
    expect(documentStateStyle('EXPIRING')).toMatchObject({ label: 'Por vencer', tone: 'warning' })
    expect(documentStateStyle('OVERDUE')).toMatchObject({ label: 'Vencido', tone: 'urgent' })
    expect(documentStateStyle('MISSING')).toMatchObject({ label: 'Falta', tone: 'neutral' })
    expect(documentStateStyle('NOT_REQUIRED')).toMatchObject({ label: 'Aún no se exige', tone: 'neutral' })
  })

  it('habilitación: se calcula en la API y se pinta en gris si la empresa no está activa', () => {
    expect(enablementStyle(summary(), true)).toMatchObject({ label: 'Habilitada', tone: 'resolved' })
    expect(enablementStyle(summary({ can_operate: false, worst_state: 'OVERDUE' }), true))
      .toMatchObject({ label: 'No habilitada', tone: 'urgent' })
    // Las 205 LEGACY dejan de verse en rojo (§1): mismo texto, gris.
    expect(enablementStyle(summary({ can_operate: false, worst_state: 'MISSING' }), false))
      .toMatchObject({ label: 'No habilitada', tone: 'neutral' })
  })

  it('aviso: no es un estado, es énfasis', () => {
    expect(alertSeverityStyle('warning')).toMatchObject({ label: 'Aviso', tone: 'warning' })
    expect(alertSeverityStyle('critical')).toMatchObject({ label: 'Crítico', tone: 'urgent' })
  })

  it('resumen de conductor y equipo: el peor estado, gris si está de baja (D-R8)', () => {
    expect(summaryStyle(summary({ worst_state: 'OVERDUE', can_operate: false }), true))
      .toMatchObject({ label: 'Vencido', tone: 'urgent' })
    expect(summaryStyle(summary({ worst_state: 'OVERDUE', can_operate: false }), false))
      .toMatchObject({ label: 'Vencido', tone: 'neutral' })
  })

  it('miembro de flota: la empresa dada de baja reemplaza "Activo", no la baja propia', () => {
    expect(fleetMemberStyle('driver', 'ACTIVE', 'LEGACY_INACTIVE').label).toBe('Empresa dada de baja')
    expect(fleetMemberStyle('driver', 'INACTIVE', 'LEGACY_INACTIVE').label).toBe('Dado de baja')
    expect(fleetMemberStyle('asset', 'ACTIVE', 'ONBOARDING').label).toBe('Activo')
  })

  it('evidencia: "Falta el archivo" cuando hay fecha y no hay papel; nunca cuenta como al día', () => {
    expect(documentEvidenceStyle('MISSING', '2026-09-12', false)).toMatchObject({ label: 'Falta el archivo', tone: 'neutral' })
    expect(documentEvidenceStyle('MISSING', null, false).label).toBe('Falta')
    expect(documentEvidenceStyle('OVERDUE', '2026-09-12', false).label).toBe('Vencido')
  })

  it('cifras: plural, singular y sin los ceros', () => {
    expect(documentStateCount('OVERDUE', 1)).toBe('1 vencido')
    expect(documentStateCount('OVERDUE', 3)).toBe('3 vencidos')
    expect(documentStateCount('MISSING', 1)).toBe('1 falta')
    expect(documentStateCount('MISSING', 2)).toBe('2 faltan')
    expect(documentStateCount('EXPIRING', 2)).toBe('2 por vencer')
    expect(documentStateCount('UP_TO_DATE', 12)).toBe('12 al día')
    expect(stateCountsLine({ overdue: 2, expiring: 0, missing: 1 })).toBe('2 vencidos · 1 falta')
    expect(stateCountsLine({ overdue: 0, expiring: 0, missing: 0 })).toBeNull()
  })

  it('bloquea solo lo obligatorio vencido o faltante; por vencer no bloquea', () => {
    expect(isBlocking({ requirement_level: 'LEGAL_MANDATORY', document_state: 'OVERDUE' })).toBe(true)
    expect(isBlocking({ requirement_level: 'LEGAL_MANDATORY', document_state: 'MISSING' })).toBe(true)
    expect(isBlocking({ requirement_level: 'LEGAL_MANDATORY', document_state: 'EXPIRING' })).toBe(false)
    expect(isBlocking({ requirement_level: 'CONDITIONAL_OPTIONAL', document_state: 'MISSING' })).toBe(false)
    expect(isBlocking({ requirement_level: 'LEGAL_MANDATORY', document_state: 'NOT_REQUIRED' })).toBe(false)
  })

  it('cuenta registros por el estado que mandó la API', () => {
    const c = documentStateCounts([{ document_state: 'UP_TO_DATE' }, { document_state: 'UP_TO_DATE' }, { document_state: 'MISSING' }])
    expect(c).toEqual({ UP_TO_DATE: 2, EXPIRING: 0, OVERDUE: 0, MISSING: 1, NOT_REQUIRED: 0 })
  })

  it('habilitación desde el flag: la misma tabla que enablementStyle', () => {
    for (const can of [true, false]) for (const active of [true, false]) {
      expect(enablementStyleFromFlag(can, active)).toEqual(enablementStyle(summary({ can_operate: can }), active))
    }
  })

  it('baldes del embudo: orden de trabajo y palabras del glosario', () => {
    expect(FUNNEL_BUCKET_ORDER).toEqual(['not_enabled', 'expiring', 'up_to_date'])
    expect(funnelBucketStyle('not_enabled')).toMatchObject({ label: 'No habilitada', tone: 'urgent' })
    expect(funnelBucketStyle('expiring')).toMatchObject({ label: 'Por vencer', tone: 'warning' })
    expect(funnelBucketStyle('up_to_date')).toMatchObject({ label: 'Al día', tone: 'resolved' })
  })
})
