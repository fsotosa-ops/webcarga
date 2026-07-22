'use client'

import { FileWarning } from 'lucide-react'

/** Cierre del gap detectado 2026-07-22: el Diario solo mostraba alerta de
 *  Seguros (HU-12) — la documentación LEGAL_MANDATORY de conductor/tracto/
 *  empresa nunca llegaba acá. Consolidado (cuántos documentos pendientes),
 *  no un tri-state ok/vencido — contra datos reales, el 100% del roster
 *  tiene al menos 1 pendiente hoy, así que un badge binario saturaría cada
 *  fila del Diario sin aportar señal. `critical` (Licencia de Conducir/
 *  Carnet, pedido explícito del usuario) sube el badge de ámbar a rojo. */

interface Props {
  count:     number | null | undefined
  critical?: boolean | null
  compact?:  boolean
  label?:    string
}

export function PendingDocsBadge({ count, critical, compact = false, label }: Props) {
  if (!count) return null
  const tone = critical ? 'red' : 'amber'
  const title = label ? `${label}: ${count} documento(s) pendiente(s)` : `${count} documento(s) pendiente(s)`

  if (compact) {
    return (
      <span
        title={title}
        className={`inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold shrink-0 ${
          tone === 'red' ? 'bg-red-100 text-red-600' : 'bg-amber-50 text-amber-600'
        }`}
      >
        {count}
      </span>
    )
  }

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${
        tone === 'red' ? 'bg-red-100 text-red-600' : 'bg-amber-50 text-amber-600'
      }`}
    >
      <FileWarning size={9} /> {count} pendiente{count === 1 ? '' : 's'}
    </span>
  )
}
