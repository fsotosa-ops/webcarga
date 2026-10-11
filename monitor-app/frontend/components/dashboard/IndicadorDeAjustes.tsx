import { History } from 'lucide-react'

interface Props {
  /** Cuántos ajustes posteriores tiene la firma vigente del día. */
  cantidad: number
  /** Lleva a la pestaña "Viajes", donde está la lista. */
  onVer:    () => void
}

/** Junto al estado "Cerrado": cuántos ajustes posteriores al cierre tiene el día
 *  (spec 2026-10-10 §3). No es un aviso: el día sigue firmado y nada pide acción.
 *  Estándar de cierre de período (SAP, NetSuite): un indicador en el encabezado,
 *  el detalle en su lugar. Sin ajustes, no aparece. */
export function IndicadorDeAjustes({ cantidad, onVer }: Props) {
  if (cantidad === 0) return null
  return (
    <button
      type="button"
      onClick={onVer}
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline focus:outline-none focus:ring-2 focus:ring-accent/30 rounded"
    >
      <History size={13} className="shrink-0" />
      {cantidad === 1 ? '1 ajuste posterior al cierre' : `${cantidad} ajustes posteriores al cierre`}
    </button>
  )
}
