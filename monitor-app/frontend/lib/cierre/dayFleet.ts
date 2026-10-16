/** Las filas de la Flota del día y el resumen de cada alcance, en un solo lugar
 *  (Cierre con un solo patrón, spec D1 y §4.4). Las usan la página (el resumen
 *  arriba de las pestañas) y la sección (la tabla); antes vivían dentro de la
 *  sección y la página no podía decir nada del día sin copiarlas.
 *
 *  Funciones puras sobre las dos respuestas del backend (`/daily-closures` y
 *  `/equipment-closures`). La lógica de la fusión es la de HU-D1 (06/10), movida
 *  sin cambios: una fila por patente con su conductor habitual al lado. */
import type {
  CategoriaDeLinea, ClosureScope, DailyClosureStatus, DriverDayStatusValue, EquipmentClosureStatus, EquipmentDayStatusRow,
} from '@/lib/types'

/** A qué línea del cierre escribe una fila. */
export type Destino = { tipo: 'DRIVER' | 'ASSET'; id: string }

/** De qué group es una fila de Tractoreo: una patente (con su conductor habitual
 *  si los dos cuentan lo mismo), un conductor que no quedó dentro de ninguna, o
 *  uno que salió del roster y cuya línea del día sigue contando para la firma. */
export type FleetRowGroup = 'tractor' | 'other_driver' | 'out_of_roster'

/** Cómo se dice el grupo de una fila (el filtro y el chip de la columna Grupo). */
export const FLEET_ROW_GROUP_LABEL: Record<FleetRowGroup, string> = {
  tractor: 'Patente', other_driver: 'Otro conductor del día', out_of_roster: 'Ya no está en el roster',
}

export type FleetRow = {
  key: string
  destino: Destino
  group: FleetRowGroup
  /** El tracto tiene un motivo PROPIO distinto del conductor: se muestra y se edita aparte. */
  tractoPropio: { assetId: string; reasonId: string | null } | null
  primary: string
  secondary: string | null
  assetId: string | null
  carrierName: string | null
  carrierId: string | null
  status: DriverDayStatusValue
  categoria: CategoriaDeLinea
  driverId: string | null
  /** El viaje que EXPLICA el problema (por regularizar). */
  tripId: string | null
  /** El viaje de hoy, para "Ver viaje" de una fila sana. */
  todayTripId: string | null
  unassignedReasonId: string | null
  validUntil: string | null
  tripCode: string | null
  /** De dónde salió la carga HOY (el hecho del TMS). */
  origin: string | null
  /** Origen habitual DECLARADO: de quién es la asistencia. */
  cd: string | null
  /** Generador de carga: quien pone la carga, no quien la mueve. */
  cliente: string | null
  comentario: string | null
  driverPendingDocsCritical: boolean | null
  suggestedReasonId: string | null
  lastKnownOperationType: string | null
  reasonFromDriverName: string | null
}

type FilaConductor = DailyClosureStatus['drivers'][number]

function filaDeConductor(d: FilaConductor, extra: Partial<FleetRow> = {}): FleetRow {
  return {
    key: `driver:${d.driver_id}`,
    destino: { tipo: 'DRIVER', id: d.driver_id },
    group: 'other_driver',
    tractoPropio: null,
    primary: d.full_name,
    secondary: null,
    assetId: null,
    carrierName: d.carrier_name,
    carrierId: d.carrier_id,
    status: d.status,
    categoria: d.category,
    driverId: d.driver_id,
    tripId: d.trip_id,
    todayTripId: d.today_trip_id,
    unassignedReasonId: d.unassigned_reason_id,
    validUntil: d.valid_until,
    tripCode: d.today_trip_code,
    origin: d.today_trip_origin,
    cd: d.home_cd_name,
    // El cliente es un dato del viaje: sin viaje, no hay (decisión del usuario 11/10).
    cliente: d.client_names.length ? d.client_names.join(', ') : null,
    comentario: d.comentario,
    driverPendingDocsCritical: d.driver_pending_docs_critical,
    suggestedReasonId: d.suggested_reason_id,
    lastKnownOperationType: d.last_known_operation_type,
    reasonFromDriverName: null,
    ...extra,
  }
}

function filaDeTracto(e: EquipmentDayStatusRow): FleetRow {
  return {
    key: `asset:${e.asset_id}`,
    destino: { tipo: 'ASSET', id: e.asset_id },
    group: 'tractor',
    tractoPropio: null,
    // El del VIAJE de hoy manda sobre el habitual; sin ninguno, el texto dice cuál falta.
    primary: e.trip_driver_name
      ?? e.driver_name
      ?? (e.status === 'ASSIGNED' ? 'El TMS no reportó conductor' : 'Sin conductor habitual'),
    secondary: e.tractor_plate,
    assetId: e.asset_id,
    carrierName: e.carrier_name,
    carrierId: e.carrier_id,
    status: e.status,
    categoria: e.category,
    driverId: e.trip_driver_id ?? e.driver_id,
    tripId: e.trip_id,
    todayTripId: e.trip_id,
    unassignedReasonId: e.unassigned_reason_id,
    validUntil: e.valid_until,
    tripCode: e.today_trip_code,
    origin: e.today_trip_origin,
    cd: e.home_cd_name,
    cliente: e.today_trip_client,
    comentario: e.comentario,
    driverPendingDocsCritical: null,
    suggestedReasonId: null,
    lastKnownOperationType: null,
    reasonFromDriverName: e.reason_from_driver_name ?? null,
  }
}

