import { describe, it, expect } from 'vitest'
import { groupInstallments } from './insuranceGrouping'
import type { InsuranceInstallmentFlat } from '@/lib/types'

const TODAY = new Date().toISOString().slice(0, 10)
const IN_3_DAYS = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
const YESTERDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

function row(overrides: Partial<InsuranceInstallmentFlat>): InsuranceInstallmentFlat {
  return {
    installment_id: 'i1', policy_id: 'p1', transporter_id: 't1', rut: '11111111-1',
    business_name: 'Empresa A', company: 'HDI', policy_number: '100', client_group: 'Walmart',
    installment_number: 1, amount_uf: 2, due_date: TODAY, status: 'pendiente', is_overdue: false,
    ...overrides,
  }
}

describe('groupInstallments', () => {
  it('puts overdue rows in a fixed "overdue" group first when grouping by week', () => {
    const rows = [
      row({ installment_id: 'a', status: 'vencida', is_overdue: true, due_date: YESTERDAY }),
      row({ installment_id: 'b', status: 'pendiente', is_overdue: false, due_date: IN_3_DAYS }),
    ]
    const groups = groupInstallments(rows, 'week')
    expect(groups[0].key).toBe('overdue')
    expect(groups[0].rows).toHaveLength(1)
    expect(groups[0].rows[0].installment_id).toBe('a')
  })

  it('computes the correct UF subtotal per group', () => {
    const rows = [
      row({ installment_id: 'a', amount_uf: 4.2 }),
      row({ installment_id: 'b', amount_uf: 2.8 }),
    ]
    const groups = groupInstallments(rows, 'none')
    const total = groups.reduce((sum, g) => sum + g.totalUf, 0)
    expect(total).toBeCloseTo(7.0)
  })

  it('does not create a separate overdue group when grouping by client_group', () => {
    const rows = [
      row({ installment_id: 'a', status: 'vencida', is_overdue: true, client_group: 'Walmart' }),
      row({ installment_id: 'b', status: 'pendiente', is_overdue: false, client_group: 'Colun' }),
    ]
    const groups = groupInstallments(rows, 'client_group')
    expect(groups.find(g => g.key === 'overdue')).toBeUndefined()
    expect(groups.map(g => g.key).sort()).toEqual(['Colun', 'Walmart'])
  })

  it('groups by company', () => {
    const rows = [
      row({ installment_id: 'a', company: 'HDI' }),
      row({ installment_id: 'b', company: 'Mapfre' }),
    ]
    const groups = groupInstallments(rows, 'company')
    expect(groups.map(g => g.key).sort()).toEqual(['HDI', 'Mapfre'])
  })

  it('treats rows with amount_uf null as contributing 0 to the subtotal', () => {
    const rows = [row({ installment_id: 'a', amount_uf: null })]
    const groups = groupInstallments(rows, 'none')
    expect(groups[0].totalUf).toBe(0)
  })
})
