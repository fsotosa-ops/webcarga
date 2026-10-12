import { describe, it, expect } from 'vitest'
import { complianceRecordsToChecklistItems } from './complianceChecklist'
import type { ComplianceRecord } from '@/lib/types'

const RECORD: ComplianceRecord = {
  id: 'cr1',
  requirement_id: 'req1',
  requirement_code: 'F30_MULTAS',
  name: 'F30 Multas',
  requirement_level: 'LEGAL_MANDATORY',
  requires_file: true,
  status: 'APPROVED',
  expiration_date: '2027-01-01',
  file_url: null,
  metadata: {},
  is_manual_override: false,
  is_expired: false,
  is_expiring_soon: false,
  document_state: 'UP_TO_DATE',
  days_to_expiry: null,
  alert_severity: null,
  updated_at: null,
}

describe('complianceRecordsToChecklistItems', () => {
  it('maps compliance_records fields onto ChecklistItem 1:1', () => {
    expect(complianceRecordsToChecklistItems([RECORD])).toEqual([{
      id: 'cr1',
      // Se arrastra para poder cargar contra el requisito correcto desde la ficha.
      requirement_id: 'req1',
      requirement_code: 'F30_MULTAS',
      label: 'F30 Multas',
      status: 'APPROVED',
      requires_file: true,
      expiration_date: '2027-01-01',
      document_state: 'UP_TO_DATE',
      days_to_expiry: null,
      alert_severity: null,
      file_url: null,
    }])
  })

  it('returns an empty list for no records', () => {
    expect(complianceRecordsToChecklistItems([])).toEqual([])
  })
})
