import { describe, it, expect } from 'vitest'
import { dueThisMonth, matchesInsuranceFilter, deriveInsuranceKpis } from './insuranceFilters'
import type { InsuranceSummaryRow } from '@/lib/types'

const NOW = new Date('2026-07-15T12:00:00')

function makeRow(overrides: Partial<InsuranceSummaryRow> = {}): InsuranceSummaryRow {
  return {
    rut: '11111111-1', business_name: 'Transportes Test', transporter_id: 't1',
    policies_count: 1, next_due: null, overdue_count: 0, paid_pct: 100, insurance_ok: true,
    ...overrides,
  }
}

describe('dueThisMonth', () => {
  it('true when next_due falls in the same calendar month', () => {
    expect(dueThisMonth(makeRow({ next_due: { date: '2026-07-30', amount_uf: 5 } }), NOW)).toBe(true)
  })
  it('false for a different month', () => {
    expect(dueThisMonth(makeRow({ next_due: { date: '2026-08-01', amount_uf: 5 } }), NOW)).toBe(false)
  })
  it('false when there is no next_due', () => {
    expect(dueThisMonth(makeRow({ next_due: null }), NOW)).toBe(false)
  })
})

describe('matchesInsuranceFilter', () => {
  it('overdue', () => {
    expect(matchesInsuranceFilter(makeRow({ overdue_count: 2 }), 'overdue', NOW)).toBe(true)
    expect(matchesInsuranceFilter(makeRow({ overdue_count: 0 }), 'overdue', NOW)).toBe(false)
  })
  it('ok', () => {
    expect(matchesInsuranceFilter(makeRow({ insurance_ok: true }), 'ok', NOW)).toBe(true)
    expect(matchesInsuranceFilter(makeRow({ insurance_ok: false }), 'ok', NOW)).toBe(false)
  })
  it('due_this_month', () => {
    expect(matchesInsuranceFilter(makeRow({ next_due: { date: '2026-07-05', amount_uf: 1 } }), 'due_this_month', NOW)).toBe(true)
  })
})

describe('deriveInsuranceKpis', () => {
  it('counts each bucket over the loaded rollup', () => {
    const rows = [
      makeRow({ rut: 'a', insurance_ok: true, overdue_count: 0, next_due: { date: '2026-07-20', amount_uf: 3 } }),
      makeRow({ rut: 'b', insurance_ok: false, overdue_count: 1 }),
      makeRow({ rut: 'c', insurance_ok: true, overdue_count: 0, next_due: null }),
    ]
    expect(deriveInsuranceKpis(rows, NOW)).toEqual({ ok: 2, overdue: 1, due_this_month: 1 })
  })
})
