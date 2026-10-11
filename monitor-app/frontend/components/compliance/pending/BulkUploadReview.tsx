import type { PendingSummaryRow } from '@/lib/types'

/** STUB de la Task 9: la carga en lote real (soltar, revisar, guardar) llega en
 *  la Task 10, que reemplaza este archivo entero. Mientras, sólo dibuja la zona
 *  para que la pantalla tenga su lugar y el permiso se pueda probar. */
export function BulkUploadReview({ requirement }: { requirement: PendingSummaryRow }) {
  return (
    <div className="my-2 rounded-md border border-dashed border-border bg-bg-main px-3 py-2 text-etiqueta text-informativo">
      Arrastra varios {requirement.label} aquí para ver a quién corresponde cada uno antes de guardar.
    </div>
  )
}
