import { AlertTriangle } from 'lucide-react'

interface Props {
  mensaje: string
  /** Sin esto el aviso sólo informa. Se pasa cuando la operación que falló se
   *  puede volver a intentar desde el mismo renglón — que es la mitad que
   *  faltaba: un error sin salida deja el botón muerto hasta recargar. */
  onReintentar?: () => void
}

/** Lo que salió mal, EN EL RENGLÓN donde salió mal.
 *
 *  Un aviso solo arriba de la lista no diría de cuál de los 91 renglones está
 *  hablando, y ése es justamente el modo de falla que este módulo ya corrigió
 *  una vez: el usuario veía "no pasó nada". */
export function AvisoDeFila({ mensaje, onReintentar }: Props) {
  return (
    <div role="alert" className="flex items-center gap-2 flex-wrap mt-2 pl-1">
      <AlertTriangle size={12} className="text-espera shrink-0" aria-hidden="true" />
      <span className="text-etiqueta text-espera">{mensaje}</span>
      {onReintentar && (
        <button
          type="button"
          onClick={onReintentar}
          className="text-etiqueta font-semibold text-accion cursor-pointer transition-opacity hover:opacity-70"
        >
          Reintentar
        </button>
      )}
    </div>
  )
}
