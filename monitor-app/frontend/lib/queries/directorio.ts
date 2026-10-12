import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { DirectoryEntity } from '@/lib/types'
import { entitySummaryKey } from '@/lib/api/entitySummary'
import { invalidarCertificacion } from './certificacion'

/**
 * Las claves de caché del Directorio y lo que deja obsoleto un cambio en una
 * empresa, un conductor o un equipo (bloque 0 del Directorio, 0.5).
 *
 * Antes cada pantalla invalidaba su propia lista: ninguna mutación del
 * Directorio refrescaba Certificación, el Cierre, el Monitor ni la vista
 * rápida, la transferencia refrescaba solo la empresa de origen, y la misma
 * empresa tenía dos claves (F-13, F-17). Ahora todas las mutaciones —del
 * Directorio, Certificación, el Cierre y el Monitor— llaman a
 * `invalidateDirectory`, y `directorio.test.ts` falla si una pantalla nueva lee
 * una raíz sin clasificar o una mutación nueva no pasa por aquí.
 */
export const directoryKeys = {
  carrierList:     (params: unknown) => ['carriers', params] as const,
  /** `status` es la lista de estados de una pestaña (Inactivas son dos). */
  carrierCount:    (status: string | readonly string[], q: string) => ['carriers-count', status, q] as const,
  search:          (q: string) => ['directorio-buscar', q] as const,
  summary:         () => ['carriers-directorio'] as const,
  /** La única clave de la ficha de una empresa. `TransporterSlideOver` usaba otra
   *  (raíz `carriers`, segmento `detail`), y una edición no refrescaba la otra. */
  carrierDetail:   (id: string | null | undefined) => ['carrier-detail', id] as const,
  carrierDrivers:  (id: string) => ['carrier-drivers', id] as const,
  carrierAssets:   (id: string) => ['carrier-assets-roster', id] as const,
  driverDetail:    (id: string | null | undefined) => ['driver-detail', id] as const,
  assetDetail:     (id: string | null | undefined) => ['asset-detail', id] as const,
  assetDriverAssignment: (id: string | null | undefined) => ['asset-driver-assignment', id] as const,
}

/** Qué cambió. `carrierIds` son las empresas cuyo roster cambió: la de la
 *  ficha y, en una transferencia, también la de destino. */
export type DirectoryChange = {
  entity: DirectoryEntity
  type: 'create' | 'update' | 'assignment' | 'contact' | 'delete'
  id?: string | null
  carrierIds?: ReadonlyArray<string | null | undefined>
}

/** Listas y cifras que dependen de cualquier entidad del Directorio. Seguros
 *  lista empresas por estado (R11). */
const DIRECTORY_ROOTS: QueryKey[] = [
  ['carriers'], ['carriers-count'], ['directorio-buscar'], ['carriers-directorio'],
  ['carriers-insurance-overview'], ['carriers-insurance-overview-count'],
]
/** Quién está disponible para un viaje, y la búsqueda de conductores. */
const MONITOR_ROOTS: QueryKey[] = [['available-drivers'], ['available-assets'], ['drivers'], ['driver-candidates']]
/** El Cierre: se recalcula en el servidor (cola, cada minuto). */
export const CLOSURE_ROOTS: readonly QueryKey[] = [
  ['daily-closure'], ['equipment-closures'], ['cierre-viajes'], ['status-report'], ['fleet-driver-gap'],
]
export const CLOSURE_NOTICE = 'El Cierre se actualizará en alrededor de un minuto.'

function rosterKeys(entity: DirectoryEntity, carrierId: string): QueryKey[] {
  const drivers: QueryKey[] = [directoryKeys.carrierDrivers(carrierId)]
  // `['carrier-assets', id]`: los equipos de la empresa en el modal de pólizas (R11).
  const assets: QueryKey[] = [directoryKeys.carrierAssets(carrierId), ['carrier-assets', carrierId]]
  return [
    directoryKeys.carrierDetail(carrierId),
    ...(entity !== 'asset' ? drivers : []),
    ...(entity !== 'driver' ? assets : []),
  ]
}

/** Las claves propias de la entidad: su ficha y, para una empresa, sus rosters.
 *  Un borrado las SACA de la caché en vez de invalidarlas: releerlas sería
 *  pedir algo que ya no existe (un 404 justo antes de navegar). */
function ownKeys(change: DirectoryChange): QueryKey[] {
  if (!change.id) return []
  if (change.entity === 'carrier') return rosterKeys('carrier', change.id)
  if (change.entity === 'driver') return [directoryKeys.driverDetail(change.id)]
  return [directoryKeys.assetDetail(change.id), directoryKeys.assetDriverAssignment(change.id)]
}

/** Lo que un contacto cambia: la ficha de la entidad y su vista rápida (el
 *  teléfono sale del contacto principal). Ni listas, ni rosters, ni
 *  Certificación, ni Monitor, ni Cierre. */
function contactKeys(change: DirectoryChange): QueryKey[] {
  if (!change.id) return []
  const detail = change.entity === 'carrier' ? directoryKeys.carrierDetail(change.id)
    : change.entity === 'driver' ? directoryKeys.driverDetail(change.id)
    : directoryKeys.assetDetail(change.id)
  return [detail, entitySummaryKey(change.entity, change.id)]
}

/**
 * Invalida solo lo afectado. Las raíces de Certificación incluyen la vista
 * rápida (`['entity-summary']`). El Cierre se marca viejo SIN releer
 * (`refetchType: 'none'`): el servidor lo recalcula en alrededor de un minuto y
 * una relectura inmediata leería la foto anterior; la pantalla del Cierre se
 * relee sola mientras el día tiene un recálculo pendiente (0.6). Devuelve si el
 * cambio llega al Cierre, para avisarlo.
 */
export async function invalidateDirectory(qc: QueryClient, change: DirectoryChange): Promise<{ affectsClosure: boolean }> {
  // Un contacto no cambia quién opera ni dónde: no toca el Cierre ni el Monitor.
  if (change.type === 'contact') {
    await Promise.all(contactKeys(change).map(queryKey => qc.invalidateQueries({ queryKey })))
    return { affectsClosure: false }
  }
  const own = ownKeys(change)
  const keys: QueryKey[] = [...DIRECTORY_ROOTS, ...MONITOR_ROOTS]
  if (change.type === 'delete') {
    for (const queryKey of own) qc.removeQueries({ queryKey, exact: true })
  } else {
    keys.push(...own)
  }
  // El panel de un tracto muestra el nombre de su conductor habitual, y no
  // sabemos de qué tracto es: raíz entera (solo se relee la que está montada).
  // Un conductor recién creado todavía no es el habitual de nadie.
  if (change.entity === 'driver' && change.type !== 'create') keys.push(['asset-driver-assignment'])
  for (const carrierId of change.carrierIds ?? []) {
    if (carrierId) keys.push(...rosterKeys(change.entity, carrierId))
  }
  await Promise.all([
    ...keys.map(queryKey => qc.invalidateQueries({ queryKey })),
    invalidarCertificacion(qc),
    ...CLOSURE_ROOTS.map(queryKey => qc.invalidateQueries({ queryKey, refetchType: 'none' })),
  ])
  return { affectsClosure: true }
}
