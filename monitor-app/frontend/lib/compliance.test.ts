import { describe, it, expect } from 'vitest'
import { dueRelative, fileHistoryLabel, expiryRelative, puedeCorregirVencimiento, updatedRelative } from './compliance'

describe('expiryRelative', () => {
  it('returns null when there is no expiration date', () => {
    expect(expiryRelative(null, false)).toBeNull()
  })

  it('returns "vence hoy" when the expiration date is today', () => {
    expect(expiryRelative('2026-07-16', false, '2026-07-16')).toBe('vence hoy')
  })

  it('returns "vence en N días" for a future date', () => {
    expect(expiryRelative('2026-07-21', false, '2026-07-16')).toBe('vence en 5 días')
    expect(expiryRelative('2026-07-17', false, '2026-07-16')).toBe('vence en 1 día')
  })

  it('returns "vencido hace N días" only when is_expired is true', () => {
    expect(expiryRelative('2026-07-04', true, '2026-07-16')).toBe('vencido hace 12 días')
    expect(expiryRelative('2026-07-15', true, '2026-07-16')).toBe('vencido hace 1 día')
  })

  it('returns null for a past date that is not flagged as expired', () => {
    expect(expiryRelative('2026-07-04', false, '2026-07-16')).toBeNull()
  })
})

describe('updatedRelative', () => {
  const NOW = new Date('2026-07-16T12:00:00Z').getTime()

  it('returns null when there is no updated_at', () => {
    expect(updatedRelative(null, NOW)).toBeNull()
  })

  it('returns "actualizado hoy" for the same day', () => {
    expect(updatedRelative('2026-07-16T09:00:00Z', NOW)).toBe('actualizado hoy')
  })

  it('returns "sin actualizar hace N días" for older timestamps', () => {
    expect(updatedRelative('2026-06-06T12:00:00Z', NOW)).toBe('sin actualizar hace 40 días')
    expect(updatedRelative('2026-07-15T12:00:00Z', NOW)).toBe('sin actualizar hace 1 día')
  })
})

// ── Qué pide la carga según el tipo (HU-C1, entrega 2b) ─────────────────────
import { camposQuePide, datoQuePide, datosDelDocumento, periodoSugerido } from './compliance'

describe('camposQuePide', () => {
  it('es la misma tabla que el backend', () => {
    expect(camposQuePide('NONE')).toEqual({ fecha: 'no', emision: false, periodo: false })
    expect(camposQuePide('REQUIRED')).toEqual({ fecha: 'obligatoria', emision: false, periodo: false })
    expect(camposQuePide('OPTIONAL')).toEqual({ fecha: 'opcional', emision: false, periodo: false })
    expect(camposQuePide('ISSUE_PLUS_MONTHS')).toEqual({ fecha: 'no', emision: true, periodo: false })
    expect(camposQuePide('CALENDAR_PERIOD')).toEqual({ fecha: 'no', emision: false, periodo: true })
  })

  it('cada tipo pide a lo sumo un dato al cargar', () => {
    expect(datoQuePide('NONE')).toBeNull()
    expect(datoQuePide('OPTIONAL')).toEqual({ dato: 'vencimiento', obligatorio: false })
    expect(datoQuePide('ISSUE_PLUS_MONTHS')).toEqual({ dato: 'emision', obligatorio: true })
    expect(datoQuePide('CALENDAR_PERIOD')).toEqual({ dato: 'periodo', obligatorio: true })
  })

  it('el período viaja como el día 1 del mes', () => {
    expect(datosDelDocumento('periodo', '2026-09')).toEqual({ period_start: '2026-09-01' })
    // Safari y Firefox de escritorio muestran el campo de mes como texto libre.
    expect(datosDelDocumento('periodo', '09/2026')).toEqual({ period_start: '2026-09-01' })
    expect(datosDelDocumento('periodo', '9-2026')).toEqual({ period_start: '2026-09-01' })
    expect(datosDelDocumento('emision', '2026-03-10')).toEqual({ issue_date: '2026-03-10' })
    expect(datosDelDocumento('vencimiento', '')).toEqual({})
  })

  it('propone el período siguiente al cargado, o el mes anterior si no hay', () => {
    const hoy = new Date(2026, 9, 8)
    expect(periodoSugerido('2026-09-01', hoy)).toBe('2026-10')
    expect(periodoSugerido(null, hoy)).toBe('2026-09')
    expect(periodoSugerido('2026-12-01', hoy)).toBe('2027-01')
  })
})

import { vigenciaDeLaFila } from './compliance'

