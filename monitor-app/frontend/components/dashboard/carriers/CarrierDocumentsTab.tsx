'use client'

import { Download, Loader2 } from 'lucide-react'
import { TransporterAlertBanner } from '@/components/dashboard/TransporterAlertBanner'
import { TransporterDocumentsPanel } from '@/components/dashboard/TransporterDocumentsPanel'
import type { ComplianceRecord } from '@/lib/types'

interface Props {
  carrierId:    string
  records:      ComplianceRecord[]
  onExport:     () => void
  exporting:    boolean
  exportError?: string | null
}

/** Tab Documentos de la ficha de empresa.
 *
 *  Sale de `carriers/[id]/page.tsx` porque la ficha llevaba 971 líneas y este
 *  es el tab que va a recibir superficie nueva (la carga de documentos, HU-04):
 *  sumarle más sin descomponerla primero la vuelve inmanejable. */
export function CarrierDocumentsTab({
  carrierId, records, onExport, exporting, exportError,
}: Props) {
  return (
    <>
      <TransporterAlertBanner records={records} />
      <div className="bg-white rounded-xl border border-border p-4 md:p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Documentos de la Empresa</h3>
          <button
            type="button"
            onClick={onExport}
            disabled={exporting}
            title="Descargar toda la documentación cargada en un .zip"
            className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 hover:text-accent border border-border/80 rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-50"
          >
            {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            Exportar todo
          </button>
        </div>
        {exportError && <p className="text-xs text-red-500 mb-2">{exportError}</p>}
        <TransporterDocumentsPanel
          records={records}
          carrierId={carrierId}
        />
      </div>
    </>
  )
}
