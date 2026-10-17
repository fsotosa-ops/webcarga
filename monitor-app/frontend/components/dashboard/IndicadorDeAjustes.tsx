import { History } from 'lucide-react'
import { Button } from '@/components/ui/Button'

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
    <Button variant="link" size="sm" onClick={onVer}>
      <History size={13} className="shrink-0" aria-hidden="true" />
      {cantidad === 1 ? '1 ajuste posterior al cierre' : `${cantidad} ajustes posteriores al cierre`}
    </Button>
  )
}
