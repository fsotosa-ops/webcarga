import type { EstadoDocumental } from '@/lib/types'
import { documentStateStyle } from '@/lib/states'
import { SegmentedControl } from '@/components/ui/SegmentedControl'

interface Props {
  valor:     EstadoDocumental
  onCambiar: (e: EstadoDocumental) => void
  /** Cuántas filas hay en cada estado. Opcional: mientras la consulta está en
   *  vuelo no hay conteo, y un `?? 0` afirmaría un cero que no es cierto — ya
   *  pasó en este módulo, que mostraba "0 documentos por cubrir" y después
   *  saltaba a 2.360. Sin dato, el botón muestra sólo la etiqueta. */
  conteos?:  Partial<Record<EstadoDocumental, number>>
}

/** La escala del glosario (D1 §6.2). `falta` es el balde del resumen de
 *  Certificación, que junta vencidos y faltantes: se nombra con las dos
 *  palabras en vez de inventar una tercera (D-R12). */
const OPCIONES: { id: EstadoDocumental; etiqueta: string }[] = [
  { id: 'todos',      etiqueta: 'Todo' },
  { id: 'falta',      etiqueta: `${documentStateStyle('OVERDUE').label} o ${documentStateStyle('MISSING').label.toLowerCase()}` },
  { id: 'por_vencer', etiqueta: documentStateStyle('EXPIRING').label },
  { id: 'al_dia',     etiqueta: documentStateStyle('UP_TO_DATE').label },
]

/** El filtro de estado documental: qué mostrar de la carga de una empresa —
 *  todo, lo que falta, lo que vence pronto o lo que ya está al día. Reemplaza
 *  el `estado` que `GET /compliance-records/pending` ya sabe recibir. */
/** Con el control segmentado del kit (Entrega 1 de fichas, 15/10): el mismo de
 *  Pendientes, con el número de cada estado. La partición es la del resumen. */
export function FiltroDeEstado({ valor, onCambiar, conteos }: Props) {
  return (
    <SegmentedControl
      label="Filtrar documentos"
      value={valor}
      onChange={onCambiar}
      options={OPCIONES.map(({ id, etiqueta }) => ({
        id, label: etiqueta, badge: conteos?.[id] != null ? String(conteos[id]) : undefined,
      }))}
    />
  )
}
