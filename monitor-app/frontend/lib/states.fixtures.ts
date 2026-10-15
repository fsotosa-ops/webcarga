import type { ComplianceSummary, DocumentState } from './states'

/** Fixtures de test: un resumen al día y los tres campos de estado de un
 *  registro. Cada test pisa lo que necesita. */
export function complianceSummary(over: Partial<ComplianceSummary> = {}): ComplianceSummary {
  return { worst_state: 'UP_TO_DATE', own: { overdue: 0, expiring: 0, missing: 0 }, fleet: null, can_operate: true, blocking: { own: 0, fleet: null }, ...over }
}
export function recordStateFields(document_state: DocumentState = 'UP_TO_DATE') {
  return { document_state, days_to_expiry: null, alert_severity: null } as const
}
