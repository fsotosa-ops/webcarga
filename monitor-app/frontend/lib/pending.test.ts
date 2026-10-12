import { afterEach, describe, it, expect, vi } from 'vitest'
import { pendingPeriodLine, pendingRowStatus } from './pending'
import type { PendingComplianceRow, PendingSummaryRow } from './types'

const fila = (over: Partial<PendingComplianceRow> = {}): PendingComplianceRow => ({
  id: 'p1', carrier_id: 'c1', carrier_name: 'Transportes Andes Ltda', carrier_tax_id: null,
  carrier_operation_types: [], certification_type: 'BASICA', category: 'CHOFER',
  entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Soto Muñoz, Carla',
  requirement_id: 'r1', requirement_code: 'LIC', document_name: 'Licencia de Conducir',
  status: 'APPROVED_MANUAL', expiration_date: null, tiene_archivo: true,
  document_state: 'OVERDUE', expiration_policy: 'REQUIRED',
  ...over,
} as PendingComplianceRow)

const HOY = '2026-10-11'

describe('pendingRowStatus — el estado de cada fila en palabras (spec §5.2)', () => {
  it('vencido: "Venció el 29/09" y Subir', () => {
    expect(pendingRowStatus(fila({ due_on: '2026-09-29' }), HOY))
      .toEqual({ label: 'Venció el 29/09', tone: 'urgent', action: 'Subir' })
  })

  it('usa vence_el cuando la respuesta no trae due_on', () => {
    expect(pendingRowStatus(fila({ vence_el: '2026-09-18' }), HOY).label).toBe('Venció el 18/09')
  })

  it('vencido sin fecha (marcado a mano) sigue diciendo que venció', () => {
    expect(pendingRowStatus(fila(), HOY).label).toBe('Vencido')
  })

  it('archivo sin la fecha que pide su regla: Completar, con el dato que falta', () => {
    expect(pendingRowStatus(fila({ missing_validity_data: true, expiration_policy: 'CALENDAR_PERIOD' }), HOY))
      .toEqual({ label: 'Falta indicar el período', tone: 'urgent', action: 'Completar',
                 detail: 'El archivo está cargado; sin la fecha no vale' })
    expect(pendingRowStatus(fila({ falta_dato_de_vigencia: true, expiration_policy: 'ISSUE_PLUS_MONTHS' }), HOY).label)
      .toBe('Falta indicar la fecha de emisión')
    expect(pendingRowStatus(fila({ missing_validity_data: true, expiration_policy: 'REQUIRED' }), HOY).label)
      .toBe('Falta la fecha de vencimiento')
  })

  it('por vencer: "Vence en 10 días · 21/10" y Subir la nueva', () => {
    expect(pendingRowStatus(fila({ document_state: 'EXPIRING', due_on: '2026-10-21' }), HOY))
      .toEqual({ label: 'Vence en 10 días · 21/10', tone: 'warning', action: 'Subir la nueva' })
  })

  it('falta, sin saber desde cuándo: "Falta" y Subir', () => {
    expect(pendingRowStatus(fila({ document_state: 'MISSING', tiene_archivo: false }), HOY))
      .toEqual({ label: 'Falta', tone: 'neutral', action: 'Subir' })
  })

  it('falta: "Falta · Ingresó hace 10 días", desde entered_on', () => {
    const falta = { document_state: 'MISSING' as const, tiene_archivo: false }
    expect(pendingRowStatus(fila({ ...falta, entered_on: '2026-10-01' }), HOY))
      .toEqual({ label: 'Falta', tone: 'neutral', action: 'Subir', detail: 'Ingresó hace 10 días' })
    expect(pendingRowStatus(fila({ ...falta, entered_on: '2026-10-10' }), HOY).detail).toBe('Ingresó hace 1 día')
    expect(pendingRowStatus(fila({ ...falta, entered_on: HOY }), HOY).detail).toBe('Ingresó hoy')
  })
})

describe('pendingRowStatus — "hoy" es el día de Chile', () => {
  afterEach(() => vi.useRealTimers())

  it('a las 22:30 de Chile (ya mañana en UTC) cuenta los días con la fecha chilena', () => {
    // 11/10/2026 22:30 en Chile (UTC-3) = 12/10 01:30 UTC.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-12T01:30:00Z'))
    const s = pendingRowStatus(fila({ document_state: 'EXPIRING', due_on: '2026-10-21' }))
    expect(s.label).toBe('Vence en 10 días · 21/10')
    const f = pendingRowStatus(fila({ document_state: 'MISSING', tiene_archivo: false, entered_on: '2026-10-01' }))
    expect(f.detail).toBe('Ingresó hace 10 días')
  })
})

describe('pendingPeriodLine — el encabezado de un documento por período', () => {
  const F30: PendingSummaryRow = {
    key: 'req-f30', label: 'F30-1', requirement_code: 'F30_1', target_entity: 'CARRIER',
    expiration_policy: 'CALENDAR_PERIOD',
    vigencia: { frequency_months: 1, cutoff_day: 18, period_offset_months: 1, warning_days: 5 } as never,
    overdue: 9, expiring: 4, missing: 21,
  }

  it('el 11/10, el F30-1 mensual con tope 18 exige septiembre y vence el 18/10 (maqueta)', () => {
    expect(pendingPeriodLine(F30, HOY)).toBe('período septiembre · vence el 18/10')
  })

  it('una regla sin período no inventa uno', () => {
    expect(pendingPeriodLine({ ...F30, expiration_policy: 'REQUIRED', vigencia: null }, HOY)).toBeNull()
    expect(pendingPeriodLine({ ...F30, expiration_policy: null }, HOY)).toBeNull()
  })
})
