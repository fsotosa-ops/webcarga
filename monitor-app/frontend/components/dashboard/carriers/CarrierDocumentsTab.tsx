'use client'

import { useQueryClient } from '@tanstack/react-query'
import { Download, Loader2 } from 'lucide-react'
import { TriageWorkbench } from '@/components/compliance/TriageWorkbench'
import { TransporterAlertBanner } from '@/components/dashboard/TransporterAlertBanner'
import { TransporterDocumentsPanel } from '@/components/dashboard/TransporterDocumentsPanel'
import type { ComplianceRecord } from '@/lib/types'

interface Props {
  carrierId:    string
  carrierName:  string
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
  carrierId, carrierName, records, onExport, exporting, exportError,
}: Props) {
  const queryClient = useQueryClient()

  return (
    <>
      <TransporterAlertBanner records={records} />

      {/* La carga vuelve a la ficha (HU-04): el lugar donde mirás la empresa
          es el lugar donde actuás sobre ella. Es el MISMO componente que la
          bandeja, acotado a esta empresa — no una segunda implementación. */}
      <div className="bg-white rounded-xl border border-border p-4 md:p-5">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">
          Cargar y clasificar
        </h3>
        <TriageWorkbench carrierId={carrierId} carrierName={carrierName} />
      </div>

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
          onChanged={() => queryClient.invalidateQueries({ queryKey: ['carrier-detail', carrierId] })}
        />
      </div>
    </>
  )
}
