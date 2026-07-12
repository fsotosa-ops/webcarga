// lib/utils/avatar.test.ts
import { describe, it, expect } from 'vitest'
import { getInitials, getInitialColor } from './avatar'

describe('getInitials', () => {
  it('takes first letter of first and last name', () => {
    expect(getInitials('Juan Pérez')).toBe('JP')
  })
  it('falls back to first 2 letters for a single-word name', () => {
    expect(getInitials('Madonna')).toBe('MA')
  })
  it('returns ? for a null name', () => {
    expect(getInitials(null)).toBe('?')
  })
})

describe('getInitialColor', () => {
  it('returns a stable color for the same name', () => {
    expect(getInitialColor('Juan Pérez')).toBe(getInitialColor('Juan Pérez'))
  })
  it('returns a fallback color for a null name', () => {
    expect(getInitialColor(null)).toBe('#64748b')
  })
})
