import { describe, it, expect } from 'vitest'
import { expiryRelative, updatedRelative } from './compliance'

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
