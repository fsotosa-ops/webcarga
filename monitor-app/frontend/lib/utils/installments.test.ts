import { describe, it, expect } from 'vitest'
import { dueRelative, cuotaLabel } from './installments'

describe('dueRelative', () => {
  it('returns null when there is no due date', () => {
    expect(dueRelative(null, false, '2026-07-10')).toBeNull()
  })

  it('returns "vence hoy" for today', () => {
    expect(dueRelative('2026-07-10', false, '2026-07-10')).toBe('vence hoy')
  })

  it('returns a future-relative message for a date ahead', () => {
    expect(dueRelative('2026-07-15', false, '2026-07-10')).toBe('vence en 5 días')
  })

  it('returns a past-relative message only when overdue', () => {
    expect(dueRelative('2026-07-07', true, '2026-07-10')).toBe('vencida hace 3 días')
  })

  it('returns null for a past date that is not marked overdue', () => {
    expect(dueRelative('2026-07-07', false, '2026-07-10')).toBeNull()
  })

  it('uses singular "día" for exactly 1 day', () => {
    expect(dueRelative('2026-07-11', false, '2026-07-10')).toBe('vence en 1 día')
  })
})

describe('cuotaLabel', () => {
  it('includes the total when known', () => {
    expect(cuotaLabel(1, 5)).toBe('Cuota 1 de 5')
  })

  it('falls back to just the number when the total is unknown', () => {
    expect(cuotaLabel(3, null)).toBe('Cuota 3')
  })
})
