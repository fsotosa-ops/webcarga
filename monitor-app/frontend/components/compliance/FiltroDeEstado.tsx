import type { EstadoDocumental } from '@/lib/types'

interface Props {
  valor:     EstadoDocumental
  onCambiar: (e: EstadoDocumental) => void
  /** Cuántas filas hay en cada estado. Opcional: mientras la consulta está en
   *  vuelo no hay conteo, y un `?? 0` afirmaría un cero que no es cierto — ya
   *  pasó en este módulo, que mostraba "0 documentos por cubrir" y después
   *  saltaba a 2.360. Sin dato, el botón muestra sólo la etiqueta. */
  conteos?:  Partial<Record<EstadoDocumental, number>>
}

const OPCIONES: { id: EstadoDocumental; etiqueta: string }[] = [
  { id: 'todos',      etiqueta: 'Todo' },
  { id: 'falta',      etiqueta: 'Falta' },
  { id: 'por_vencer', etiqueta: 'Por vencer' },
  { id: 'al_dia',     etiqueta: 'Al día' },
]

/** El filtro de estado documental: qué mostrar de la carga de una empresa —
 *  todo, lo que falta, lo que vence pronto o lo que ya está al día. Reemplaza
 *  el `estado` que `GET /compliance-records/pending` ya sabe recibir. */
export function FiltroDeEstado({ valor, onCambiar, conteos }: Props) {
  return (
    <div role="group" className="inline-flex gap-1">
      {OPCIONES.map(({ id, etiqueta }) => {
        const activo = valor === id
        const conteo = conteos?.[id]
        return (
          <button
            key={id}
            type="button"
            aria-pressed={activo}
            onClick={() => onCambiar(id)}
            className={`inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-etiqueta font-medium transition-colors ${
              activo ? 'bg-accent text-white' : 'text-informativo hover:brightness-95'
            }`}
          >
            {etiqueta}
            {conteo != null && (
              <span className="tabular-nums">{conteo}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
