import type { StatusTone } from '@/components/ui/StatusChip'
import { camposQuePide, expiryRelative, nombreDelPeriodo } from './compliance'
import { documentStateStyle } from './states'
import { corta, periodoQueSeExige, vigenciaDe } from './vigencia'
import { hoyEnChile } from './utils/datetime'
import type { PendingComplianceRow, PendingFilter, PendingSummaryRow } from './types'

/** Cómo se lee una fila de Pendientes: el estado en palabras, su señal, una
 *  línea de contexto opcional y la acción (spec 2026-10-11 §5.2). */
export type PendingRowStatus = { label: string; tone: StatusTone; action: string; detail?: string }

const aFecha = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`)
/** "29/09", desde un `YYYY-MM-DD` (a mediodía, para no cruzar de día por el
 *  huso). Pendientes mira semanas, no años. */
export const diaMes = (d: string) => corta(aFecha(d))

function haceDias(desde: string, hoy: string): string {
  const n = Math.round((aFecha(hoy).getTime() - aFecha(desde).getTime()) / 86400000)
  if (n <= 0) return 'Ingresó hoy'
  return `Ingresó hace ${n} día${n === 1 ? '' : 's'}`
}

/** El estado de una fila de Pendientes, dicho como lo dice la maqueta.
 *
 *  Sale de `document_state`, que calcula el backend (la definición única); acá
 *  sólo se pone en palabras. Un archivo cargado sin la fecha que pide su regla
 *  es `OVERDUE` para el backend, pero lo que falta no es un archivo sino el
 *  dato: por eso dice qué falta y la acción es "Completar".
 *
 *  `hoy` es el día de Chile, no el UTC: desde las 21:00 el UTC ya es mañana. */
export function pendingRowStatus(fila: PendingComplianceRow, hoy: string = hoyEnChile()): PendingRowStatus {
  const vence = fila.due_on ?? fila.vence_el ?? fila.expiration_date ?? null

  if (fila.tiene_archivo && (fila.missing_validity_data ?? fila.falta_dato_de_vigencia)) {
    const pide = camposQuePide(fila.expiration_policy ?? 'NONE')
    const label = pide.periodo ? 'Falta indicar el período'
      : pide.emision ? 'Falta indicar la fecha de emisión'
      : 'Falta la fecha de vencimiento'
    return { label, tone: 'urgent', action: 'Completar', detail: 'El archivo está cargado; sin la fecha no vale' }
  }

  if (fila.document_state === 'OVERDUE') {
    const s = documentStateStyle('OVERDUE')
    return { label: vence ? `Venció el ${diaMes(vence)}` : s.label, tone: s.tone, action: 'Subir' }
  }

  if (fila.document_state === 'EXPIRING') {
    const s = documentStateStyle('EXPIRING')
    const relativo = vence ? expiryRelative(vence, false, hoy) : null
    const label = relativo && vence
      ? `${relativo.replace(/^./, c => c.toUpperCase())} · ${diaMes(vence)}`
      : s.label
    return { label, tone: s.tone, action: 'Subir la nueva' }
  }

  const falta = documentStateStyle('MISSING')
  return fila.entered_on
    ? { label: falta.label, tone: falta.tone, action: 'Subir', detail: haceDias(fila.entered_on, hoy) }
    : { label: falta.label, tone: falta.tone, action: 'Subir' }
}

/** "período septiembre · vence el 18/10": el período que se exige hoy de un
 *  documento por período, y el día en que se pide. `null` si su regla no
 *  define período. La aritmética es la de `periodoQueSeExige` (la misma que
 *  el ejemplo de Configuración), no una segunda. */
export function pendingPeriodLine(row: PendingSummaryRow, hoy: string = hoyEnChile()): string | null {
  if (!row.expiration_policy) return null
  const p = periodoQueSeExige(
    vigenciaDe({ expiration_policy: row.expiration_policy, vigencia: row.vigencia }), aFecha(hoy))
  if (!p) return null
  const inicio = `${p.periodo.getFullYear()}-${String(p.periodo.getMonth() + 1).padStart(2, '0')}-01`
  return `período ${nombreDelPeriodo(inicio).split(' ')[0]} · vence el ${corta(p.sePide)}`
}

/** El filtro con que se abre un documento o empresa cuando la URL no dice
 *  `state`: Vencidos, salvo que esté vacío; entonces el primero con algo
 *  (Por vencer, luego Faltan). Con `state` en la URL manda la URL. */
export function defaultPendingFilter(
  row: Pick<PendingSummaryRow, 'overdue' | 'expiring' | 'missing'> | null,
): PendingFilter {
  if (!row || row.overdue > 0) return 'overdue'
  if (row.expiring > 0) return 'expiring'
  if (row.missing > 0) return 'missing'
  return 'overdue'
}
