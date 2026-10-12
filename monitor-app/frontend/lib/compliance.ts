import type { ComplianceStatus, PoliticaVencimiento } from './types'
import { documentStateStyle, type DocumentState } from './states'

/** "vence en 5 días" / "vencido hace 12 días" / "vence hoy" — mismo patrón
 *  que dueRelative() en lib/utils/installments.ts, pero para documentos
 *  (masculino) en vez de cuotas. Pedido explícito del usuario: las alertas
 *  eran binarias (MISSING/vencido) sin decir desde cuándo/hasta cuándo. */
export function expiryRelative(expirationDate: string | null, isExpired: boolean, today: string = new Date().toISOString().slice(0, 10)): string | null {
  if (!expirationDate) return null
  const diffDays = Math.round((new Date(expirationDate + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000)
  if (diffDays === 0) return 'vence hoy'
  if (diffDays > 0) return `vence en ${diffDays} día${diffDays === 1 ? '' : 's'}`
  return isExpired ? `vencido hace ${Math.abs(diffDays)} día${Math.abs(diffDays) === 1 ? '' : 's'}` : null
}

/** "sin actualizar hace 40 días" — hace visible cuánto tiempo lleva un
 *  MISSING/PENDING_REVIEW sin moverse, no solo que está pendiente. */
export function updatedRelative(updatedAt: string | null, now: number = Date.now()): string | null {
  if (!updatedAt) return null
  const diffDays = Math.floor((now - new Date(updatedAt).getTime()) / 86400000)
  if (diffDays <= 0) return 'actualizado hoy'
  return `sin actualizar hace ${diffDays} día${diffDays === 1 ? '' : 's'}`
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

/** Qué pide cada tipo al cargar el documento (HU-C1, entrega 2b): la misma
 *  tabla que `campos_que_pide` del backend (app/services/vencimientos.py),
 *  que es quien rechaza. Reemplaza a `llevaFecha`/`exigeFecha`, que desde la
 *  entrega 2 le pedían fecha de vencimiento a un mensual. */
export type CamposQuePide = {
  fecha:   'obligatoria' | 'opcional' | 'no'
  emision: boolean
  periodo: boolean
}

const CAMPOS: Record<PoliticaVencimiento, CamposQuePide> = {
  NONE:              { fecha: 'no',          emision: false, periodo: false },
  REQUIRED:          { fecha: 'obligatoria', emision: false, periodo: false },
  OPTIONAL:          { fecha: 'opcional',    emision: false, periodo: false },
  ISSUE_PLUS_MONTHS: { fecha: 'no',          emision: true,  periodo: false },
  CALENDAR_PERIOD:   { fecha: 'no',          emision: false, periodo: true },
}

export const camposQuePide = (p: PoliticaVencimiento): CamposQuePide => CAMPOS[p]

/** El dato que se pide al subir: cada tipo pide a lo sumo uno. */
export type DatoDeCarga = 'vencimiento' | 'emision' | 'periodo'

export function datoQuePide(p: PoliticaVencimiento): { dato: DatoDeCarga; obligatorio: boolean } | null {
  const c = camposQuePide(p)
  if (c.periodo) return { dato: 'periodo', obligatorio: true }
  if (c.emision) return { dato: 'emision', obligatorio: true }
  if (c.fecha !== 'no') return { dato: 'vencimiento', obligatorio: c.fecha === 'obligatoria' }
  return null
}

/** Lo que viaja con el archivo. */
export type DatosDelDocumento = {
  expiration_date?: string
  issue_date?:      string
  period_start?:    string
}

/** El valor de un campo (`YYYY-MM-DD`, o `YYYY-MM` para un período) como
 *  viaja a la API; vacío no viaja. El período se manda como su día 1. */
export function datosDelDocumento(dato: DatoDeCarga, valor: string): DatosDelDocumento {
  if (!valor) return {}
  if (dato === 'periodo') {
    // El input de mes da `YYYY-MM`; donde el navegador lo muestra como texto
    // libre (Safari, Firefox de escritorio) llega `MM/AAAA` o `M-AAAA`.
    const libre = valor.trim().match(/^(\d{1,2})[/-](\d{4})$/)
    const mes = libre ? `${libre[2]}-${libre[1].padStart(2, '0')}` : valor.slice(0, 7)
    return { period_start: `${mes}-01` }
  }
  if (dato === 'emision') return { issue_date: valor }
  return { expiration_date: valor }
}

/** El período que se propone al cargar un mensual (`YYYY-MM`): el siguiente
 *  al que ya está cargado, o el mes anterior a hoy si no hay ninguno (lo más
 *  común en la planilla: "el documento del mes anterior"). */
export function periodoSugerido(cargado: string | null | undefined, hoy: Date = new Date()): string {
  const base = cargado
    ? new Date(Number(cargado.slice(0, 4)), Number(cargado.slice(5, 7)), 1)
    : new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** "septiembre 2026", desde un `YYYY-MM-DD`. */
export function nombreDelPeriodo(inicio: string): string {
  return `${MESES[Number(inicio.slice(5, 7)) - 1]} ${inicio.slice(0, 4)}`
}

/** Lo que una fila dice de su vigencia, en una línea (HU-C1, entrega 2b).
 *
 *  Sale de lo que calculó el backend —`document_state`, `vence_el`, `exigible_desde`,
 *  `falta_dato_de_vigencia`—, no de comparar fechas acá: el vencimiento tiene
 *  una sola definición (`app/services/vencimientos.py`). Lo único que se hace
 *  en el cliente es decirlo en palabras, con el mes o la emisión a la vista. */
export function vigenciaDeLaFila(fila: {
  document_state: DocumentState
  expiration_policy?: PoliticaVencimiento
  expiration_date?: string | null
  vence_el?: string | null
  exigible_desde?: string | null
  falta_dato_de_vigencia?: boolean
  issue_date?: string | null
  period_start?: string | null
}, hoy: string = new Date().toISOString().slice(0, 10)): string | null {
  if (fila.document_state === 'NOT_REQUIRED') {
    return fila.exigible_desde ? `Se exige desde el ${formatExpiry(fila.exigible_desde)}` : documentStateStyle('NOT_REQUIRED').label
  }
  if (fila.document_state === 'MISSING') return null
  if (fila.falta_dato_de_vigencia) {
    return camposQuePide(fila.expiration_policy ?? 'NONE').periodo
      ? 'Falta indicar el período'
      : 'Falta indicar la fecha de emisión'
  }
  const vence = fila.vence_el ?? fila.expiration_date ?? null
  const vencido = fila.document_state === 'OVERDUE'
  const relativo = vence ? expiryRelative(vence, vencido, hoy) : null
  const mes = fila.period_start
    ? nombreDelPeriodo(fila.period_start).replace(/^./, c => c.toUpperCase())
    : null

  if (fila.document_state === 'UP_TO_DATE') {
    if (mes && vence) return `${mes} · sirve hasta el ${formatExpiry(vence)}`
    if (fila.issue_date && vence) return `Emitido el ${formatExpiry(fila.issue_date)} · vence el ${formatExpiry(vence)}`
    return null
  }
  // VENCIDO o POR_VENCER. Un vencido sin fecha —marcado a mano— sigue
  // estando vencido y tiene que decirlo.
  const texto = relativo ?? (vencido ? 'vencido' : null)
  return mes && texto ? `${mes} · ${texto}` : texto
}

/** Estados en que el documento ya fue aprobado. Correr su fecha es extender su
 *  vigencia sin que nadie revise: lo hace quien revisa (documents.review).
 *  Misma lista que ESTADOS_APROBADOS en el backend (schemas/compliance.py). */
const ESTADOS_APROBADOS: ReadonlySet<string> = new Set(['APPROVED', 'APPROVED_MANUAL'])

export function puedeCorregirVencimiento(
  status: string, p: { puedeCargar: boolean; puedeRevisar: boolean },
): boolean {
  return p.puedeCargar && (!ESTADOS_APROBADOS.has(status) || p.puedeRevisar)
}

/** "vence en 5 días" / "vencido hace 12 días" / "vence hoy", desde los días
 *  que contó la API (`days_to_expiry`, día de Chile). Reemplaza la resta de
 *  fechas en el navegador, que con el huso UTC cruzaba de día desde las 21:00. */
export function dueRelative(days: number | null | undefined): string | null {
  if (days == null) return null
  if (days === 0) return 'vence hoy'
  if (days > 0) return `vence en ${days} día${days === 1 ? '' : 's'}`
  const n = Math.abs(days)
  return `vencido hace ${n} día${n === 1 ? '' : 's'}`
}

/** Lo que pasó con el archivo (`compliance_records.status`), para el
 *  historial. NUNCA como estado del documento (spec D1 §3, conflicto 10): el
 *  estado es `document_state`. */
const FILE_HISTORY: Record<ComplianceStatus, string> = {
  MISSING: 'Sin cargar', PENDING_REVIEW: 'En revisión', APPROVED_MANUAL: 'Aprobado a mano',
  APPROVED: 'Aprobado', REJECTED: 'Rechazado', EXPIRED: 'Marcado como vencido', ARCHIVED: 'Archivado',
}
export const fileHistoryLabel = (s: ComplianceStatus): string => FILE_HISTORY[s] ?? s
