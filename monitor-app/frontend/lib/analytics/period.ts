/** El período de Analítica en la URL (HU Analítica, criterio 3): `period` (atajo), `from` y `to` (solo en
 *  rango libre) y `date` (qué fecha manda). Se guarda RELATIVO: "últimos 30 días" sigue siendo los últimos 30 días
 *  mañana, también en una vista guardada. Los demás parámetros se conservan, igual que `writeView`. */

export type PeriodPreset = 'today' | 'last_7d' | 'last_30d' | 'this_month' | 'last_month' | 'custom'
export type Period = { preset: PeriodPreset; from?: string; to?: string }
export type DateField = 'planning' | 'delivered' | 'signed' | 'business'

export const DEFAULT_PERIOD: Period = { preset: 'last_30d' }

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  today: 'Hoy', last_7d: 'Últimos 7 días', last_30d: 'Últimos 30 días', this_month: 'Este mes',
  last_month: 'Mes anterior', custom: 'Rango',
}

export const DATE_FIELD_LABELS: Record<DateField, string> = {
  planning: 'Planificación', delivered: 'Entrega', signed: 'Firma del Cierre', business: 'Día',
}

const PRESETS = Object.keys(PERIOD_LABELS) as PeriodPreset[]
const DATE_FIELDS = Object.keys(DATE_FIELD_LABELS) as DateField[]
const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Fechas como texto AAAA-MM-DD, sin pasar por la zona horaria del navegador. */
function sumarDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10)
}

function primeroDelMes(iso: string, mesesAtras = 0): string {
  const [y, m] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 - mesesAtras, 1)).toISOString().slice(0, 10)
}

/** El rango concreto de un período, con `today` como el día de Chile (AAAA-MM-DD). */
export function resolvePeriod(p: Period, today: string): { from: string; to: string } {
  switch (p.preset) {
    case 'today': return { from: today, to: today }
    case 'last_7d': return { from: sumarDias(today, -6), to: today }
    case 'this_month': return { from: primeroDelMes(today), to: today }
    case 'last_month': return { from: primeroDelMes(today, 1), to: sumarDias(primeroDelMes(today), -1) }
    case 'custom': return { from: p.from ?? today, to: p.to ?? today }
    default: return { from: sumarDias(today, -29), to: today }
  }
}

/** Hoy en Chile, sin depender de la zona del navegador. */
export function todayInChile(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(now)
}

type Leible = Pick<URLSearchParams, 'get'>

export function readPeriod(params: Leible): { period: Period; dateField: DateField | null } {
  const preset = params.get('period') as PeriodPreset | null
  const date = params.get('date') as DateField | null
  const dateField = date && DATE_FIELDS.includes(date) ? date : null
  if (!preset || !PRESETS.includes(preset)) return { period: DEFAULT_PERIOD, dateField }
  if (preset === 'custom') {
    const from = params.get('from') ?? ''
    const to = params.get('to') ?? ''
    if (!ISO.test(from) || !ISO.test(to)) return { period: DEFAULT_PERIOD, dateField }
    return { period: { preset, from, to }, dateField }
  }
  return { period: { preset }, dateField }
}

export function writePeriod(params: Pick<URLSearchParams, 'toString'>, period: Period,
  dateField: DateField | null): URLSearchParams {
  const salida = new URLSearchParams(params.toString())
  salida.set('period', period.preset)
  if (period.preset === 'custom' && period.from && period.to) {
    salida.set('from', period.from); salida.set('to', period.to)
  } else {
    salida.delete('from'); salida.delete('to')
  }
  if (dateField) salida.set('date', dateField); else salida.delete('date')
  return salida
}
