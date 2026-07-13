import { describe, it, expect } from 'vitest'
import {
  isTransporterActive, isOperativa, hasDocsAlert, hasInsuranceAlert,
  matchesTransporterFilter, deriveTransporterKpis,
} from './transporterFilters'
import type { TransporterListItem } from '@/lib/types'

function makeItem(overrides: Partial<TransporterListItem> = {}): TransporterListItem {
  return {
    id: '1', admin_id: null, business_name: 'Transportes Test', rut: '11111111-1',
    account_stage: 'Operational', driver_count: 2, vehicle_count: 1, trailer_count: 0,
    tracto_count: 1, has_manual_edits: false, has_active_alerts: false,
    in_admin: true, clients: ['Walmart'], avance_80_20: 90, avance_total: 90,
    compliance_pct: 95, eligible: true, insurance_ok: true, policies_count: 1,
    blocking_reasons: [],
    operational_status: 'operativa', matched_by_upload: false, admin_account_id: null,
    ...overrides,
  }
}

describe('isTransporterActive', () => {
  it('is active when blocking_reasons has no "inactive"', () => {
    expect(isTransporterActive(makeItem({ blocking_reasons: ['docs_below_threshold'] }))).toBe(true)
  })
  it('is inactive when blocking_reasons includes "inactive"', () => {
    expect(isTransporterActive(makeItem({ blocking_reasons: ['inactive'] }))).toBe(false)
  })
})

describe('isOperativa', () => {
  it('is operativa when operational_status === "operativa"', () => {
    expect(isOperativa(makeItem({ operational_status: 'operativa' }))).toBe(true)
  })
  it('is not operativa when operational_status === "no_operativa"', () => {
    expect(isOperativa(makeItem({ operational_status: 'no_operativa' }))).toBe(false)
  })
})

describe('hasDocsAlert / hasInsuranceAlert', () => {
  it('docs alert only from docs_below_threshold', () => {
    expect(hasDocsAlert(makeItem({ blocking_reasons: ['docs_below_threshold'] }))).toBe(true)
    expect(hasDocsAlert(makeItem({ blocking_reasons: [] }))).toBe(false)
  })
  it('insurance alert from blocking_reasons or insurance_ok === false', () => {
    expect(hasInsuranceAlert(makeItem({ blocking_reasons: ['insurance_overdue'] }))).toBe(true)
    expect(hasInsuranceAlert(makeItem({ blocking_reasons: [], insurance_ok: false }))).toBe(true)
    // null (sin pólizas) no es una alerta — es "sin información"
    expect(hasInsuranceAlert(makeItem({ blocking_reasons: [], insurance_ok: null }))).toBe(false)
    expect(hasInsuranceAlert(makeItem({ blocking_reasons: [], insurance_ok: true }))).toBe(false)
  })
})

describe('matchesTransporterFilter', () => {
  const active   = makeItem({ id: 'a', blocking_reasons: [], eligible: true })
  const inactive = makeItem({ id: 'b', blocking_reasons: ['inactive'], eligible: false })
  const docsAlert = makeItem({ id: 'c', blocking_reasons: ['docs_below_threshold'], eligible: false })
  const insAlert  = makeItem({ id: 'd', blocking_reasons: ['insurance_overdue'], eligible: false })

  it('filters by each id correctly', () => {
    expect(matchesTransporterFilter(active, 'active')).toBe(true)
    expect(matchesTransporterFilter(inactive, 'active')).toBe(false)
    expect(matchesTransporterFilter(inactive, 'inactive')).toBe(true)
    expect(matchesTransporterFilter(active, 'eligible')).toBe(true)
    expect(matchesTransporterFilter(docsAlert, 'alert_docs')).toBe(true)
    expect(matchesTransporterFilter(insAlert, 'alert_insurance')).toBe(true)
    expect(matchesTransporterFilter(docsAlert, 'alert_any')).toBe(true)
    expect(matchesTransporterFilter(insAlert, 'alert_any')).toBe(true)
    expect(matchesTransporterFilter(active, 'alert_any')).toBe(false)
  })
})

describe('deriveTransporterKpis', () => {
  it('calcula los 4 conteos accionables sobre la data cargada', () => {
    const items = [
      makeItem({ id: 'a', blocking_reasons: [], eligible: true, insurance_ok: true }),
      makeItem({ id: 'b', blocking_reasons: ['inactive'], eligible: false, insurance_ok: null }),
      makeItem({ id: 'c', blocking_reasons: ['docs_below_threshold'], eligible: false }),
      makeItem({ id: 'd', blocking_reasons: ['insurance_overdue'], eligible: false, insurance_ok: false }),
    ]
    expect(deriveTransporterKpis(items)).toEqual({
      active: 3,      // todas menos 'b'
      eligible: 1,    // solo 'a'
      alert_any: 2,   // 'c' (docs) y 'd' (seguro)
      inactive: 1,    // 'b'
    })
  })
})