/** Las filas de Tractoreo: una por patente, con la línea del conductor habitual
 *  encima cuando los dos están sin carga (la fila ES el conductor y el tracto lo
 *  hereda); los conductores que no quedaron dentro de ninguna patente van aparte,
 *  y los que salieron del roster, en su propio group (0.4). */
function filasDeTractoreo(drivers: DailyClosureStatus, equipment: EquipmentClosureStatus): FleetRow[] {
  const tractos = equipment.tractoreo.equipment
  const enRoster = drivers.drivers.filter(d => d.in_roster !== false)
  const fueraDelRoster = drivers.drivers
    .filter(d => d.in_roster === false)
    .map(d => filaDeConductor(d, { group: 'out_of_roster' }))
  const conductorPorId = new Map(enRoster.map(d => [d.driver_id, d]))
  const cubiertos = new Set<string>()

  const porPatente = tractos.map(e => {
    const d = e.driver_id ? conductorPorId.get(e.driver_id) : undefined
    const base = filaDeTracto(e)
    if (!d) return base
    // Un conductor que trabajó ya está contado: su tracto sin carga necesita su propio motivo.
    if (d.status === 'ASSIGNED') {
      cubiertos.add(d.driver_id)
      return base
    }
    if (d.status === 'UNASSIGNED' && e.status === 'UNASSIGNED') {
      cubiertos.add(d.driver_id)
      const propio = e.unassigned_reason_id !== d.unassigned_reason_id && !e.reason_from_driver_name
      return filaDeConductor(d, {
        key: base.key,
        group: 'tractor',
        secondary: e.tractor_plate,
        assetId: e.asset_id,
        // Nombre e id de la MISMA empresa: la que se ve es la que se abre.
        carrierName: e.carrier_name ?? d.carrier_name,
        carrierId: e.carrier_name ? e.carrier_id : d.carrier_id,
        cd: e.home_cd_name ?? d.home_cd_name,
        tractoPropio: propio ? { assetId: e.asset_id, reasonId: e.unassigned_reason_id } : null,
      })
    }
    // Tracto asignado (lo manejó otro) con el habitual sin carga, o el habitual por regularizar.
    return base
  })

  // Los que no quedaron dentro de una patente; si son habituales de una, se muestra cuál.
  const patenteHabitual = new Map(tractos.filter(e => e.driver_id).map(e => [e.driver_id!, e.tractor_plate]))
  const otros = enRoster
    .filter(d => !cubiertos.has(d.driver_id))
    .map(d => filaDeConductor(d, { secondary: patenteHabitual.get(d.driver_id) ?? null }))

  return [...fueraDelRoster, ...porPatente, ...otros]
}

export function buildFleetRows(
  drivers: DailyClosureStatus, equipment: EquipmentClosureStatus, alcance: ClosureScope,
): FleetRow[] {
  return alcance === 'tractoreo'
    ? filasDeTractoreo(drivers, equipment)
    : equipment.equipos_completos.equipment.map(filaDeTracto)
}

export type ScopeSummary = {
  assigned: number
  unassigned: number
  utilizationPct: number
  /** Lo que bloquea la firma; `null` donde no se exige motivo (Equipo Completo). */
  blocking: number | null
}

/** El resumen de un alcance, con las fórmulas de siempre (spec §4.6: no cambian). */
export function scopeSummary(
  drivers: DailyClosureStatus, equipment: EquipmentClosureStatus, alcance: ClosureScope,
): ScopeSummary {
  if (alcance === 'equipo_completo') {
    const s = equipment.equipos_completos.summary
    return { assigned: s.assigned, unassigned: s.unassigned, utilizationPct: s.utilization_pct, blocking: null }
  }
  const filas = filasDeTractoreo(drivers, equipment)
  const assigned = filas.filter(r => r.categoria === 'ASIGNADO').length
  return {
    assigned,
    unassigned: filas.length - assigned,
    utilizationPct: filas.length ? Math.round(assigned / filas.length * 1000) / 10 : 0,
    // Una fila fusionada cuenta una vez; un tracto con motivo propio pendiente también bloquea.
    blocking: filas.filter(r => r.categoria === 'SIN_RESOLVER' || (r.tractoPropio && !r.tractoPropio.reasonId)).length,
  }
}
