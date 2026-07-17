import type { CarrierListItem } from '@/lib/types'

/** Tabs Activas/Legacy del listado de Empresas (plan H3.4) — split directo
 *  sobre operational_status, calculado por el backend. app.carrier_compliance_status
 *  NO filtra por estado operativo a propósito (ver context_carriers.md §3.D):
 *  es responsabilidad del frontend separar la vista. */
export type TransporterTab = 'active' | 'legacy'

export function matchesTab(item: Pick<CarrierListItem, 'operational_status'>, tab: TransporterTab): boolean {
  return tab === 'active' ? item.operational_status === 'ACTIVE' : item.operational_status !== 'ACTIVE'
}

export type TransporterTabCounts = { active: number; legacy: number }

export function countByTab(items: Pick<CarrierListItem, 'operational_status'>[]): TransporterTabCounts {
  const counts: TransporterTabCounts = { active: 0, legacy: 0 }
  for (const item of items) {
    if (matchesTab(item, 'active')) counts.active++
    else counts.legacy++
  }
  return counts
}
