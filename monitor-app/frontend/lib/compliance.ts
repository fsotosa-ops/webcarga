import type { AlertStatus, TransporterDriver, TransporterVehicle } from './types'

const ALERT_DAYS = 30

export function getAlertStatus(dateStr: string | null | undefined): AlertStatus {
  if (!dateStr) return 'ok'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const expiry = new Date(dateStr + 'T12:00:00')
  const daysLeft = Math.ceil((expiry.getTime() - today.getTime()) / 86_400_000)
  if (daysLeft < 0) return 'expired'
  if (daysLeft <= ALERT_DAYS) return 'expiring_soon'
  return 'ok'
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
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-CL', {
    day: '2-digit', month: '2-digit', year: '2-digit',
  })
}
