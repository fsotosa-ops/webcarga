import type { TripsMeta } from '@/lib/types'

interface Props {
  /** Estado a mostrar (ya resuelto: manual_status ?? current_status) */
  status: string | null | undefined
  meta?:  TripsMeta | null
  size?:  'sm' | 'md'
  /** Fallback de color cuando el estado no tiene fila en meta.statuses: claro (tabla) u oscuro (header del detalle) */
  onDark?: boolean
  fallbackLabel?: string
  /** `punto` usa el color configurado en un punto y deja el texto neutro.
   *  En una tabla de 32 filas, 32 pastillas rellenas compiten entre si y con
   *  las alertas, que son lo unico que deberia pedir atencion. El color sigue
   *  saliendo del catalogo — cambia el peso visual, no el vocabulario. */
  variante?: 'relleno' | 'punto'
}

const SIZE_CLS = {
  sm: 'text-etiqueta font-semibold px-2 py-0.5',
  md: 'text-etiqueta font-bold px-2.5 py-1',
}

export function StatusBadge({ status, meta, size = 'sm', onDark = false, fallbackLabel = '—', variante = 'relleno' }: Props) {
  // Resuelve contra ambos vocabularios: estados TMS (nomenclatura conservada
  // verbatim) y estados operacionales (manual_status — ids uuid, se muestra su
  // label configurado). Sin esto, un override manual caía al gris con id crudo.
  const tmsMeta = status ? meta?.statuses.find(s => s.id === status) : null
  const opMeta  = !tmsMeta && status ? meta?.operational_states.find(s => s.id === status) : null
  const resolved = tmsMeta ?? opMeta
  const label = tmsMeta ? status : opMeta ? opMeta.label : (status ?? fallbackLabel)
  const fallback = onDark
    ? { backgroundColor: '#334155', color: '#94a3b8' }
    : { backgroundColor: '#f3f4f6', color: '#9ca3af' }
  if (variante === 'punto') {
    const color = resolved?.text_color ?? '#9ca3af'
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 text-etiqueta font-semibold uppercase tracking-[0.06em] text-text-primary">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        {label}
      </span>
    )
  }

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