describe('vigenciaDeLaFila', () => {
  const HOY = '2026-10-08'
  const base = {
    document_state: 'UP_TO_DATE' as const, expiration_date: null, vence_el: null, exigible_desde: null,
    falta_dato_de_vigencia: false, issue_date: null, period_start: null,
    expiration_policy: 'NONE' as const,
  }

  it('lo que aún no se exige dice desde cuándo', () => {
    expect(vigenciaDeLaFila({ ...base, document_state: 'NOT_REQUIRED', exigible_desde: '2026-11-01' }, HOY))
      .toBe('Se exige desde el 01-11-26')
  })

  it('lo que aún no se exige y no trae fecha usa la palabra del glosario', () => {
    expect(vigenciaDeLaFila({ ...base, document_state: 'NOT_REQUIRED' }, HOY)).toBe('Aún no se exige')
  })

  it('un mensual al día dice qué mes cubre y hasta cuándo sirve', () => {
    expect(vigenciaDeLaFila({
      ...base, expiration_policy: 'CALENDAR_PERIOD', period_start: '2026-09-01', vence_el: '2026-11-18',
    }, HOY)).toBe('Septiembre 2026 · sirve hasta el 18-11-26')
  })

  it('un mensual vencido lo dice con su mes', () => {
    expect(vigenciaDeLaFila({
      ...base, document_state: 'OVERDUE', expiration_policy: 'CALENDAR_PERIOD',
      period_start: '2026-08-01', vence_el: '2026-10-05',
    }, HOY)).toBe('Agosto 2026 · vencido hace 3 días')
  })

  it('cargado sin el dato que su tipo necesita dice cuál falta', () => {
    expect(vigenciaDeLaFila({
      ...base, document_state: 'OVERDUE', expiration_policy: 'CALENDAR_PERIOD', falta_dato_de_vigencia: true,
    }, HOY)).toBe('Falta indicar el período')
    expect(vigenciaDeLaFila({
      ...base, document_state: 'OVERDUE', expiration_policy: 'ISSUE_PLUS_MONTHS', falta_dato_de_vigencia: true,
    }, HOY)).toBe('Falta indicar la fecha de emisión')
  })

  it('un plazo desde la emisión dice cuándo se emitió y cuándo vence', () => {
    expect(vigenciaDeLaFila({
      ...base, expiration_policy: 'ISSUE_PLUS_MONTHS', issue_date: '2026-03-10', vence_el: '2027-03-10',
    }, HOY)).toBe('Emitido el 10-03-26 · vence el 10-03-27')
  })

  it('la fecha del documento por vencer usa el relativo de siempre', () => {
    expect(vigenciaDeLaFila({
      ...base, document_state: 'EXPIRING', expiration_policy: 'REQUIRED',
      expiration_date: '2026-10-13', vence_el: '2026-10-13',
    }, HOY)).toBe('vence en 5 días')
  })

  it('lo que falta no dice nada: el renglón ya pide el archivo', () => {
    expect(vigenciaDeLaFila({ ...base, document_state: 'MISSING' }, HOY)).toBeNull()
  })
})

// Revisión final RBAC, hallazgo 4. Misma regla que la API
// (ESTADOS_APROBADOS en schemas/compliance.py).
describe('puedeCorregirVencimiento', () => {
  const opera = { puedeCargar: true, puedeRevisar: false }
  it('quien carga corrige la fecha de un documento por revisar', () => {
    expect(puedeCorregirVencimiento('PENDING_REVIEW', opera)).toBe(true)
    expect(puedeCorregirVencimiento('MISSING', opera)).toBe(true)
  })
  it('sobre uno aprobado, correrla es extender su vigencia: solo quien revisa', () => {
    expect(puedeCorregirVencimiento('APPROVED', opera)).toBe(false)
    expect(puedeCorregirVencimiento('APPROVED_MANUAL', opera)).toBe(false)
    expect(puedeCorregirVencimiento('APPROVED', { puedeCargar: true, puedeRevisar: true })).toBe(true)
  })
  it('sin poder cargar, nunca', () => {
    expect(puedeCorregirVencimiento('PENDING_REVIEW', { puedeCargar: false, puedeRevisar: true })).toBe(false)
  })
})

describe('dueRelative: los días los cuenta la API (days_to_expiry)', () => {
  it('dice cuánto falta o hace cuánto venció', () => {
    expect(dueRelative(0)).toBe('vence hoy')
    expect(dueRelative(1)).toBe('vence en 1 día')
    expect(dueRelative(5)).toBe('vence en 5 días')
    expect(dueRelative(-12)).toBe('vencido hace 12 días')
    expect(dueRelative(null)).toBeNull()
  })
})

describe('fileHistoryLabel: lo que pasó con el archivo, nunca su vigencia', () => {
  it('no usa ninguna palabra del glosario de estados', () => {
    expect(fileHistoryLabel('APPROVED_MANUAL')).toBe('Aprobado a mano')
    expect(fileHistoryLabel('MISSING')).toBe('Sin cargar')
  })
})
