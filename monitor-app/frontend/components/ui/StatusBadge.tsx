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
  // Resuelve contra ambos vocabularios: estados TMS (nomenclatura conservada
  // verbatim) y estados operacionales (estado_manual — ids uuid, se muestra su
  // label configurado). Sin esto, un override manual caía al gris con id crudo.
  const tmsMeta = status ? meta?.statuses.find(s => s.id === status) : null
  const opMeta  = !tmsMeta && status ? meta?.operational_states.find(s => s.id === status) : null
  const resolved = tmsMeta ?? opMeta
  const label = tmsMeta ? status : opMeta ? opMeta.label : (status ?? fallbackLabel)
  const fallback = onDark
    ? { backgroundColor: '#334155', color: '#94a3b8' }
    : { backgroundColor: '#f3f4f6', color: '#9ca3af' }
  return (
    <span
      className={`inline-flex rounded-full whitespace-nowrap shrink-0 ${SIZE_CLS[size]}`}
      style={resolved
        ? { backgroundColor: resolved.bg_color, color: resolved.text_color }
        : fallback}
    >
      {label}
    </span>
  )
}
