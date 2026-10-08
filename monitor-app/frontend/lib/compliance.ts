import type { ComplianceStatus, PoliticaVencimiento, Urgencia } from './types'

/** Estilo compartido para el estado de un compliance_record (7 valores del
 *  CHECK constraint real de public.compliance_records.status, ver lib/types.ts)
 *  — usado en DocumentChecklist y en cualquier badge/select que muestre el
 *  status de un documento. */
export const COMPLIANCE_STATUS_CONFIG: Record<ComplianceStatus, { cls: string; label: string }> = {
  MISSING:         { cls: 'bg-gray-100 text-gray-500',   label: 'Falta' },
  PENDING_REVIEW:  { cls: 'bg-amber-50 text-amber-600',  label: 'En revisión' },
  APPROVED_MANUAL: { cls: 'bg-teal-50 text-teal-700',    label: 'Aprobado (manual)' },
  APPROVED:        { cls: 'bg-green-100 text-green-700', label: 'Aprobado' },
  REJECTED:        { cls: 'bg-red-100 text-red-600',     label: 'Rechazado' },
  EXPIRED:         { cls: 'bg-red-100 text-red-600',     label: 'Vencido' },
  ARCHIVED:        { cls: 'bg-gray-100 text-gray-400',   label: 'Archivado' },
}

/** El eje de la EVIDENCIA, afinado con lo que la fila ya sabe de si misma.
 *
 *  Las plataformas de cumplimiento de proveedores y de flota (ISNetworld,
 *  Avetta, Veriforce; Fleetio, Samsara) no guardan UN estado por requisito
 *  sino dos independientes: **evidencia** (¿tenemos el papel?) y **vigencia**
 *  (¿está al día?). Un documento puede estar vigente y sin evidencia, y eso no
 *  es un error de dato: en Fleetio los recordatorios de renovación existen sin
 *  documento adjunto, que es exactamente el caso que pidió Pablo — cargar las
 *  fechas que tiene en un Excel sin subir dos mil archivos históricos.
 *
 *  Acá los dos ejes YA se dibujan por separado: el pill de estado y la celda
 *  de vencimiento son dos elementos distintos de la misma fila. Lo único que
 *  faltaba es que "Falta" dejara de significar dos cosas — "no sé nada de este
 *  documento" y "sé cuándo vence, me falta el papel"—, que es la sexta vez que
 *  un mensaje con dos causas aparece en este módulo.
 *
 *  LA REGLA QUE NO SE ROMPE: una fecha sin evidencia nunca cuenta como
 *  cumplido. Por eso el estilo no cambia —sigue siendo el gris de "falta"— y
 *  sólo se precisa la palabra. La urgencia la lleva la fecha, al lado.
 */
export function evidenciaDeDocumento(
  status: ComplianceStatus,
  expirationDate: string | null | undefined,
  tieneArchivo: boolean,
): { cls: string; label: string } {
  const base = COMPLIANCE_STATUS_CONFIG[status]
  if (status === 'MISSING' && expirationDate && !tieneArchivo) {
    return { cls: base.cls, label: 'Falta el archivo' }
  }
  return base
}

/** Estado de alerta de vencimiento — 'ok' | 'expiring_soon' | 'expired'.
 *  El backend ya calcula is_expired/is_expiring_soon por compliance_record
 *  (GET /carriers/{id}, /drivers/{id}/compliance-records, etc.); no hay
 *  date-math que hacer client-side (a diferencia del modelo viejo, que
 *  calculaba esto acá desde columnas `governance` con fechas sueltas). */
export type AlertStatus = 'ok' | 'expiring_soon' | 'expired'

export function complianceAlertStatus(isExpired: boolean, isExpiringSoon: boolean): AlertStatus {
  if (isExpired) return 'expired'
  if (isExpiringSoon) return 'expiring_soon'
  return 'ok'
}

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
  if (dato === 'periodo') return { period_start: `${valor.slice(0, 7)}-01` }
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
 *  Sale de lo que calculó el backend —`urgencia`, `vence_el`, `exigible_desde`,
 *  `falta_dato_de_vigencia`—, no de comparar fechas acá: el vencimiento tiene
 *  una sola definición (`app/services/vencimientos.py`). Lo único que se hace
 *  en el cliente es decirlo en palabras, con el mes o la emisión a la vista. */
export function vigenciaDeLaFila(fila: {
  urgencia: Urgencia
  expiration_policy?: PoliticaVencimiento
  expiration_date?: string | null
  vence_el?: string | null
  exigible_desde?: string | null
  falta_dato_de_vigencia?: boolean
  issue_date?: string | null
  period_start?: string | null
}, hoy: string = new Date().toISOString().slice(0, 10)): string | null {
  if (fila.urgencia === 'NO_EXIGIBLE') {
    return fila.exigible_desde ? `Se exige desde el ${formatExpiry(fila.exigible_desde)}` : 'Todavía no se exige'
  }
  if (fila.urgencia === 'FALTA') return null
  if (fila.falta_dato_de_vigencia) {
    return camposQuePide(fila.expiration_policy ?? 'NONE').periodo
      ? 'Falta indicar el período'
      : 'Falta indicar la fecha de emisión'
  }
  const vence = fila.vence_el ?? fila.expiration_date ?? null
  const vencido = fila.urgencia === 'VENCIDO'
  const relativo = vence ? expiryRelative(vence, vencido, hoy) : null
  const mes = fila.period_start
    ? nombreDelPeriodo(fila.period_start).replace(/^./, c => c.toUpperCase())
    : null

  if (fila.urgencia === 'AL_DIA') {
    if (mes && vence) return `${mes} · sirve hasta el ${formatExpiry(vence)}`
    if (fila.issue_date && vence) return `Emitido el ${formatExpiry(fila.issue_date)} · vence el ${formatExpiry(vence)}`
    return null
  }
  // VENCIDO o POR_VENCER. Un vencido sin fecha —marcado a mano— sigue
  // estando vencido y tiene que decirlo.
  const texto = relativo ?? (vencido ? 'vencido' : null)
  return mes && texto ? `${mes} · ${texto}` : texto
}
