import type { Trip, TemperatureRangeMeta, MonitorAlertRules } from '@/lib/types'
import { matchesKpi, deriveKpis, type KpiId, DEFAULT_ALERT_RULES } from './kpis'

/** IDs de tipo KPI (evaluados client-side sobre trips ya cargados, OR entre
 *  ellos) — reducidos a 4 (2026-08-01, ver kpis.ts). IDs de tipo flag (query
 *  param server-side, AND entre ellos) — 3 heredados + "2ª+ vuelta"
 *  (reemplaza a is_first_leg). */
export type FlagSignalId = 'active' | 'working' | 'assigned' | 'second_leg_plus'
export type AlertSignalId = KpiId | FlagSignalId

export const KPI_SIGNAL_IDS: KpiId[] =
  ['dwell_severity', 'stale', 'tms_dropped', 'temp_out', 'temp_reported', 'fleet_unmatched']
export const FLAG_SIGNAL_IDS: FlagSignalId[] =
  ['active', 'working', 'assigned', 'second_leg_plus']

export function isKpiSignal(id: AlertSignalId): id is KpiId {
  return (KPI_SIGNAL_IDS as string[]).includes(id)
}

export interface AlertSignalDef {
  id:         AlertSignalId
  label:      string
  colorCls:   string  // texto del conteo cuando > 0, ej. 'text-red-600'
  activeCls:  string  // borde/ring/bg cuando la tile está activa como filtro
}

export function alertSignalDefs(rules: MonitorAlertRules): AlertSignalDef[] {
  return [
    // Hito 14 (minuta 29/07 §4.4) — semáforo de 4 niveles reemplaza al
    // binario "Detenido en local > 2h"; la tile cuenta solo lo anómalo
    // (amarillo/naranja/rojo), ver dwellSeverity/matchesKpi en kpis.ts.
    { id: 'dwell_severity', label: 'Detenido en local',           colorCls: 'text-orange-600', activeCls: 'border-orange-400 ring-2 ring-orange-100 bg-orange-50' },
    // "Sin actualización del TMS" (antes "Sin reporte del TMS") — mismo
    // concepto que "stale data"/"last ping" en tracking de flota,
    // renombrado 2026-08-01 a pedido del usuario para usar un término más
    // claro/estándar de la industria.
    { id: 'stale',          label: `Sin actualización del TMS > ${rules.stale_report_hours}h`, colorCls: 'text-amber-600', activeCls: 'border-amber-400 ring-2 ring-amber-100 bg-amber-50' },
    // "Ya no está en el TMS" (Ronda 126) — el portal del mandante dejó de
    // listar este viaje. Nace del caso Sodimac, que elimina viajes sin cambiar
    // el estado: quedan en "asignado" para siempre y molestan el cierre.
    //
    // SIN UMBRAL EN LA ETIQUETA, a diferencia de las señales de al lado, y es
    // deliberado: acá el fenómeno NO es de grado. Medido en producción el
    // 2026-08-18, el atraso mínimo real es 1 día 11 h y 3 h / 12 h / 24 h
    // marcan exactamente los mismos viajes — o está en la corrida vigente o
    // se fue del portal. `tms_dropped_hours` existe sólo como protección
    // contra el intervalo entre corridas, y mostrarlo acá haría pasar por
    // alerta de grado algo que es un estado binario.
    //
    // Dice lo que se observa ("ya no está"), no por qué: si fue el mandante
    // quien lo eliminó o una corrida que falló es justo lo que falta definir
    // (GitHub issue #3).
    { id: 'tms_dropped',    label: 'Ya no está en el TMS', colorCls: 'text-rose-600', activeCls: 'border-rose-400 ring-2 ring-rose-100 bg-rose-50' },
    { id: 'temp_out',       label: 'Temp fuera de rango',         colorCls: 'text-blue-600',   activeCls: 'border-blue-400 ring-2 ring-blue-100 bg-blue-50' },
    // Los que SI reportan temperatura — el subconjunto con cadena de frio.
    // "Fuera de rango" solo muestra los que ya fallaron; para vigilar el frio
    // hace falta ver todos los que lo llevan.
    { id: 'temp_reported',  label: 'Con temperatura',             colorCls: 'text-cyan-700',   activeCls: 'border-cyan-400 ring-2 ring-cyan-100 bg-cyan-50' },
    // "Sin identificar" (Ronda 43, Hallazgo F) — tracto/conductor sin
    // ningún cruce contra empresa, pedido por Pablo específicamente visible
    // "en la cuadratura de la caja", no solo dentro del detalle de un
    // viaje. Label neutro, no la frase coloquial ("Equipo OVNI") que usó
    // Pablo en la reunión al explicar la idea — no es nomenclatura
    // estándar de industria/logtech.
    { id: 'fleet_unmatched',  label: 'Sin identificar', colorCls: 'text-amber-600',  activeCls: 'border-amber-400 ring-2 ring-amber-100 bg-amber-50' },
    { id: 'active',           label: 'Activo',       colorCls: 'text-blue-600',   activeCls: 'border-blue-400 ring-2 ring-blue-100 bg-blue-50' },
    { id: 'working',          label: 'Trabajando',   colorCls: 'text-green-600',  activeCls: 'border-green-400 ring-2 ring-green-100 bg-green-50' },
    { id: 'assigned',         label: 'Asignado',     colorCls: 'text-violet-600', activeCls: 'border-violet-400 ring-2 ring-violet-100 bg-violet-50' },
    { id: 'second_leg_plus',  label: '2ª+ vuelta',   colorCls: 'text-amber-600',  activeCls: 'border-amber-400 ring-2 ring-amber-100 bg-amber-50' },
  ]
}

