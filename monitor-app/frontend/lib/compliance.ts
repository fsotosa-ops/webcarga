import type { AlertStatus, AlertThresholdMeta, ComplianceStatus, TransporterDriver, TransporterVehicle } from './types'

const DEFAULT_WARNING_DAYS = 30

/** Estilo compartido para el estado de un documento de gobernanza/compliance
 *  (ok/pendiente/actualizar/n_a/factible) — usado en la ficha de empresa
 *  (governance selects) y en el panel de Documentos de la Empresa. */
export const COMPLIANCE_STATUS_CONFIG: Record<ComplianceStatus, { cls: string; label: string }> = {
  ok:         { cls: 'bg-green-100 text-green-700',  label: 'OK' },
  pendiente:  { cls: 'bg-amber-50 text-amber-600',   label: 'Pendiente' },
  actualizar: { cls: 'bg-blue-50 text-blue-600',     label: 'Actualizar' },
  n_a:        { cls: 'bg-gray-100 text-gray-500',    label: 'N/A' },
  factible:   { cls: 'bg-teal-50 text-teal-700',     label: 'Factible' },
}

export function getAlertStatus(
  dateStr: string | null | undefined,
  warningDays = DEFAULT_WARNING_DAYS,
  errorDays = 0,
): AlertStatus {
  if (!dateStr) return 'ok'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const expiry = new Date(dateStr + 'T12:00:00')
  const daysLeft = Math.ceil((expiry.getTime() - today.getTime()) / 86_400_000)
  if (daysLeft <= errorDays) return 'expired'
  if (daysLeft <= warningDays) return 'expiring_soon'
  return 'ok'
}

// Convenience: looks up threshold for a doc_type from the meta array
export function getAlertStatusFor(
  dateStr: string | null | undefined,
  docType: string,
  thresholds: AlertThresholdMeta[] | undefined,
): AlertStatus {
  const t = thresholds?.find(x => x.doc_type === docType)
  return getAlertStatus(dateStr, t?.warning_days ?? DEFAULT_WARNING_DAYS, t?.error_days ?? 0)
}

export function getDriverAlertStatus(driver: TransporterDriver): AlertStatus {
  const statuses = [
    getAlertStatus(driver.governance?.id_expiry),
    getAlertStatus(driver.governance?.license_expiry),
  ]
  if (statuses.includes('expired')) return 'expired'
  if (statuses.includes('expiring_soon')) return 'expiring_soon'
  return 'ok'
}

export function getVehicleAlertStatus(vehicle: TransporterVehicle): AlertStatus {
  const statuses = [
    getAlertStatus(vehicle.governance?.circ_permit_expiry),
    getAlertStatus(vehicle.governance?.tech_inspection_expiry),
    getAlertStatus(vehicle.governance?.gas_emissions_expiry),
    getAlertStatus(vehicle.governance?.soap_insurance_expiry),
  ]
  if (statuses.includes('expired')) return 'expired'
  if (statuses.includes('expiring_soon')) return 'expiring_soon'
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
