'use client'

import { alertSeverityStyle } from '@/lib/states'
import { STATUS_TONE_CLASS } from './StatusChip'

/** Cierre del gap detectado 2026-07-22: el Diario solo mostraba alerta de
 *  Seguros (HU-12) — la documentación LEGAL_MANDATORY de conductor/tracto/
 *  empresa nunca llegaba acá. Consolidado (cuántos documentos pendientes),
 *  no un tri-state ok/vencido — contra datos reales, el 100% del roster
 *  tiene al menos 1 pendiente hoy, así que un badge binario saturaría cada
 *  fila del Diario sin aportar señal. `critical` (Licencia de Conducir/
 *  Carnet, pedido explícito del usuario) sube el badge de ámbar a rojo.
 *
 *  D1: `critical` lo calcula la API (`*_has_critical_alert`): aviso crítico por
 *  días contra el umbral de Configuración o, en el conductor, licencia o cédula
 *  pendiente (R-E5). Este componente no conoce ningún código.
 *  El tono y el ícono salen del glosario (`alertSeverityStyle`). */

interface Props {
  count:     number | null | undefined
  critical?: boolean | null
  compact?:  boolean
  label?:    string
}

export function PendingDocsBadge({ count, critical, compact = false, label }: Props) {
  if (!count) return null
  const style = alertSeverityStyle(critical ? 'critical' : 'warning')
  const Icon = style.icon
  const tono = STATUS_TONE_CLASS[style.tone]
  const base = label ? `${label}: ${count} documento(s) pendiente(s)` : `${count} documento(s) pendiente(s)`
  const title = critical ? `${base} · ${style.label}` : base

  // Ítem 2 (feedback post-weekly 2026-07-22): un badge sin identificar de
  // qué entidad habla (conductor/tracto/empresa) es ambiguo — el `title`
  // (tooltip) no alcanza porque no es visible sin hover/touch sostenido.
  // Mismo criterio que el mockup de Figma "Listado de Recursos": columna de
  // certificación con texto explícito, no un badge de color solo.
  //
  // Primer intento (prefijo de 1 letra, "T7"/"C12") resultó igual de
  // ambiguo — el usuario preguntó qué significaba. La entidad ya se
  // desambigua por POSICIÓN (el badge está pegado al texto de esa entidad
  // específica: patente, nombre de conductor, nombre de empresa) — lo que
  // faltaba no era identificar A QUIÉN, sino QUÉ es el número. Un ícono de
  // documento + el número se lee de forma universal como "N documentos
  // [pendientes]" sin necesitar memorizar una convención de letras.
  if (compact) {
    return (
      <span
        title={title}
        className={`inline-flex items-center gap-0.5 justify-center h-4 px-1 rounded-full text-etiqueta font-bold shrink-0 ${tono}`}
      >
        <Icon size={8} aria-hidden="true" /> {count}
      </span>
    )
  }

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-etiqueta font-semibold whitespace-nowrap ${tono}`}
    >
      <Icon size={9} aria-hidden="true" /> {label ? `${label}: ` : ''}{count} pendiente{count === 1 ? '' : 's'}
    </span>
  )
}
