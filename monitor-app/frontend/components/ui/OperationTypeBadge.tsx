import type { TripsMeta } from '@/lib/types'

interface Props {
  /** Clasificación RM/Zona Cero ya resuelta (TripStop.operation_type /
   *  Trip.origin_operation_type) — null si el local no matcheó ningún
   *  registro del catálogo (public.locations). */
  operationType: string | null | undefined
  meta?:         TripsMeta | null
  size?:         'sm' | 'md'
}

const SIZE_CLS = {
  sm: 'text-etiqueta font-bold px-1 py-0.5',
  md: 'text-etiqueta font-semibold px-1.5 py-0.5',
}

export function OperationTypeBadge({ operationType, meta, size = 'sm' }: Props) {
  if (!operationType) return null
  const resolved = meta?.operation_types.find(t => t.id === operationType)
  return (
    <span
      title={resolved?.label ?? operationType}
      className={`inline-flex rounded whitespace-nowrap shrink-0 ${SIZE_CLS[size]}`}
      style={resolved
        ? { backgroundColor: resolved.bg_color, color: resolved.text_color }
        : { backgroundColor: '#f3f4f6', color: '#9ca3af' }}
    >
      {resolved?.label ?? operationType}
    </span>
  )
}
