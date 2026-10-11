type Props = {
  /** Activos que llevan más de `dias` sin movimiento (GET /trips, en curso).
   *  undefined mientras no llega: no se afirma una cifra que no está. */
  cantidad: number | undefined
  dias: number
  onVer: () => void
}

/** Al pie de "En curso" (decisión del usuario 11/10): los viajes activos sin
 *  movimiento reciente salen de la vista, pero no desaparecen sin aviso. Siguen
 *  en el Historial y en el Cierre. */
export function AvisoFueraDeEnCurso({ cantidad, dias, onVer }: Props) {
  if (!cantidad) return null
  const plazo = dias === 1 ? '1 día' : `${dias} días`
  const texto = cantidad === 1
    ? `1 viaje activo lleva más de ${plazo} sin movimiento y no se muestra aquí.`
    : `${cantidad} viajes activos llevan más de ${plazo} sin movimiento y no se muestran aquí.`
  return (
    <p role="status" className="flex flex-wrap items-center gap-x-2 text-xs text-informativo">
      <span>{texto}</span>
      <button type="button" onClick={onVer} className="font-semibold text-accent hover:underline">
        Ver en Historial
      </button>
    </p>
  )
}
