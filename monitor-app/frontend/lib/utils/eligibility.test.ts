import { describe, it, expect } from 'vitest'
import { describeBlockingReason, eligibilityColor, describeEligibility, DEFAULT_COMPLIANCE_THRESHOLD } from './eligibility'

describe('describeBlockingReason', () => {
  it('maps docs_below_threshold with the compliance pct and default threshold', () => {
    expect(describeBlockingReason('docs_below_threshold', 82)).toBe(
      `Documentación bajo el umbral (82% < ${DEFAULT_COMPLIANCE_THRESHOLD}%)`,
    )
  })
  it('maps docs_below_threshold without a known pct', () => {
    expect(describeBlockingReason('docs_below_threshold', null)).toContain('— <')
  })
  it('maps insurance_overdue', () => {
    expect(describeBlockingReason('insurance_overdue')).toBe('Cuota de seguro vencida')
  })
  it('maps inactive', () => {
    expect(describeBlockingReason('inactive')).toBe('Empresa inactiva')
  })
  it('falls back to the raw reason for unknown values (never hides it)', () => {
    expect(describeBlockingReason('algo_nuevo')).toBe('algo_nuevo')
  })
})

describe('eligibilityColor', () => {
  it('is green when eligible', () => {
    expect(eligibilityColor(true, [])).toBe('green')
  })
  it('is red for hard blockers (inactive / insurance_overdue)', () => {
    expect(eligibilityColor(false, ['inactive'])).toBe('red')
    expect(eligibilityColor(false, ['insurance_overdue'])).toBe('red')
  })
  it('is amber for soft blockers (docs only)', () => {
    expect(eligibilityColor(false, ['docs_below_threshold'])).toBe('amber')
  })
})

describe('describeEligibility', () => {
  it('joins multiple reasons', () => {
    const text = describeEligibility(false, ['docs_below_threshold', 'insurance_overdue'], 70)
    expect(text).toContain('Documentación bajo el umbral')
    expect(text).toContain('Cuota de seguro vencida')
  })
  it('reports habilitada when eligible', () => {
    expect(describeEligibility(true, [])).toBe('Habilitada para asignar')
  })
})
