import { describe, it, expect } from 'vitest'
import { fmtDT, fmtShort, fmtDate, formatRelativeTime } from './datetime'

describe('fmtDT', () => {
  it('returns em dash for null/undefined/empty', () => {
    expect(fmtDT(null)).toBe('—')
    expect(fmtDT(undefined)).toBe('—')
    expect(fmtDT('')).toBe('—')
  })

  it('normalizes a naive UTC timestamp (no offset) into DD/MM HH:MM:SS format', () => {
    expect(fmtDT('2026-07-02 12:45:28')).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('accepts a timestamp with an explicit Z offset', () => {
    expect(fmtDT('2026-07-02T12:45:28Z')).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('returns em dash for an invalid date string', () => {
    expect(fmtDT('not-a-date')).toBe('—')
  })
})

describe('fmtShort', () => {
  it('returns em dash for null', () => {
    expect(fmtShort(null)).toBe('—')
  })

  it('formats as HH:MM', () => {
    expect(fmtShort('2026-07-02 12:45:28')).toMatch(/^\d{2}:\d{2}$/)
  })
})

describe('fmtDate', () => {
  it('formats an ISO date as DD-MM-YYYY', () => {
    expect(fmtDate('2026-07-02')).toBe('02-07-2026')
  })

  it('returns em dash for null', () => {
    expect(fmtDate(null)).toBe('—')
  })
})

describe('formatRelativeTime', () => {
  it('returns em dash for null/undefined', () => {
    expect(formatRelativeTime(null)).toBe('—')
    expect(formatRelativeTime(undefined)).toBe('—')
  })

  it('returns em dash for an invalid date string', () => {
    expect(formatRelativeTime('not-a-date')).toBe('—')
  })

  it('returns "hace unos segundos" for timestamps under a minute old', () => {
    const iso = new Date(Date.now() - 30 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('hace unos segundos')
  })

  it('formats minutes for timestamps under an hour old', () => {
    const iso = new Date(Date.now() - 12 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('hace 12 min')
  })

  it('formats hours for timestamps under a day old', () => {
    const iso = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('hace 3 h')
  })

  it('formats days for timestamps a day or more old', () => {
    const iso = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('hace 2 d')
  })
})
