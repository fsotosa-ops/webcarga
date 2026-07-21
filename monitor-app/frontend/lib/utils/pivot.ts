import type { DailyClosureReportRow, DriverDayStatusValue } from '@/lib/types'

/** Motor de tabla dinámica para Reportería (spec
 *  2026-07-21-cuadratura-reporteria-redesign-design.md). Campos fijos y
 *  conocidos (no drag-and-drop de datos arbitrarios) — a propósito, ver el
 *  spec: evita construir un motor de pivot genérico cuando el set real de
 *  dimensiones es chico y estable. */

export type FieldId = 'carrier' | 'client' | 'status' | 'reason' | 'date'
export type Granularity = 'day' | 'week' | 'month' | 'quarter' | 'semester'

export type PivotFieldSpec = {
  field:        FieldId
  /** Solo aplica cuando field === 'date' */
  granularity?: Granularity
}

export const FIELD_LABELS: Record<FieldId, string> = {
  carrier: 'Empresa', client: 'Cliente', status: 'Estado', reason: 'Motivo', date: 'Fecha',
}

export const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: 'Día', week: 'Semana', month: 'Mes', quarter: 'Trimestre', semester: 'Semestre',
}

// "Por regularizar" en vez de "Mismatch" (feedback del usuario 2026-07-22)
const STATUS_LABEL: Record<DriverDayStatusValue, string> = {
  ASSIGNED: 'Asignado', UNASSIGNED: 'No asignado', MISMATCH: 'Por regularizar',
}

function isoWeekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const day = (d.getDay() + 6) % 7 // 0 = lunes
  d.setDate(d.getDate() - day)
  return d.toISOString().split('T')[0]
}

/** Bucket de fecha legible y ordenable por string (YYYY-... primero) para
 *  la granularidad pedida. */
export function bucketDate(dateStr: string, granularity: Granularity): string {
  const [year, month] = dateStr.split('-').map(Number)
  switch (granularity) {
    case 'day':      return dateStr
    case 'week':      return `Semana del ${isoWeekStart(dateStr)}`
    case 'month':     return `${year}-${String(month).padStart(2, '0')}`
    case 'quarter':   return `${year}-T${Math.ceil(month / 3)}`
    case 'semester':  return `${year}-S${month <= 6 ? 1 : 2}`
  }
}

/** Valores de un campo para una fila — array porque cliente es multi-valor
 *  (un conductor puede haber servido a más de un cliente el mismo día; ese
 *  conductor cuenta una vez por cada cliente cuando "Cliente" es una
 *  dimensión activa, misma semántica que Fase 1.5). */
export function fieldValues(row: DailyClosureReportRow, spec: PivotFieldSpec): string[] {
  switch (spec.field) {
    case 'carrier': return [row.carrier_name ?? 'Sin empresa']
    case 'client':  return row.client_names.length ? row.client_names : ['Sin cliente']
    case 'status':  return [STATUS_LABEL[row.status]]
    case 'reason':  return row.status === 'UNASSIGNED' ? [row.unassigned_reason_label ?? 'Sin especificar'] : ['—']
    case 'date':    return [bucketDate(row.business_date, spec.granularity ?? 'day')]
  }
}

/** Todos los valores distintos que existen para un campo en el dataset
 *  completo — para poblar el selector de valores de un filtro. */
export function distinctFieldValues(rows: DailyClosureReportRow[], spec: PivotFieldSpec): string[] {
  const set = new Set<string>()
  for (const r of rows) for (const v of fieldValues(r, spec)) set.add(v)
  return [...set].sort()
}

export type PivotFilter = { spec: PivotFieldSpec; allowed: Set<string> }

export function applyFilters(rows: DailyClosureReportRow[], filters: PivotFilter[]): DailyClosureReportRow[] {
  if (!filters.length) return rows
  return rows.filter(r => filters.every(f => fieldValues(r, f.spec).some(v => f.allowed.has(v))))
}

function compoundKey(row: DailyClosureReportRow, specs: PivotFieldSpec[]): string[] {
  if (!specs.length) return ['Total']
  let keys = ['']
  for (const spec of specs) {
    const values = fieldValues(row, spec)
    keys = keys.flatMap(prefix => values.map(v => (prefix ? `${prefix} / ${v}` : v)))
  }
  return keys
}

export type PivotResult = {
  rowKeys:     string[]
  colKeys:     string[]
  cells:       Record<string, Record<string, number>>
  rowTotals:   Record<string, number>
  colTotals:   Record<string, number>
  grandTotal:  number
}

export function buildPivot(rows: DailyClosureReportRow[], rowSpecs: PivotFieldSpec[], colSpecs: PivotFieldSpec[]): PivotResult {
  const cells: Record<string, Record<string, number>> = {}
  const rowTotals: Record<string, number> = {}
  const colTotals: Record<string, number> = {}
  let grandTotal = 0

  for (const row of rows) {
    const rKeys = compoundKey(row, rowSpecs)
    const cKeys = compoundKey(row, colSpecs)
    for (const rKey of rKeys) {
      for (const cKey of cKeys) {
        cells[rKey] ??= {}
        cells[rKey][cKey] = (cells[rKey][cKey] ?? 0) + 1
        rowTotals[rKey] = (rowTotals[rKey] ?? 0) + 1
        colTotals[cKey] = (colTotals[cKey] ?? 0) + 1
        grandTotal += 1
      }
    }
  }

  const rowKeys = Object.keys(rowTotals).sort((a, b) => rowTotals[b] - rowTotals[a])
  const colKeys = Object.keys(colTotals).sort((a, b) => colTotals[b] - colTotals[a])

  return { rowKeys, colKeys, cells, rowTotals, colTotals, grandTotal }
}
