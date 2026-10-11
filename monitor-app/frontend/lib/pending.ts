import type { StatusTone } from '@/components/ui/StatusChip'
import { camposQuePide, expiryRelative } from './compliance'
import { corta } from './vigencia'
import type { PendingComplianceRow } from './types'

/** Cómo se lee una fila de Pendientes: el estado en palabras, su señal y la
 *  acción (spec 2026-10-11 §5.2). */
export type PendingRowStatus = { label: string; tone: StatusTone; action: string }

/** "29/09", desde un `YYYY-MM-DD` (a mediodía, para no cruzar de día por el
 *  huso). Pendientes mira semanas, no años. */
const diaMes = (d: string) => corta(new Date(`${d.slice(0, 10)}T12:00:00`))

/** El estado de una fila de Pendientes, dicho como lo dice la maqueta.
 *
 *  Sale de `document_state`, que calcula el backend (la definición única); acá
 *  sólo se pone en palabras. Un archivo cargado sin la fecha que pide su regla
 *  es `OVERDUE` para el backend, pero lo que falta no es un archivo sino el
 *  dato: por eso dice qué falta y la acción es "Completar". */
export function pendingRowStatus(
  fila: PendingComplianceRow,
  hoy: string = new Date().toISOString().slice(0, 10),
): PendingRowStatus {
  const vence = fila.due_on ?? fila.vence_el ?? fila.expiration_date ?? null

  if (fila.tiene_archivo && (fila.missing_validity_data ?? fila.falta_dato_de_vigencia)) {
    const pide = camposQuePide(fila.expiration_policy ?? 'NONE')
    const label = pide.periodo ? 'Falta indicar el período'
      : pide.emision ? 'Falta indicar la fecha de emisión'
      : 'Falta la fecha de vencimiento'
    return { label, tone: 'urgent', action: 'Completar' }
  }

  if (fila.document_state === 'OVERDUE') {
    return { label: vence ? `Venció el ${diaMes(vence)}` : 'Vencido', tone: 'urgent', action: 'Subir' }
  }

  if (fila.document_state === 'EXPIRING') {
    const relativo = vence ? expiryRelative(vence, false, hoy) : null
    const label = relativo && vence
      ? `${relativo.replace(/^./, c => c.toUpperCase())} · ${diaMes(vence)}`
      : 'Por vencer'
    return { label, tone: 'warning', action: 'Subir la nueva' }
  }

  return { label: 'Falta', tone: 'neutral', action: 'Subir' }
}
