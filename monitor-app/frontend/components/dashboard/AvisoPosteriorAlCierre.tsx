'use client'

import { AlertTriangle } from 'lucide-react'

interface Props {
  /** `cierre.posteriores_al_cierre` de GET /daily-closures — entero, nunca
   *  negativo. */
  cantidad: number
  onVerlos: () => void
}

/**
 * El día NO se reabre: la firma sigue siendo verdadera sobre los viajes que
 * existían cuando se firmó (ver el comentario en
 * `daily_closures.py::get_daily_closure_status`). Lo que llega después es un
 * delta — "posterior al cierre" — nunca "reabierto": esa palabra mentiría
 * sobre lo que pasó. El encabezado del día sigue diciendo "Cerrado"; este
 * aviso va al lado, no lo reemplaza.
 *
 * Con `cantidad === 0` no hay delta que avisar: no renderiza nada.
 */
export function AvisoPosteriorAlCierre({ cantidad, onVerlos }: Props) {
  if (cantidad === 0) return null

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-espera/20 bg-espera/5 px-4 py-3">
      <div className="flex items-center gap-2">
        <AlertTriangle size={14} className="text-espera shrink-0" />
        <p className="text-dato text-text-primary tabular-nums">
          {cantidad} {cantidad === 1 ? 'viaje posterior al cierre' : 'viajes posteriores al cierre'}
        </p>
      </div>
      <button
        type="button"
        onClick={onVerlos}
        className="text-etiqueta font-semibold text-accion hover:underline shrink-0"
      >
        Verlos
      </button>
    </div>
  )
}
