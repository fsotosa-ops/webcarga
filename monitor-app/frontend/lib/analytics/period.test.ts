import { describe, it, expect } from 'vitest'
import { readPeriod, resolvePeriod, writePeriod } from './period'

describe('período de Analítica', () => {
  it('últimos 30 días incluye hoy', () => {
    expect(resolvePeriod({ preset: 'last_30d' }, '2026-10-22')).toEqual({ from: '2026-09-23', to: '2026-10-22' })
  })
  it('mes anterior y este mes', () => {
    expect(resolvePeriod({ preset: 'last_month' }, '2026-10-22')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(resolvePeriod({ preset: 'this_month' }, '2026-10-22')).toEqual({ from: '2026-10-01', to: '2026-10-22' })
    expect(resolvePeriod({ preset: 'last_month' }, '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })
  it('hoy y 7 días', () => {
    expect(resolvePeriod({ preset: 'today' }, '2026-10-22')).toEqual({ from: '2026-10-22', to: '2026-10-22' })
    expect(resolvePeriod({ preset: 'last_7d' }, '2026-10-22')).toEqual({ from: '2026-10-16', to: '2026-10-22' })
  })
  it('rango respeta desde y hasta', () => {
    expect(resolvePeriod({ preset: 'custom', from: '2026-08-01', to: '2026-08-15' }, '2026-10-22'))
      .toEqual({ from: '2026-08-01', to: '2026-08-15' })
  })
  it('una URL vacía es últimos 30 días, sin fecha elegida', () => {
    expect(readPeriod(new URLSearchParams(''))).toEqual({ period: { preset: 'last_30d' }, dateField: null })
  })
  it('lee un rango y la fecha', () => {
    expect(readPeriod(new URLSearchParams('period=custom&from=2026-08-01&to=2026-08-15&date=delivered')))
      .toEqual({ period: { preset: 'custom', from: '2026-08-01', to: '2026-08-15' }, dateField: 'delivered' })
  })
  it('un preset inventado vuelve al de por defecto', () => {
    expect(readPeriod(new URLSearchParams('period=siempre')).period).toEqual({ preset: 'last_30d' })
  })
  it('escribir conserva los demás parámetros y limpia from/to si no es rango', () => {
    const p = writePeriod(new URLSearchParams('f.cliente=Walmart&from=2026-01-01&to=2026-01-02'),
      { preset: 'last_month' }, 'planning')
    expect(p.get('f.cliente')).toBe('Walmart')
    expect(p.get('period')).toBe('last_month')
    expect(p.get('from')).toBeNull()
    expect(p.get('date')).toBe('planning')
  })
})
