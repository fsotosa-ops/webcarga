import type { ComplianceStatus } from './types'

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
