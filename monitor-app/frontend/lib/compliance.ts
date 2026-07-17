import type { ComplianceStatus } from './types'

/** Estilo compartido para el estado de un compliance_record (7 valores del
 *  CHECK constraint real de public.compliance_records.status, ver lib/types.ts)
 *  — usado en DocumentChecklist y en cualquier badge/select que muestre el
 *  status de un documento. */
export const COMPLIANCE_STATUS_CONFIG: Record<ComplianceStatus, { cls: string; label: string }> = {
  MISSING:         { cls: 'bg-gray-100 text-gray-500',   label: 'Falta' },
  PENDING_REVIEW:  { cls: 'bg-amber-50 text-amber-600',  label: 'En revisión' },
  APPROVED_MANUAL: { cls: 'bg-teal-50 text-teal-700',    label: 'Aprobado (manual)' },
  APPROVED:        { cls: 'bg-green-100 text-green-700', label: 'Aprobado' },
  REJECTED:        { cls: 'bg-red-100 text-red-600',     label: 'Rechazado' },
  EXPIRED:         { cls: 'bg-red-100 text-red-600',     label: 'Vencido' },
  ARCHIVED:        { cls: 'bg-gray-100 text-gray-400',   label: 'Archivado' },
}

/** Estado de alerta de vencimiento — 'ok' | 'expiring_soon' | 'expired'.
 *  El backend ya calcula is_expired/is_expiring_soon por compliance_record
 *  (GET /carriers/{id}, /drivers/{id}/compliance-records, etc.); no hay
 *  date-math que hacer client-side (a diferencia del modelo viejo, que
 *  calculaba esto acá desde columnas `governance` con fechas sueltas). */
export type AlertStatus = 'ok' | 'expiring_soon' | 'expired'

export function complianceAlertStatus(isExpired: boolean, isExpiringSoon: boolean): AlertStatus {
  if (isExpired) return 'expired'
  if (isExpiringSoon) return 'expiring_soon'
  return 'ok'
}

export function formatExpiry(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  // Fechas "solo día" (columnas DATE, ej. expiry_date) llegan sin componente de hora
  // y necesitan mediodía local para no cruzar el límite de zona horaria. Timestamps
  // completos (columnas timestamptz, ej. audit_log.occurred_at → replaced_at) ya
  // traen hora + offset — anexar otro "T12:00:00" los rompería (Invalid Date).
  const hasTimeComponent = dateStr.includes('T')
  const parsed = hasTimeComponent ? new Date(dateStr) : new Date(dateStr + 'T12:00:00')
  return parsed.toLocaleDateString('es-CL', {
    day: '2-digit', month: '2-digit', year: '2-digit',
  })
}