/** Conteo de cada señal sobre los trips ya cargados — mismo dato para las
 *  tiles pineadas y las filas del popover. Los 4 flags leen directo de
 *  columnas de Trip (mismo criterio que ya usaba page.tsx); los 4 KPI usan
 *  el evaluador existente de kpis.ts, sin duplicar esa lógica. */
export function computeSignalCounts(
  trips: Trip[],
  ranges: TemperatureRangeMeta[],
  rules: MonitorAlertRules = DEFAULT_ALERT_RULES,
): Record<AlertSignalId, number> {
  const kpiCounts = deriveKpis(trips, ranges, rules)
  return {
    ...kpiCounts,
    active:           trips.filter(t => t.is_active).length,
    working:          trips.filter(t => t.is_working).length,
    assigned:         trips.filter(t => t.is_assigned).length,
    second_leg_plus:  trips.filter(t => (t.driver_leg_number ?? 0) >= 2).length,
  }
}

/** true si el trip matchea la señal dada — usa matchesKpi para los 4 KPI,
 *  lee la columna directo para los 4 flags (mismo criterio que
 *  computeSignalCounts, para que conteo y filtro nunca diverjan). */
export function matchesSignal(
  trip: Trip,
  id: AlertSignalId,
  ranges: TemperatureRangeMeta[],
  rules: MonitorAlertRules = DEFAULT_ALERT_RULES,
): boolean {
  if (isKpiSignal(id)) return matchesKpi(trip, id, ranges, rules)
  switch (id) {
    case 'active':          return trip.is_active
    case 'working':         return trip.is_working
    case 'assigned':        return trip.is_assigned
    case 'second_leg_plus': return (trip.driver_leg_number ?? 0) >= 2
  }
}

/** true si el trip pasa el conjunto de señales activas — OR entre las de
 *  tipo KPI, AND con cada flag activo. Los flags ya se filtran server-side
 *  (query params, ver page.tsx) — esta función es la fuente de verdad del
 *  filtrado client-side de KPI y también sirve como criterio consistente
 *  si algún día se necesita fuera de ese flujo de query params. */
export function matchesActiveSignals(
  trip: Trip,
  activeSignals: AlertSignalId[],
  ranges: TemperatureRangeMeta[],
  rules: MonitorAlertRules = DEFAULT_ALERT_RULES,
): boolean {
  const kpiActive  = activeSignals.filter(isKpiSignal)
  const flagActive = activeSignals.filter(id => !isKpiSignal(id))
  const kpiOk  = kpiActive.length === 0 || kpiActive.some(id => matchesKpi(trip, id, ranges, rules))
  const flagOk = flagActive.every(id => matchesSignal(trip, id, ranges, rules))
  return kpiOk && flagOk
}

export type SeverityBand = 'neutral' | 'elevated' | 'critical'

/** Banda simple por conteo — 0 = neutro, 1-2 = elevado, 3+ = crítico. Valores
 *  de corte fijos por ahora (no configurables), aplicados a las tiles
 *  pineadas para dar peso visual proporcional a la gravedad actual, no solo
 *  a la categoría. */
export function severityBand(count: number): SeverityBand {
  if (count >= 3) return 'critical'
  if (count >= 1) return 'elevated'
  return 'neutral'
}
