import type { TripsMeta } from '@/lib/types'
import { tripStageStyle } from '@/lib/states'
import { STATUS_TONE_DOT, StatusChip } from './StatusChip'

interface Props {
  /** Estado a mostrar (ya resuelto: manual_status ?? current_status) */
  status: string | null | undefined
  meta?:  TripsMeta | null
  fallbackLabel?: string
  /** `punto` usa el color del tono en un punto y deja el texto neutro.
   *  En una tabla de 32 filas, 32 pastillas rellenas compiten entre si y con
   *  las alertas, que son lo unico que deberia pedir atencion. */
  variante?: 'relleno' | 'punto'
}

/** El estado de un viaje con el tono de su etapa del viaje (Configuración,
 *  Parte 1): un rojo siempre es Problema. El color no se elige por estado; lo da
 *  `tripStageStyle` desde la columna (`group`) del catálogo. */
export function StatusBadge({ status, meta, fallbackLabel = '—', variante = 'relleno' }: Props) {
  // Resuelve contra ambos vocabularios: estados TMS (nomenclatura conservada
  // verbatim) y estados operacionales (manual_status — ids uuid, se muestra su
  // label configurado). Sin esto, un override manual caía al gris con id crudo.
  const tmsMeta = status ? meta?.statuses.find(s => s.id === status) : null
  const opMeta  = !tmsMeta && status ? meta?.operational_states.find(s => s.id === status) : null
  const label = tmsMeta ? status : opMeta ? opMeta.label : (status ?? fallbackLabel)
  const { tone } = tripStageStyle((tmsMeta ?? opMeta)?.group)

  if (variante === 'punto') {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 text-etiqueta font-semibold uppercase tracking-[0.06em] text-text-primary">
        <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_TONE_DOT[tone]}`} aria-hidden />
        {label}
      </span>
    )
  }
  return <StatusChip tone={tone}>{label}</StatusChip>
}
