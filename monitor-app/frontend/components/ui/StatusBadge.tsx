import type { TripsMeta } from '@/lib/types'

interface Props {
  /** Estado a mostrar (ya resuelto: estado_manual ?? current_status) */
  status: string | null | undefined
  meta?:  TripsMeta | null
  size?:  'sm' | 'md'
  /** Fallback de color cuando el estado no tiene fila en meta.statuses: claro (tabla) u oscuro (header del detalle) */
  onDark?: boolean
  fallbackLabel?: string
}

const SIZE_CLS = {
  sm: 'text-[10px] font-semibold px-2 py-0.5',
  md: 'text-[11px] font-bold px-2.5 py-1',
}

export function StatusBadge({ status, meta, size = 'sm', onDark = false, fallbackLabel = '—' }: Props) {
  const statusMeta = status ? meta?.statuses.find(s => s.id === status) : null
  const fallback = onDark
    ? { backgroundColor: '#334155', color: '#94a3b8' }
    : { backgroundColor: '#f3f4f6', color: '#9ca3af' }
  return (
    <span
      className={`inline-flex rounded-full whitespace-nowrap shrink-0 ${SIZE_CLS[size]}`}
      style={statusMeta
        ? { backgroundColor: statusMeta.bg_color, color: statusMeta.text_color }
        : fallback}
    >
      {status ?? fallbackLabel}
    </span>
  )
}
