'use client'

import { Download, Loader2 } from 'lucide-react'
import { CarrierDocumentsWorkspace } from '@/components/compliance/CarrierDocumentsWorkspace'
import { BulkUploadReview } from '@/components/compliance/pending/BulkUploadReview'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import type { Carrier } from '@/lib/types'
import { isCarrierInCertification } from '@/lib/states'

interface Props {
  carrierId:    string
  carrier:      Pick<Carrier, 'business_name' | 'operational_status' | 'management_types'>
  onExport:     () => void
  exporting:    boolean
  exportError?: string | null
}

/** Tab Documentos de la ficha única de empresa (Entrega C, 14/10): la
 *  documentación de la empresa y la de su flota, por sujeto, con su carga. Es
 *  adonde lleva cada fila de Certificación. Varios archivos a la vez se suben con
 *  "Subir documentos", la misma revisión de lote de todas partes, con la empresa ya
 *  puesta (Entrega D); lo que no se resuelve queda en Por asignar. */
export function CarrierDocumentsTab({ carrierId, carrier, onExport, exporting, exportError }: Props) {
  // Misma regla que el espacio de trabajo: activa o en onboarding (la carpeta de quien
  // está entrando también se carga, 21/10); una dada de baja no recibe documentos.
  const canUpload = usePermiso('documents.upload') && isCarrierInCertification(carrier.operational_status)
  return (
    <div className="bg-white rounded-xl border border-border p-4 md:p-5 space-y-3">
      <div className="flex items-center justify-end gap-3">
        {canUpload && <BulkUploadReview trigger="button" carrierId={carrierId} />}
        {exportError && <p className="text-etiqueta text-status-incidente">{exportError}</p>}
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          title="Descargar toda la documentación cargada en un .zip"
          className="flex items-center gap-1.5 text-etiqueta font-semibold text-informativo hover:text-accent border border-border rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-50"
        >
          {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          Exportar todo
        </button>
      </div>
      <CarrierDocumentsWorkspace carrierId={carrierId} carrier={carrier} />
    </div>
  )
}
