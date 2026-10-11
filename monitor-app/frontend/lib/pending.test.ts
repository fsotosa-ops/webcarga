import { describe, it, expect } from 'vitest'
import { pendingRowStatus } from './pending'
import type { PendingComplianceRow } from './types'

const fila = (over: Partial<PendingComplianceRow> = {}): PendingComplianceRow => ({
  id: 'p1', carrier_id: 'c1', carrier_name: 'Transportes Andes Ltda', carrier_tax_id: null,
  carrier_operation_types: [], certification_type: 'BASICA', category: 'CHOFER',
  entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Soto Muñoz, Carla',
  requirement_id: 'r1', requirement_code: 'LIC', document_name: 'Licencia de Conducir',
  status: 'APPROVED_MANUAL', expiration_date: null, tiene_archivo: true, urgencia: 'VENCIDO',
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
      .toEqual({ label: 'Falta indicar el período', tone: 'urgent', action: 'Completar' })
    expect(pendingRowStatus(fila({ falta_dato_de_vigencia: true, expiration_policy: 'ISSUE_PLUS_MONTHS' }), HOY).label)
      .toBe('Falta indicar la fecha de emisión')
    expect(pendingRowStatus(fila({ missing_validity_data: true, expiration_policy: 'REQUIRED' }), HOY).label)
      .toBe('Falta la fecha de vencimiento')
  })

  it('por vencer: "Vence en 10 días · 21/10" y Subir la nueva', () => {
    expect(pendingRowStatus(fila({ document_state: 'EXPIRING', urgencia: 'POR_VENCER', due_on: '2026-10-21' }), HOY))
      .toEqual({ label: 'Vence en 10 días · 21/10', tone: 'warning', action: 'Subir la nueva' })
  })

  it('falta: "Falta" y Subir', () => {
    expect(pendingRowStatus(fila({ document_state: 'MISSING', urgencia: 'FALTA', tiene_archivo: false }), HOY))
      .toEqual({ label: 'Falta', tone: 'neutral', action: 'Subir' })
  })
})
