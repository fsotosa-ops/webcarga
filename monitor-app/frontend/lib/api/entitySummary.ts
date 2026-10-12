import type { DocumentSummary } from '@/components/ui/DocumentStatusBar'
import type { DirectoryEntity } from '@/lib/types'
import { apiFetch } from './client'

/** El resumen de solo lectura de una entidad para la vista rápida del Cierre
 *  (GET /{drivers|assets|carriers}/{id}/summary, HU 20261011/01). */
export type EntityKind = DirectoryEntity

export type EntityRef = { id: string; name: string }

type Base = { id: string; operational_status: string; documents: DocumentSummary }

export type DriverSummary = Base & {
  full_name: string
  tax_id: string | null
  carrier: EntityRef | null
  home_location: { name: string; shipper: string | null } | null
  usual_tractor: { id: string; plate: string } | null
  phone: string | null
}

export type AssetSummary = Base & {
  license_plate: string
  asset_type: string
  manufacture_year: number | null
  operation_type: string | null
  carrier: EntityRef | null
  usual_driver: EntityRef | null
}

export type CarrierSummary = Base & {
  business_name: string
  tax_id: string | null
  shippers: EntityRef[]
  active_drivers: number
  active_assets: number
  primary_contact: { name: string | null; phone: string | null } | null
}

export type EntitySummary = {
  carrier: CarrierSummary
  driver: DriverSummary
  asset: AssetSummary
}

const PATH: Record<EntityKind, string> = { carrier: 'carriers', driver: 'drivers', asset: 'assets' }

export function fetchEntitySummary<K extends EntityKind>(kind: K, id: string): Promise<EntitySummary[K]> {
  return apiFetch<EntitySummary[K]>(`/api/v1/${PATH[kind]}/${id}/summary`)
}

export const entitySummaryKey = (kind: EntityKind, id: string) => ['entity-summary', kind, id] as const
