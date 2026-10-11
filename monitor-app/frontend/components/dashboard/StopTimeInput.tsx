import { fmtDT, toDatetimeLocalValue } from '@/lib/utils/datetime'

interface StopTimeInputProps {
  /** Nombre accesible, p. ej. "Llegada TR de CD LO AGUIRRE". */
  label:     string
  value:     string | null | undefined
  /** El valor lo cargó una persona, no el TMS: se marca en el color de acción. */
  manual:    boolean
  disabled?: boolean
  onCommit:  (value: string) => void
}

/** Una fecha y hora editable de la tabla de paradas. Muestra la fecha formateada
 *  como el resto de la tabla y, al enfocar, el control nativo para editarla; guarda
 *  al salir del campo. Antes estaba copiado cuatro veces en TripDetailView (llegada,
 *  salida, inicio y fin), cada copia con sus colores crudos. */
export function StopTimeInput({ label, value, manual, disabled = false, onCommit }: StopTimeInputProps) {
  const tone = manual ? 'border-accion/40 text-accion' : 'border-border text-informativo'
  return (
    <div className="relative">
      <input
        type="datetime-local"
        aria-label={label}
        defaultValue={toDatetimeLocalValue(value)}
        onBlur={e => { if (e.target.value) onCommit(e.target.value) }}
        disabled={disabled}
        className={`peer w-full rounded-md border bg-white px-1.5 py-1 font-identificador text-etiqueta tabular-nums text-transparent focus:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50 ${tone}`}
      />
      <span className={`pointer-events-none absolute inset-0 flex items-center truncate px-1.5 font-identificador text-etiqueta tabular-nums peer-focus:opacity-0 ${manual ? 'text-accion' : 'text-informativo'}`}>
        {fmtDT(value)}
      </span>
    </div>
  )
}
