import type { FleetListParams } from '@/lib/types'

/** Los parámetros de Directorio › Conductores y Equipos: los dos endpoints aceptan los mismos. */
export function fleetListQuery(p: FleetListParams): URLSearchParams {
  const qs = new URLSearchParams()
  if (p.q) qs.set('q', p.q)
  if (p.flag) qs.set('flag', p.flag)
  if (p.documents) qs.set('documents', p.documents)
  qs.set('offset', String(p.offset ?? 0))
  qs.set('page_size', String(p.pageSize ?? 50))
  return qs
}
